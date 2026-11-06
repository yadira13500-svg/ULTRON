import { db, scheduler } from 'hatchable';

export const access = 'scheduler';
export const methods = ['POST'];
const ROUTE='/api/ultron/jobs/agent-runner';
const safeUrl = value => {
  try {
    const u=new URL(String(value||'')), h=u.hostname.toLowerCase();
    if(u.protocol!=='https:'||!h||u.username||u.password||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||
      /^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h)||h==='::1'||h.startsWith('[')) return null;
    return u;
  } catch { return null; }
};
async function verifyUrl(value) {
  let u=safeUrl(value);
  if(!u) return {verified:false,error:'Only public HTTPS sources can be verified.'};
  let r=await fetch(u.toString(),{method:'HEAD',redirect:'manual',timeout_ms:10000,headers:{'User-Agent':'ULTRON-Agent/1.0'}});
  if(r.status===405||r.status===501) r=await fetch(u.toString(),{method:'GET',redirect:'manual',timeout_ms:10000,headers:{'Range':'bytes=0-0','User-Agent':'ULTRON-Agent/1.0'}});
  if(r.status>=300&&r.status<400) {
    const loc=r.headers.get('location'), next=loc?safeUrl(new URL(loc,u).toString()):null;
    if(!next) return {verified:false,url:u.toString(),status:r.status,error:'Redirect target was not accepted as a public HTTPS source.'};
    u=next;
    r=await fetch(u.toString(),{method:'HEAD',redirect:'manual',timeout_ms:10000,headers:{'User-Agent':'ULTRON-Agent/1.0'}});
  }
  return {reachable:r.status>=200&&r.status<300,operationVerified:r.status>=200&&r.status<300,verified:false,verificationType:'url_reachability',url:u.toString(),status:r.status,checkedAt:new Date().toISOString(),contentType:r.headers.get('content-type')||'',note:'This confirms that the URL responded. It does not verify the accuracy of claims on the page.'};
}
async function quickResearch(query) {
  const q=String(query||'').trim().slice(0,240);
  const results=[];
  try {
    const response=await fetch('https://html.duckduckgo.com/html/?q='+encodeURIComponent(q),{timeout_ms:9000,headers:{'Accept':'text/html','User-Agent':'Mozilla/5.0 ULTRON-Agent/1.0'}});
    if(response.ok) {
      const html=await response.text();
      const chunks=html.split('class="result__a"').slice(1);
      for(const chunk of chunks) {
        const href=(chunk.split('href="')[1]||'').split('"')[0];
        const title=(chunk.split('</a')[0].split('>').slice(1).join('>')||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
        try {
          const link=new URL(href,'https://duckduckgo.com'), target=link.searchParams.get('uddg')||link.href, u=new URL(target);
          if(title&&(u.protocol==='https:'||u.protocol==='http:')&&!/(duckduckgo|google)\./i.test(u.hostname))results.push({title,url:u.href,snippet:''});
        } catch {}
        if(results.length>=5)break;
      }
    }
  } catch {}
  if(results.length)return {results,source:'DuckDuckGo public web results',retrievedAt:new Date().toISOString()};
  try {
    const url='https://api.duckduckgo.com/?q='+encodeURIComponent(q)+'&format=json&no_html=1&skip_disambig=1';
    const r=await fetch(url,{timeout_ms:7000,headers:{'Accept':'application/json','User-Agent':'ULTRON-Agent/1.0'}});
    if(r.ok) {
      const d=await r.json();
      if(d.AbstractURL&&d.AbstractText)results.push({title:d.Heading||q,url:d.AbstractURL,snippet:d.AbstractText});
      for(const x of (d.RelatedTopics||[]).flatMap(v=>v.Topics||[v]))if(x.FirstURL&&x.Text)results.push({title:String(x.Text).split(' - ')[0].slice(0,180),url:x.FirstURL,snippet:String(x.Text).slice(0,900)});
    }
  } catch {}
  if(!results.length) {
    try {
      const url='https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch='+encodeURIComponent(q)+'&format=json&utf8=1&srlimit=5';
      const r=await fetch(url,{timeout_ms:7000,headers:{'Accept':'application/json','User-Agent':'ULTRON-Agent/1.0'}});
      if(r.ok) {
        const d=await r.json();
        for(const x of (d.query?.search||[]))results.push({title:x.title,url:'https://en.wikipedia.org/?curid='+x.pageid,snippet:String(x.snippet||'').replace(/<[^>]*>/g,'')});
      }
    } catch {}
  }
  return {results:results.slice(0,5),source:results.length?'DuckDuckGo Instant Answers / Wikipedia':'Free public indexes',retrievedAt:new Date().toISOString()};
}
async function executeStep(step, owner, runId) {
  const input=step.input||{};
  if(step.step_type==='research_search') {
    const data=await quickResearch(String(input.query));
    const results=(data.results||[]).filter(x=>x&&x.title&&x.url).slice(0,5).map(x=>({title:String(x.title).slice(0,240),url:String(x.url).slice(0,1000),snippet:String(x.snippet||'').slice(0,1200)}));
    return {query:input.query,results,source:data.source,retrievedAt:data.retrievedAt,operationVerified:results.length>0,verified:false,note:results.length?'Search results are leads, not verified facts. Run a verify_url step before treating a source as checked.':'The free public indexes returned no useful result for this query; no result was invented.'};
  }
  if(step.step_type==='verify_url') {
    const result=await verifyUrl(input.url);
    if(!result.reachable) throw new Error('Source reachability check failed: HTTP '+(result.status||'unavailable')+'. '+(result.error||''));
    return result;
  }
  if(step.step_type==='retrieve_source') {
    let u=safeUrl(input.url);
    if(!u) throw new Error('Only public HTTPS sources can be retrieved.');
    const trustedHosts=['www.rfc-editor.org','datatracker.ietf.org','developer.mozilla.org','www.w3.org','www.nist.gov','www.who.int','www.un.org','www.worldbank.org','www.nature.com','www.science.org','www.reuters.com','apnews.com','www.bbc.com'];
    if(!trustedHosts.includes(u.hostname.toLowerCase())) throw new Error('Source retrieval is currently limited to approved public reference hosts. The URL can still be checked for reachability, but its content was not fetched.');
    let r=await fetch(u.toString(),{method:'GET',redirect:'manual',timeout_ms:12000,headers:{'Range':'bytes=0-65535','Accept':'text/html,text/plain,application/xhtml+xml','User-Agent':'ULTRON-Agent/1.0'}});
    if(r.status>=300&&r.status<400) {
      const loc=r.headers.get('location'), next=loc?safeUrl(new URL(loc,u).toString()):null;
      if(!next) throw new Error('Redirect target was not accepted as a public HTTPS source.');
      u=next;
      r=await fetch(u.toString(),{method:'GET',redirect:'manual',timeout_ms:12000,headers:{'Range':'bytes=0-65535','Accept':'text/html,text/plain,application/xhtml+xml','User-Agent':'ULTRON-Agent/1.0'}});
    }
    if(!r.ok) throw new Error('Source content retrieval failed: HTTP '+r.status+'.');
    const type=String(r.headers.get('content-type')||'').toLowerCase();
    if(!(type.includes('text/html')||type.includes('text/plain')||type.includes('application/xhtml+xml'))) throw new Error('Unsupported source content type; only HTML and plain text are accepted.');
    const declared=Number(r.headers.get('content-length')||0);
    if(declared>1048576) throw new Error('Source is larger than the 1 MB retrieval limit.');
    const responseText=await r.text();
    const truncated=responseText.length>120000;
    const raw=responseText.slice(0,120000);
    const lower=raw.toLowerCase(), a=lower.indexOf('<title'), b=a>=0?lower.indexOf('>',a):-1, c=b>=0?lower.indexOf('</title>',b):-1;
    const title=a>=0&&b>=0&&c>b?raw.slice(b+1,c).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim():'';
    const attr=(tag,name)=>{const m=String(tag||'').match(new RegExp(name+'="([^"]*)"','i'));return m?m[1].trim():'';};
    const metaTags=raw.match(/<meta\b[^>]*>/gi)||[];
    const metaValue=keys=>{for(const tag of metaTags){const key=(attr(tag,'name')||attr(tag,'property')||attr(tag,'itemprop')).toLowerCase();if(keys.includes(key)){const value=attr(tag,'content');if(value)return {value,field:key};}}return null;};
    const canonicalTag=(raw.match(/<link\b[^>]*rel="canonical"[^>]*>/i)||[])[0]||'';
    const canonicalUrl=(()=>{const href=attr(canonicalTag,'href');if(!href)return null;try{const x=new URL(href,u);return x.protocol==='https:'?x.toString():null;}catch{return null;}})();
    const published=metaValue(['article:published_time','datepublished','citation_publication_date','date']);
    const modified=metaValue(['article:modified_time','datemodified','last-modified']);
    const publisher=metaValue(['og:site_name','publisher','application-name']);
    const description=metaValue(['og:description','description']);
    const dateRecord=x=>{if(!x)return null;const parsed=Date.parse(x.value);return Number.isFinite(parsed)?{value:x.value,field:x.field,iso:new Date(parsed).toISOString()}:{value:x.value,field:x.field,iso:null};};
    let cleaned=raw;
    const pageLower=raw.toLowerCase();
    const mainStart=pageLower.indexOf('<main'), articleStart=pageLower.indexOf('<article');
    const contentStart=mainStart>=0?mainStart:articleStart;
    if(contentStart>=0) cleaned=raw.slice(contentStart);
    for(const name of ['style','script','noscript','nav','header','footer','aside']) {
      let lower=cleaned.toLowerCase(), start=lower.indexOf('<'+name);
      while(start>=0) { const open=lower.indexOf('>',start), end=open>=0?lower.indexOf('</'+name+'>',open):-1; if(open<0||end<0)break; cleaned=cleaned.slice(0,start)+cleaned.slice(end+name.length+3); lower=cleaned.toLowerCase(); start=lower.indexOf('<'+name); }
    }
    let plain='', tag=false;
    for(let i=0;i<cleaned.length&&plain.length<20000;i++){const ch=cleaned[i];if(ch==='<'){tag=true;continue;}if(ch==='>'){tag=false;plain+=' ';continue;}if(!tag)plain+=ch;}
    const excerpt=plain.replaceAll('&nbsp;',' ').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replace(/\s+/g,' ').trim().slice(0,8000);
    if(!excerpt) throw new Error('No readable page text was extracted.');
    const visiblePublished=excerpt.match(/(?:Published|Publication date)\s*:\s*([A-Z][a-z]+\s+\d{4}(?:-\d{2}-\d{2})?)/);
    const visibleModified=excerpt.match(/(?:Last updated|Modified)\s*:\s*([A-Z][a-z]+\s+\d{4}(?:-\d{2}-\d{2})?)/);
    const publicationDate=dateRecord(published)||(visiblePublished?dateRecord({value:visiblePublished[1],field:'visible_text_label:published'}):null);
    const modifiedDate=dateRecord(modified)||(visibleModified?dateRecord({value:visibleModified[1],field:'visible_text_label:modified'}):null);
    return {retrieved:true,operationVerified:true,verified:false,verificationType:'source_content_capture',url:u.toString(),canonicalUrl,title:title.slice(0,240),publisher:publisher?.value||null,description:description?.value||null,publicationDate,modifiedDate,httpStatus:r.status,contentType:type,excerpt,truncated,retrievedAt:new Date().toISOString(),evidenceLimit:'Publication metadata is page-declared and may be absent or inaccurate; retrieval time is not publication time. A captured excerpt is source evidence, not proof that its claims are accurate or independent.'};
  }
  if(step.step_type==='assess_claim') {
    const claim=String(input.claim||'').trim().slice(0,600);
    const urls=Array.isArray(input.source_urls)?input.source_urls:[];
    if(!claim||urls.length<2||urls.length>4) throw new Error('Claim assessment requires one claim and 2–4 captured sources.');
    const prior=(await db.query("SELECT result FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND step_type='retrieve_source' AND status='completed' ORDER BY position",[runId,owner])).rows.map(x=>x.result||{});
    const evidence=urls.map(url=>prior.find(x=>x.url===url&&x.retrieved===true&&x.verificationType==='source_content_capture')).filter(Boolean);
    if(evidence.length!==urls.length) throw new Error('Every source must be captured successfully before claim assessment.');
    const stop=new Set(['about','after','again','against','also','among','because','been','being','between','could','does','during','each','from','have','into','more','most','other','over','same','should','some','such','than','that','their','there','these','they','this','those','through','under','very','were','what','when','where','which','while','with','would','your']);
    const terms=(claim.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(x=>!stop.has(x));
    const matches=evidence.map(source=>{
      const sentences=String(source.excerpt||'').split(/(?<=[.!?])\s+/).slice(0,180);
      let best={sentence:'',overlap:0,matchedTerms:[]};
      for(const sentence of sentences){const words=new Set((sentence.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(x=>!stop.has(x)));const hit=terms.filter(x=>words.has(x));const ratio=terms.length?hit.length/terms.length:0;if(ratio>best.overlap)best={sentence:sentence.slice(0,700),overlap:Number(ratio.toFixed(3)),matchedTerms:hit};}
      let host='';try{host=new URL(source.url).hostname.toLowerCase().replace(/^www\./,'')}catch{}
      return {title:source.title||'',url:source.url,canonicalUrl:source.canonicalUrl||null,publisher:source.publisher||null,publicationDate:source.publicationDate||null,modifiedDate:source.modifiedDate||null,httpStatus:source.httpStatus||null,contentType:source.contentType||null,truncated:source.truncated===true,host,excerptCandidate:best.sentence,termOverlap:best.overlap,matchedTerms:best.matchedTerms,retrievedAt:source.retrievedAt||null};
    });
    const domains=[...new Set(matches.map(x=>x.host).filter(Boolean))];
    const candidates=matches.filter(x=>x.termOverlap>=0.35&&x.matchedTerms.length>=3);
    const assessment={claim,operationVerified:true,assessmentStatus:candidates.length>=2&&domains.length>=2?'evidence_candidates_found':'insufficient_evidence',distinctHostnameCount:domains.length,sourceCount:matches.length,evidenceCandidates:candidates,allSources:matches,verified:false,verificationType:'conservative_claim_evidence_scan',method:'Deterministic term-overlap scan only. It does not infer entailment, contradiction, publisher independence, or truth. Distinct hostnames are not proof of independent publishers.',nextAction:'A human reviewer must inspect the quoted passages and source provenance before accepting or rejecting the claim.'};
    await db.query("INSERT INTO ultron_claim_reviews(owner_id,run_id,step_id,claim_text,assessment_status,method,assessment) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(owner_id,step_id) DO UPDATE SET claim_text=EXCLUDED.claim_text,assessment_status=EXCLUDED.assessment_status,method=EXCLUDED.method,assessment=EXCLUDED.assessment,review_status='pending',verification_state='unverified',reviewer_note='',correction='',reviewed_at=NULL",[owner,runId,step.id,claim,assessment.assessmentStatus,assessment.method,JSON.stringify(assessment)]);
    return {...assessment,reviewRecordCreated:true,reviewStatus:'pending'};
  }
  if(step.step_type==='create_task') {
    const title=String(input.title||'').trim(), body=String(input.body||'').trim();
    const inserted=await db.query("INSERT INTO ultron_items(owner_id,kind,title,body,status) VALUES($1,'task',$2,$3,'open') RETURNING id,title,kind,status,created_at",[owner,title,body]);
    const saved=inserted.rows[0];
    const check=(await db.query('SELECT id,title,kind,status FROM ultron_items WHERE id=$1 AND owner_id=$2',[saved.id,owner])).rows[0];
    if(!check||check.id!==saved.id||check.status!=='open') throw new Error('The task was inserted but its persisted state could not be verified.');
    return {created:true,operationVerified:true,verified:true,item:check};
  }
  if(step.step_type==='save_learning') {
    const sourceUrl=String(input.source_url||'');
    let sourceName='Owner-provided';
    if(sourceUrl) {
      const prior=(await db.query("SELECT result FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND step_type='retrieve_source' AND status='completed' ORDER BY position DESC",[runId,owner])).rows;
      const match=prior.map(x=>x.result||{}).find(x=>x.url===sourceUrl&&x.retrieved===true&&x.verificationType==='source_content_capture');
      if(!match) throw new Error('This source has not had its content captured in this run. Add a retrieve_source step for the same URL before saving sourced learning.');
      sourceName=new URL(sourceUrl).hostname.slice(0,160);
    }
    const topic=String(input.topic).trim().slice(0,240), summary=String(input.summary).trim().slice(0,3000);
    const saved=await db.query("INSERT INTO ultron_knowledge(owner_id,topic,summary,source_url,source_name,published_at,source_status,last_checked_at) VALUES($1,$2,$3,$4,$5,'','available',CASE WHEN $4<>'' THEN now() ELSE NULL END) RETURNING id,topic,summary,source_url,source_name,created_at",[owner,topic,summary,sourceUrl,sourceName]);
    const row=saved.rows[0];
    const persisted=(await db.query('SELECT id,topic,summary,source_url,source_name,created_at FROM ultron_knowledge WHERE id=$1 AND owner_id=$2',[row.id,owner])).rows[0];
    if(!persisted||persisted.topic!==topic||persisted.summary!==summary||persisted.source_url!==sourceUrl) throw new Error('Learning was written but its persisted contents could not be independently checked.');
    return {saved:true,operationVerified:true,verified:true,verificationType:'knowledge_persistence',knowledge:persisted,sourceReachable:!!sourceUrl,factualAccuracyVerified:false,note:'The knowledge record was read back successfully. Its factual claims have not been independently established.'};
  }
  throw new Error('Unsupported agent step type.');
}
export default async function(req,res) {
  const requested=String(req.body?.runId||'');
  let run;
  if(requested) {
    run=(await db.query("UPDATE ultron_agent_runs SET status='running',attempts=attempts+1,lease_until=now()+interval '4 minutes',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 AND status='queued' RETURNING id,owner_id,title,objective,status,attempts",[requested])).rows[0];
    if(!run) {
      run=(await db.query("SELECT id,owner_id,title,objective,status,attempts FROM ultron_agent_runs WHERE id=$1 AND status='running' AND lease_until<now() LIMIT 1",[requested])).rows[0];
      if(run) run=(await db.query("UPDATE ultron_agent_runs SET attempts=attempts+1,lease_until=now()+interval '4 minutes',updated_at=now() WHERE id=$1 AND status='running' RETURNING id,owner_id,title,objective,status,attempts",[requested])).rows[0];
    }
  } else {
    run=(await db.query("UPDATE ultron_agent_runs SET status='running',attempts=attempts+1,lease_until=now()+interval '4 minutes',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=(SELECT id FROM ultron_agent_runs WHERE status='queued' OR (status='running' AND lease_until<now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,owner_id,title,objective,status,attempts")).rows[0];
  }
  if(!run) return res.json({ok:true,processed:false,note:'No eligible agent run was found.'});
  await db.query("UPDATE ultron_agent_steps SET status='pending' WHERE run_id=$1 AND owner_id=$2 AND status='running' AND started_at<now()-interval '4 minutes'",[run.id,run.owner_id]);
  const steps=(await db.query("SELECT id,position,step_type,title,input FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND status='pending' ORDER BY position LIMIT 3",[run.id,run.owner_id])).rows;
  let completed=0, failed=0;
  for(const step of steps) {
    const state=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
    if(!state||state.status==='cancelled') break;
    const claim=await db.query("UPDATE ultron_agent_steps SET status='running',attempts=attempts+1,started_at=now(),error='' WHERE id=$1 AND owner_id=$2 AND status='pending' RETURNING id",[step.id,run.owner_id]);
    if(!claim.rows.length) continue;
    try {
      const result=await executeStep(step,run.owner_id,run.id);
      await db.query("UPDATE ultron_agent_steps SET status='completed',result=$3::jsonb,completed_at=now(),error='' WHERE id=$1 AND owner_id=$2",[step.id,run.owner_id,JSON.stringify(result)]);
      completed++;
    } catch(e) {
      const message=String(e?.message||e).slice(0,500);
      await db.query("UPDATE ultron_agent_steps SET status='failed',error=$3,completed_at=now() WHERE id=$1 AND owner_id=$2",[step.id,run.owner_id,message]);
      await db.query("UPDATE ultron_agent_runs SET status='failed',error=$3,lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id,'Step '+step.position+' failed: '+message]);
      await db.query("INSERT INTO ultron_agent_lessons(owner_id,lesson_key,lesson,evidence,confidence,status) VALUES($1,$2,$3,$4::jsonb,0.65,'candidate') ON CONFLICT(owner_id,lesson_key) DO NOTHING",[run.owner_id,run.id+':'+step.position,'Observed failure pattern: the '+String(step.step_type)+' step "'+String(step.title).slice(0,140)+'" failed. Review the recorded error and adjust the plan or inputs before retrying; do not assume the same attempt will succeed.',JSON.stringify({runId:run.id,stepId:step.id,position:step.position,stepType:step.step_type,status:'failed',verified:false,error:message})]);
      failed++;
      break;
    }
  }
  const current=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
  if(current?.status==='cancelled') return res.json({ok:true,runId:run.id,status:'cancelled',completedSteps:completed});
  if(current?.status==='failed') return res.json({ok:false,runId:run.id,status:'failed',completedSteps:completed,failedSteps:failed});
  const counts=(await db.query("SELECT COUNT(*) FILTER (WHERE status='pending')::int AS pending,COUNT(*) FILTER (WHERE status='failed')::int AS failed,COUNT(*) FILTER (WHERE status='completed')::int AS completed,COUNT(*) FILTER (WHERE status='completed' AND (COALESCE((result->>'operationVerified')::boolean,false)=true OR COALESCE((result->>'verified')::boolean,false)=true))::int AS verified FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
  const lessonSteps=(await db.query("SELECT id,position,step_type,title,status,result,error FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND (status='failed' OR (status='completed' AND (COALESCE((result->>'operationVerified')::boolean,false)=true OR COALESCE((result->>'verified')::boolean,false)=true))) ORDER BY position",[run.id,run.owner_id])).rows;
  for(const item of lessonSteps) {
    const isFailure=item.status==='failed';
    const lesson=isFailure
      ? 'Observed failure pattern: the '+String(item.step_type)+' step "'+String(item.title).slice(0,140)+'" failed. Review the recorded error and adjust the plan or inputs before retrying; do not assume the same attempt will succeed.'
      : 'Observed operationally verified outcome: the '+String(item.step_type)+' step "'+String(item.title).slice(0,140)+'" passed its explicit '+String((item.result||{}).verificationType||'')+' operation check. This does not establish factual accuracy; re-check when inputs or environment change.';
    const evidence={runId:run.id,stepId:item.id,position:item.position,stepType:item.step_type,status:item.status,operationVerified:!isFailure,verified:!!((item.result||{}).verified),factualAccuracyVerified:false,error:isFailure?String(item.error||'').slice(0,500):'',resultType:String((item.result||{}).verificationType||'')};
    await db.query("INSERT INTO ultron_agent_lessons(owner_id,lesson_key,lesson,evidence,confidence,status) VALUES($1,$2,$3,$4::jsonb,$5,'candidate') ON CONFLICT(owner_id,lesson_key) DO NOTHING",[run.owner_id,run.id+':'+item.position,lesson,JSON.stringify(evidence),isFailure?0.65:0.55]);
  }
  if(counts.pending===0&&counts.failed===0) {
    const fullyOperationallyVerified=counts.completed>0&&counts.verified===counts.completed;
    const summary={stepsCompleted:counts.completed,stepsVerified:counts.verified,verifiedWork:fullyOperationallyVerified,verificationStatus:fullyOperationallyVerified?'operationally_verified':'partial',verificationScope:'operation_checks_only',factualAccuracyVerified:false,completedAt:new Date().toISOString()};
    await db.query("UPDATE ultron_agent_runs SET status='completed',result=$3::jsonb,error='',lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running'",[run.id,run.owner_id,JSON.stringify(summary)]);
    return res.json({ok:true,runId:run.id,status:'completed',stepsCompleted:counts.completed,stepsVerified:counts.verified,verificationStatus:summary.verificationStatus,factualAccuracyVerified:false});
  }
  await db.query("UPDATE ultron_agent_runs SET status='queued',lease_until=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running'",[run.id,run.owner_id]);
  try { await scheduler.at(new Date(Date.now()+60000),ROUTE,{payload:{runId:run.id},name:'ultron-agent-'+run.id}); }
  catch(e) { return res.json({ok:true,runId:run.id,status:'queued',completedSteps:completed,resumeScheduled:false,note:'The hourly recovery worker will resume this run.'}); }
  return res.json({ok:true,runId:run.id,status:'queued',completedSteps:completed,resumeScheduled:true});
}