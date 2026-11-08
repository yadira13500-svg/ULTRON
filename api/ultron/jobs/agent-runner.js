import { db, scheduler } from 'hatchable';
import { analyzeClaimEvidence } from 'lib/claims.js';
import { verifyOutcome } from 'lib/outcome.js';
import { searchResearchSources } from 'lib/research-stack.js';
import { classifyStepFailure, dependenciesSatisfied, runParallel, specialistRoleForStep, specialistCapabilitiesForRole, shouldRecoverRunningStep, isMissionActive, MAX_SPECIALIST_CONCURRENCY } from 'lib/mission-runtime.js';
import { verifyStepResult, buildRevisionRequest } from 'lib/specialist-verifier.js';
import { buildMissionCoordinationReport } from 'lib/mission-coordinator.js';
import { createLessonObservationEvents, assignLessonExperiment, createExperimentObservationEvent, applyApprovedStrategyPolicy } from 'lib/learning-evaluation.js';
import { matchesTaskReplay, matchesKnowledgeReplay, matchesSkillApplicationReplay } from 'lib/mission-idempotency.js';
import { decideRecoveryAction, recoveryEventKey } from 'lib/recovery-controller.js';

export const access = 'scheduler';
export const methods = ['POST'];
const ROUTE='/api/ultron/jobs/agent-runner';
const safeUrl = value => {
  try {
    const u=new URL(String(value||'')), h=u.hostname.toLowerCase();
    if(u.protocol!=='https:'||!h||u.username||u.password||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||
      /^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h)||/^169\.254\./.test(h)||/^0\./.test(h)||/^224\./.test(h)||h==='::1'||h.startsWith('[')) return null;
    return u;
  } catch { return null; }
};
async function verifyUrl(value) {
  let u=safeUrl(value);
  if(!u) return {verified:false,error:'Only public HTTPS sources can be verified.'};
  let r=await fetch(u.toString(),{method:'HEAD',redirect:'manual',timeout_ms:10000,headers:{'User-Agent':'ULTRON-Agent/1.0'}});
  if(r.status===405||r.status===501) r=await fetch(u.toString(),{method:'GET',redirect:'manual',timeout_ms:10000,headers:{'Range':'bytes=0-0','User-Agent':'ULTRON-Agent/1.0'}});
  if(r.status>=300&&r.status<400) {
    const loc=r.headers.get('location'), next=loc?safeUrl(new URL(String(loc),u.toString()).toString()):null;
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
async function executeStep(step, owner, runId, approvedLessons=[]) {
  const active=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[runId,owner])).rows[0];
  if(!isMissionActive(active?.status)) throw new Error('Mission cancelled before specialist operation.');
  const input=step.input||{};
  const lessonUses=[];
  if(step.step_type==='retrieve_source') {
    for(const lesson of approvedLessons) {
      const ev=lesson.evidence||{};
      if(ev.stepType!=='retrieve_source'||!String(ev.error||'').includes('HTTP 403')||!ev.stepId)continue;
      const prior=(await db.query('SELECT input FROM ultron_agent_steps WHERE id=$1 AND owner_id=$2',[ev.stepId,owner])).rows[0];
      if(prior?.input?.url&&String(prior.input.url)===String(input.url||''))throw new Error('Approved learning blocked an unchanged retry: this exact source URL previously returned HTTP 403. Choose a different accessible source URL; do not repeat the same request.');
    }
    if(approvedLessons.some(x=>x.evidence?.stepType==='retrieve_source'))lessonUses.push({type:'failure_avoidance',detail:'Checked prior approved retrieval-failure lessons before fetching; unchanged previously forbidden URLs are not retried.'});
  }
  if(step.step_type==='assess_claim') {
    const priorReview=approvedLessons.find(x=>x.evidence?.kind==='human_claim_review'&&String(x.evidence?.claim||'').trim().toLowerCase()===String(input.claim||'').trim().toLowerCase());
    if(priorReview)lessonUses.push({type:'case_specific_human_review',lessonId:priorReview.id,reviewStatus:priorReview.evidence.reviewStatus,machineVerified:false,detail:'A prior human review exists for this exact claim; it is historical context only and does not replace fresh source checks or owner review.'});
  }
  if(step.step_type==='skill_apply') {
    const task=String(input.task_description||'').trim().slice(0,2000),metric=String(input.metric_label||'').trim().slice(0,120),baseline=Number(input.baseline_value),baselineEvidence=String(input.baseline_evidence||'').trim().slice(0,2000),direction=['higher_is_better','lower_is_better'].includes(input.metric_direction)?input.metric_direction:'higher_is_better';
    if(!task||!metric||!Number.isFinite(baseline)||baselineEvidence.length<12) throw new Error('Skill application requires a practical task, numeric baseline, and a substantive note describing how the baseline was measured.');
    const expected={skillId:input.skill_id,runId,task,metric,direction,baseline,baselineEvidence};
    // Check the durable record before checking current skill status: a previously
    // successful write must remain replayable even if its lifecycle later changes.
    const prior=(await db.query('SELECT a.id,a.skill_id,a.run_id,a.task_description,a.metric_label,a.metric_direction,a.baseline_value,a.baseline_evidence,a.status,a.created_at,s.title AS skill_title,s.concepts_json,s.objectives_json FROM ultron_skill_applications a LEFT JOIN ultron_skill_modules s ON s.id=a.skill_id AND s.owner_id=a.owner_id WHERE a.owner_id=$1 AND a.agent_step_id=$2',[owner,step.id])).rows[0];
    if(prior) {
      if(!matchesSkillApplicationReplay(prior,expected)) throw new Error('A prior skill-application write exists for this mission step but its immutable inputs differ. ULTRON preserved the original record and blocked an overwrite.');
      return {application:prior,created:false,idempotentReplay:true,skillTitle:prior.skill_title||'Previously applied skill',operationVerified:true,verified:true,verificationType:'skill_application_persistence',note:'The original skill-application record was read back and preserved; its current lifecycle status was not reset.'};
    }
    const skill=(await db.query("SELECT id,title,concepts_json,objectives_json FROM ultron_skill_modules WHERE id=$1 AND owner_id=$2 AND status='mastered'",[input.skill_id,owner])).rows[0];
    if(!skill) throw new Error('Skill is no longer owner-reviewed as mastered; a new application was blocked.');
    const inserted=await db.query("INSERT INTO ultron_skill_applications(owner_id,skill_id,run_id,agent_step_id,task_description,metric_label,metric_direction,baseline_value,baseline_evidence,status) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,'awaiting_outcome' WHERE EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$3 AND owner_id=$1 AND status='running') ON CONFLICT(owner_id,agent_step_id) WHERE agent_step_id IS NOT NULL DO NOTHING RETURNING id,skill_id,run_id,task_description,metric_label,metric_direction,baseline_value,baseline_evidence,status,created_at",[owner,skill.id,runId,step.id,task,metric,direction,baseline,baselineEvidence]);
    const application=inserted.rows[0]||(await db.query('SELECT id,skill_id,run_id,task_description,metric_label,metric_direction,baseline_value,baseline_evidence,status,created_at FROM ultron_skill_applications WHERE owner_id=$1 AND agent_step_id=$2',[owner,step.id])).rows[0];
    const check=application?(await db.query('SELECT id,skill_id,run_id,task_description,metric_label,metric_direction,baseline_value,baseline_evidence,status FROM ultron_skill_applications WHERE id=$1 AND owner_id=$2',[application.id,owner])).rows[0]:null;
    if(!matchesSkillApplicationReplay(check,expected)) throw new Error('Skill application record was not persisted with the exact expected mission-step identity and immutable values.');
    return {application:check,created:!!inserted.rows[0],idempotentReplay:!inserted.rows[0],skillTitle:skill.title,conceptsConsulted:Array.isArray(skill.concepts_json)?skill.concepts_json.length:0,objectivesConsulted:Array.isArray(skill.objectives_json)?skill.objectives_json.length:0,operationVerified:true,verified:true,verificationType:'skill_application_persistence',note:'A mastered skill is linked to this mission. Record a comparable post-task metric after the practical work to measure change.'};
  }
  if(step.step_type==='research_search') {
    const data=await searchResearchSources(String(input.query),'WORLD',{includeScholarly:true});
    const all=(data.results||[]).filter(x=>x&&x.title&&x.url);
    const web=all.filter(x=>x.source_kind!=='scholarly_index'), scholarly=all.filter(x=>x.source_kind==='scholarly_index');
    const selected=[...web.slice(0,5),...scholarly.slice(0,3)];
    for(const item of all)if(selected.length<8&&!selected.includes(item))selected.push(item);
    const results=selected.slice(0,8).map(x=>({title:String(x.title).slice(0,240),url:String(x.url).slice(0,1000),snippet:String(x.snippet||'').slice(0,1200),publisher:String(x.publisher||x.source||'').slice(0,160),source_kind:x.source_kind||'web',kind:x.kind||null,doi:x.doi||null,published_at:x.published_at||''}));
    return {query:input.query,results,source:data.source,retrievedAt:data.retrievedAt||data.fetched_at,research_coverage:data.research_coverage||{},operationVerified:results.length>0,verified:false,note:results.length?'Search results are leads, not verified facts. Web and scholarly leads are retained separately; source capture, passage comparison and human review are still required.':'The free public and scholarly search sources returned no useful result for this query; no result was invented.'};
  }
  if(step.step_type==='verify_url') {
    const result=await verifyUrl(input.url);
    if(!result.reachable) throw new Error('Source reachability check failed: HTTP '+(result.status||'unavailable')+'. '+(result.error||''));
    return result;
  }
  if(step.step_type==='retrieve_source') {
    let u=safeUrl(input.url);
    if(!u) throw new Error('Only public HTTPS sources can be retrieved.');
    // Public HTTPS sources are accepted after URL validation; avoid a hard-coded publisher allowlist.
    let r;
    try { try { r=await fetch(u.toString(),{method:'GET',redirect:'manual',timeout_ms:12000,headers:{'Range':'bytes=0-262143','Accept':'text/html,text/plain,application/xhtml+xml','User-Agent':'ULTRON-Agent/1.0'}}); }
      catch(e) { throw new Error('Redirect target HTTP request failed before body processing: '+String(e?.message||e).slice(0,160)); } }
    catch(e) { throw new Error('Source HTTP request failed before body processing: '+String(e?.message||e).slice(0,160)); }
    if(r.status>=300&&r.status<400) {
      const loc=r.headers.get('location'), next=loc?safeUrl(new URL(loc,u).toString()):null;
      if(!next) throw new Error('Redirect target was not accepted as a public HTTPS source.');
      u=next;
      r=await fetch(u.toString(),{method:'GET',redirect:'manual',timeout_ms:12000,headers:{'Range':'bytes=0-262143','Accept':'text/html,text/plain,application/xhtml+xml','User-Agent':'ULTRON-Agent/1.0'}});
    }
    if(!r.ok) throw new Error('Source content retrieval failed: HTTP '+r.status+'.');
    const type=String(r.headers.get('content-type')||'').toLowerCase();
    if(!(type.includes('text/html')||type.includes('text/plain')||type.includes('application/xhtml+xml'))) throw new Error('Unsupported source content type; only HTML and plain text are accepted.');
    const declared=Number(r.headers.get('content-length')||0);
    if(declared>1048576) throw new Error('Source is larger than the 1 MB retrieval limit.');
    let responseText='';
    try { responseText=await r.clone().text(); } catch {}
    if(typeof responseText!=='string'||!responseText) {
      try { responseText=new TextDecoder('utf-8').decode(await r.arrayBuffer()); }
      catch(e) { throw new Error('Source body could not be decoded safely: '+String(e?.message||e).slice(0,160)); }
    }
    // Some documentation sites place the article after a large navigation shell; retain enough HTML to reach the main content while respecting the 1 MB declared-size guard above.
    const truncated=responseText.length>500000;
    const raw=responseText.slice(0,500000);
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
    // Remove inline CSS before stripping tags; otherwise style="..." attributes leak into the excerpt and can crowd out article text.
    let cleaned=raw.replace(/\sstyle=(['"])[\s\S]*?\1/gi,' ');
    const pageLower=cleaned.toLowerCase();
    const mainStart=pageLower.indexOf('<main'), articleStart=pageLower.indexOf('<article');
    const mainIdMatch=cleaned.match(/<[^>]+\bid\s*=\s*["']main["'][^>]*>/i);
    const mainIdStart=mainIdMatch?cleaned.indexOf(mainIdMatch[0]):-1;
    const contentStart=mainStart>=0?mainStart:articleStart>=0?articleStart:mainIdStart;
    if(contentStart>=0) cleaned=cleaned.slice(contentStart);
    for(const name of ['style','script','noscript','nav','header','footer','aside']) {
      let lower=cleaned.toLowerCase(), start=lower.indexOf('<'+name);
      while(start>=0) { const open=lower.indexOf('>',start), end=open>=0?lower.indexOf('</'+name+'>',open):-1; if(open<0||end<0)break; cleaned=cleaned.slice(0,start)+cleaned.slice(end+name.length+3); lower=cleaned.toLowerCase(); start=lower.indexOf('<'+name); }
    }
    let plain='', tag=false;
    for(let i=0;i<cleaned.length&&plain.length<20000;i++){const ch=cleaned[i];if(ch==='<'){tag=true;continue;}if(ch==='>'){tag=false;plain+=' ';continue;}if(!tag)plain+=ch;}
    const excerpt=plain.replaceAll('&nbsp;',' ').replaceAll('&amp;','&').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replace(/\s+/g,' ').trim().slice(0,14000);
    if(!excerpt) throw new Error('No readable page text was extracted.');
    const visiblePublished=excerpt.match(/(?:Published|Publication date)\s*:\s*([A-Z][a-z]+\s+\d{4}(?:-\d{2}-\d{2})?)/);
    const visibleModified=excerpt.match(/(?:Last updated|Modified)\s*:\s*([A-Z][a-z]+\s+\d{4}(?:-\d{2}-\d{2})?)/);
    const publicationDate=dateRecord(published)||(visiblePublished?dateRecord({value:visiblePublished[1],field:'visible_text_label:published'}):null);
    const modifiedDate=dateRecord(modified)||(visibleModified?dateRecord({value:visibleModified[1],field:'visible_text_label:modified'}):null);
    return {retrieved:true,operationVerified:true,verified:false,verificationType:'source_content_capture',url:u.toString(),canonicalUrl,title:title.slice(0,240),publisher:publisher?.value||null,description:description?.value||null,publicationDate,modifiedDate,httpStatus:r.status,contentType:type,excerpt,truncated,retrievedAt:new Date().toISOString(),lessonUses,evidenceLimit:'Publication metadata is page-declared and may be absent or inaccurate; retrieval time is not publication time. A captured excerpt is source evidence, not proof that its claims are accurate or independent.'};
  }
  if(step.step_type==='assess_claim') {
    const claim=String(input.claim||'').trim().slice(0,600);
    const urls=Array.isArray(input.source_urls)?input.source_urls:[];
    if(!claim||urls.length<2||urls.length>4) throw new Error('Claim assessment requires one claim and 2–4 captured sources.');
    const prior=(await db.query("SELECT result FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND step_type='retrieve_source' AND status='completed' ORDER BY position",[runId,owner])).rows.map(x=>x.result||{});
    const evidence=urls.map(url=>prior.find(x=>x.url===url&&x.retrieved===true&&x.verificationType==='source_content_capture')).filter(Boolean);
    if(evidence.length!==urls.length) throw new Error('Every source must be captured successfully before claim assessment.');
    const stop=new Set(['about','after','again','against','also','among','and','are','because','been','being','between','but','can','could','did','does','doing','during','each','for','from','had','has','have','into','its','may','more','most','not','of','other','over','same','should','some','such','than','that','the','their','there','these','they','this','those','through','to','under','very','was','were','what','when','where','which','while','with','would','your']);
    const terms=[...new Set((claim.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(x=>!stop.has(x)))];
    const matches=evidence.map(source=>{
      const sentences=String(source.excerpt||'').split(/(?<=[.!?])\s+/).slice(0,180);
      let best={sentence:'',overlap:0,matchedTerms:[]};
      for(const sentence of sentences){const words=new Set((sentence.toLowerCase().match(/[a-z0-9]{3,}/g)||[]).filter(x=>!stop.has(x)));const hit=terms.filter(x=>words.has(x));const ratio=terms.length?hit.length/terms.length:0;if(ratio>best.overlap)best={sentence:sentence.slice(0,700),overlap:Number(ratio.toFixed(3)),matchedTerms:hit};}
      let host='';try{host=new URL(source.url).hostname.toLowerCase().replace(/^www\./,'')}catch{}
      return {title:source.title||'',url:source.url,canonicalUrl:source.canonicalUrl||null,publisher:source.publisher||null,publicationDate:source.publicationDate||null,modifiedDate:source.modifiedDate||null,httpStatus:source.httpStatus||null,contentType:source.contentType||null,truncated:source.truncated===true,host,excerptCandidate:best.sentence,termOverlap:best.overlap,matchedTerms:best.matchedTerms,retrievedAt:source.retrievedAt||null};
    });
    const domains=[...new Set(matches.map(x=>x.host).filter(Boolean))];
    const registrableDomain=host=>{
      const parts=String(host||'').toLowerCase().replace(/^www\./,'').split('.').filter(Boolean);
      if(parts.length<=2)return parts.join('.');
      const compound=new Set(['co.uk','org.uk','com.au','co.nz','co.ke','com.br','co.jp','com.sg']);
      const suffix=parts.slice(-2).join('.');
      return compound.has(suffix)?parts.slice(-3).join('.'):parts.slice(-2).join('.');
    };
    const normalizedText=s=>String(s||'').toLowerCase().replace(/https?:\/\/\S+/g,' ').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
    const publisherKey=s=>{
      const p=String(s.publisher||'').toLowerCase().trim();
      return p? p.replace(/\s+(inc|llc|ltd|limited|corporation|corp)\.?$/,''):registrableDomain(s.host);
    };
    const sourceGroups=new Map();
    for(const source of matches){const key=publisherKey(source);if(!sourceGroups.has(key))sourceGroups.set(key,[]);sourceGroups.get(key).push(source.url);}
    const independentPublisherCount=sourceGroups.size;
    const similarity=(a,b)=>{
      const aa=new Set(normalizedText(a).split(' ').filter(x=>x.length>3)),bb=new Set(normalizedText(b).split(' ').filter(x=>x.length>3));
      if(!aa.size||!bb.size)return 0;let overlap=0;for(const x of aa)if(bb.has(x))overlap++;
      return Number((overlap/(aa.size+bb.size-overlap)).toFixed(3));
    };
    const negation=new RegExp('\\b(no|not|never|neither|without|failed|declined|decreased|fell|denied|false)\\b','i');
    const contradictionCandidates=[];
    for(let i=0;i<matches.length;i++)for(let j=i+1;j<matches.length;j++){
      const a=matches[i],b=matches[j],sa=a.excerptCandidate,sb=b.excerptCandidate;
      const shared=similarity(sa,sb);
      const numsA=(sa.match(/\b\d+(?:\.\d+)?%?\b/g)||[]),numsB=(sb.match(/\b\d+(?:\.\d+)?%?\b/g)||[]);
      const numericConflict=numsA.length&&numsB.length&&numsA.some(n=>!numsB.includes(n))&&numsB.some(n=>!numsA.includes(n));
      const polarityConflict=negation.test(sa)!==negation.test(sb);
      if(shared>=0.12&&(numericConflict||polarityConflict))contradictionCandidates.push({sourceA:a.url,sourceB:b.url,excerptA:sa,excerptB:sb,sharedLanguageScore:shared,possibleNumericConflict:!!numericConflict,possiblePolarityConflict:!!polarityConflict,reviewRequired:true});
    }
    const candidates=matches.filter(x=>x.termOverlap>=0.35&&x.matchedTerms.length>=3);
    const assessment={claim,operationVerified:true,assessmentStatus:candidates.length>=2&&independentPublisherCount>=2?'evidence_candidates_found':'insufficient_evidence',distinctHostnameCount:domains.length,independentPublisherCount,sourceCount:matches.length,evidenceCandidates:candidates,allSources:matches,sourceIndependence:{publisherGroups:[...sourceGroups.entries()].map(([publisher,urls])=>({publisher,sourceCount:urls.length,urls})),note:'Publisher labels and registrable domains are heuristic signals, not proof of editorial independence or ownership.'},contradictionCandidates,verified:false,verificationType:'independent_source_and_contradiction_screen',method:'Deterministic evidence screen: claim-term overlap, publisher/domain grouping, excerpt similarity, and possible polarity/numeric conflicts. It does not establish entailment, causation, or truth; contradiction candidates require human inspection.',nextAction:'Inspect each quoted passage, publisher ownership, original reporting versus syndication, dates, and possible contradiction candidates. A human reviewer must decide.'};
    const deep=analyzeClaimEvidence(claim,evidence);
    assessment.deepAnalysis=deep;
    assessment.assessmentStatus=deep.status;
    assessment.independentPublisherCount=deep.independence.independentGroupCount;
    assessment.verificationType='independent_source_contradiction_freshness_screen';
    assessment.contradictionCandidates=[...assessment.contradictionCandidates,...deep.perSource.filter(x=>x.stance==='contradicts_candidate').map(x=>({source:x.url,excerpt:x.excerpt,signals:x.signals,reviewRequired:true}))];
    assessment.method='Deterministic evidence screen: per-source stance (supports / contradicts / unclear), negation, direction and number conflicts, source-independence grouping (shared domain, publisher, canonical page, copied phrasing, common wire attribution), freshness and provenance. It does not establish entailment, causation or truth; a human reviewer decides.';
    assessment.nextAction=deep.reasons.length?deep.reasons.join(' ')+' Inspect each quoted passage and decide.':'Inspect each quoted passage, original reporting versus syndication, dates and any contradiction candidates. A human reviewer must decide.';
    const reviewSave=await db.query("INSERT INTO ultron_claim_reviews(owner_id,run_id,step_id,claim_text,assessment_status,method,assessment) SELECT $1,$2,$3,$4,$5,$6,$7::jsonb WHERE EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$2 AND owner_id=$1 AND status='running') ON CONFLICT(owner_id,step_id) DO UPDATE SET claim_text=EXCLUDED.claim_text,assessment_status=EXCLUDED.assessment_status,method=EXCLUDED.method,assessment=EXCLUDED.assessment WHERE ultron_claim_reviews.review_status='pending' RETURNING id,review_status",[owner,runId,step.id,claim,assessment.assessmentStatus,assessment.method,JSON.stringify(assessment)]);
    if(!reviewSave.rowCount) {
      const existing=(await db.query('SELECT id,review_status,reviewer_note,correction FROM ultron_claim_reviews WHERE owner_id=$1 AND step_id=$2',[owner,step.id])).rows[0];
      return {...assessment,reviewRecordCreated:false,reviewStatus:existing?.review_status||'reviewed',reviewPreserved:true,reviewerDecisionPreserved:!!existing?.reviewer_note||!!existing?.correction,lessonUses,note:'A prior human review exists for this assessment step. Its decision and rationale were preserved; a retry cannot reset it to pending.'};
    }
    return {...assessment,reviewRecordCreated:true,reviewStatus:reviewSave.rows[0].review_status||'pending',lessonUses};
  }
  if(step.step_type==='create_task') {
    const title=String(input.title||'').trim(), body=String(input.body||'').trim();
    const inserted=await db.query("INSERT INTO ultron_items(owner_id,kind,title,body,status,agent_step_id) SELECT $1,'task',$2,$3,'open',$4 WHERE EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$5 AND owner_id=$1 AND status='running') ON CONFLICT(owner_id,agent_step_id) WHERE agent_step_id IS NOT NULL DO NOTHING RETURNING id,title,kind,status,created_at",[owner,title,body,step.id,runId]);
    const saved=inserted.rows[0]||(await db.query('SELECT id,title,kind,status,created_at FROM ultron_items WHERE owner_id=$1 AND agent_step_id=$2',[owner,step.id])).rows[0];
    const check=saved?(await db.query('SELECT id,title,body,kind,status FROM ultron_items WHERE id=$1 AND owner_id=$2',[saved.id,owner])).rows[0]:null;
    if(!matchesTaskReplay(check,{title,body})) throw new Error('A task record exists for this mission step but its immutable title/body do not match. ULTRON preserved the original record and blocked an overwrite.');
    return {created:!!inserted.rows[0],idempotentReplay:!inserted.rows[0],operationVerified:true,verified:true,item:check};
  }
  if(step.step_type==='save_learning') {
    const sourceUrl=String(input.source_url||'');
    let sourceName='Owner-provided', capturedSource=null;
    if(sourceUrl) {
      const prior=(await db.query("SELECT result FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND step_type='retrieve_source' AND status='completed' ORDER BY position DESC",[runId,owner])).rows;
      capturedSource=prior.map(x=>x.result||{}).find(x=>x.url===sourceUrl&&x.retrieved===true&&x.verificationType==='source_content_capture')||null;
      if(!capturedSource) throw new Error('This source has not had its content captured in this run. Add a retrieve_source step for the same URL before saving sourced learning.');
      sourceName=new URL(sourceUrl).hostname.slice(0,160);
    }
    const topic=String(input.topic||'').trim().slice(0,240);
    const suppliedSummary=String(input.summary||'').trim();
    const summary=(suppliedSummary|| (capturedSource?'Extractive source note (not independently verified): '+String(capturedSource.title||'')+'. '+String(capturedSource.excerpt||'').slice(0,2700):'')).slice(0,3000);
    if(!topic||!summary) throw new Error('Learning needs a topic and either a summary or a previously captured source excerpt.');
    const saved=await db.query("INSERT INTO ultron_knowledge(owner_id,topic,summary,source_url,source_name,published_at,source_status,last_checked_at,agent_step_id) SELECT $1,$2,$3,$4,$5,'','available',CASE WHEN $4<>'' THEN now() ELSE NULL END,$6 WHERE EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$7 AND owner_id=$1 AND status='running') ON CONFLICT(owner_id,agent_step_id) WHERE agent_step_id IS NOT NULL DO NOTHING RETURNING id,topic,summary,source_url,source_name,created_at",[owner,topic,summary,sourceUrl,sourceName,step.id,runId]);
    const row=saved.rows[0]||(await db.query('SELECT id,topic,summary,source_url,source_name,created_at FROM ultron_knowledge WHERE owner_id=$1 AND agent_step_id=$2',[owner,step.id])).rows[0];
    const persisted=row?(await db.query('SELECT id,topic,summary,source_url,source_name,created_at FROM ultron_knowledge WHERE id=$1 AND owner_id=$2',[row.id,owner])).rows[0]:null;
    if(!matchesKnowledgeReplay(persisted,{topic,summary,sourceUrl,sourceName})) throw new Error('A knowledge record exists for this mission step but its immutable content/source fields do not match. ULTRON preserved the original record and blocked an overwrite.');
    return {saved:!!saved.rows[0],idempotentReplay:!saved.rows[0],operationVerified:true,verified:true,verificationType:'knowledge_persistence',knowledge:persisted,sourceReachable:!!sourceUrl,factualAccuracyVerified:false,note:'The knowledge record was read back successfully. Its factual claims have not been independently established.'};
  }
  throw new Error('Unsupported agent step type.');
}
export default async function(req,res) {
  const requested=String(req.body?.runId||'');
  let run;
  if(requested) {
    run=(await db.query("UPDATE ultron_agent_runs SET status='running',attempts=attempts+1,lease_until=now()+interval '10 minutes',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=$1 AND status='queued' RETURNING id,owner_id,title,objective,status,attempts",[requested])).rows[0];
    if(!run) {
      run=(await db.query("UPDATE ultron_agent_runs SET attempts=attempts+1,lease_until=now()+interval '4 minutes',updated_at=now() WHERE id=$1 AND status='running' AND lease_until<now() RETURNING id,owner_id,title,objective,status,attempts",[requested])).rows[0];
    }
  } else {
    run=(await db.query("UPDATE ultron_agent_runs SET status='running',attempts=attempts+1,lease_until=now()+interval '4 minutes',started_at=COALESCE(started_at,now()),updated_at=now() WHERE id=(SELECT id FROM ultron_agent_runs WHERE status='queued' OR (status='running' AND lease_until<now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id,owner_id,title,objective,status,attempts")).rows[0];
  }
  if(!run) return res.json({ok:true,processed:false,note:'No eligible agent run was found.'});
  // A crash can occur after the step result commits but before its execution-task
  // ledger row is finalized. The step is authoritative: reconcile that ledger first.
  await db.query("UPDATE ultron_specialist_tasks t SET status='completed',output=s.result,lease_until=NULL,error='',updated_at=now(),completed_at=COALESCE(t.completed_at,s.completed_at,now()) FROM ultron_agent_steps s WHERE t.run_id=s.run_id AND t.owner_id=s.owner_id AND t.step_id=s.id AND t.phase='execution' AND t.status IN ('pending','running') AND s.status='completed' AND s.result IS NOT NULL",[]);
  await db.query("UPDATE ultron_specialist_tasks SET status='pending',lease_until=NULL,error='Recovered after specialist lease expiry.',updated_at=now() WHERE run_id=$1 AND owner_id=$2 AND status='running' AND lease_until<now()",[run.id,run.owner_id]);
  const activeSpecialists=(await db.query("SELECT MAX(lease_until) AS latest_lease FROM ultron_specialist_tasks WHERE run_id=$1 AND owner_id=$2 AND phase='execution' AND status='running' AND lease_until>now()",[run.id,run.owner_id])).rows[0];
  if(activeSpecialists?.latest_lease) {
    await db.query("UPDATE ultron_agent_runs SET lease_until=GREATEST($3::timestamptz,now())+interval '1 minute',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts="+Number(run.attempts),[run.id,run.owner_id,activeSpecialists.latest_lease]);
    const key=recoveryEventKey(run.id,null,'wait',run.attempts);
    await db.query("INSERT INTO ultron_recovery_events(owner_id,run_id,event_key,action,reason,attempt,snapshot) VALUES($1,$2,$3,'wait',$4,$5,$6::jsonb) ON CONFLICT(owner_id,event_key) DO NOTHING",[run.owner_id,run.id,key,'A specialist still holds a valid execution lease; the controller deferred recovery.',run.attempts,JSON.stringify({latestActiveLease:activeSpecialists.latest_lease})]);
    return res.json({ok:true,processed:false,runId:run.id,status:'running',waitingForActiveSpecialists:true,recoveryAction:'wait',note:'A prior specialist still holds a valid execution lease. ULTRON preserved its running step and will resume only after that lease expires or the specialist completes.'});
  }
  const runningSteps=(await db.query("SELECT s.id,s.status,s.started_at,s.step_type,s.error,s.attempts,EXISTS(SELECT 1 FROM ultron_specialist_tasks t WHERE t.run_id=s.run_id AND t.owner_id=s.owner_id AND t.step_id=s.id AND t.phase='execution' AND t.status='pending') AS has_pending_execution_task,EXISTS(SELECT 1 FROM ultron_specialist_tasks t WHERE t.run_id=s.run_id AND t.owner_id=s.owner_id AND t.step_id=s.id AND t.phase='execution' AND t.status='running' AND t.lease_until>now()) AS has_active_execution_task FROM ultron_agent_steps s WHERE s.run_id=$1 AND s.owner_id=$2 AND s.status='running'",[run.id,run.owner_id])).rows;
  for(const candidate of runningSteps) {
    if(!shouldRecoverRunningStep(candidate)) continue;
    const decision=decideRecoveryAction({step:candidate,activeLease:false,attempts:candidate.attempts,failure:candidate.error});
    const key=recoveryEventKey(run.id,candidate.id,decision.action,candidate.attempts);
    await db.query("INSERT INTO ultron_recovery_events(owner_id,run_id,step_id,event_key,action,reason,attempt,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT(owner_id,event_key) DO NOTHING",[run.owner_id,run.id,candidate.id,key,decision.action,decision.reason,candidate.attempts,JSON.stringify({status:candidate.status,stepType:candidate.step_type,startedAt:candidate.started_at,hasPendingExecutionTask:candidate.has_pending_execution_task,hasActiveExecutionTask:candidate.has_active_execution_task})]);
    if(decision.action==='resume'||decision.action==='retry') await db.query("UPDATE ultron_agent_steps SET status='pending',started_at=NULL WHERE id=$1 AND owner_id=$2 AND status='running'",[candidate.id,run.owner_id]);
  }
  const steps=(await db.query("SELECT id,position,step_type,title,input,depends_on FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND status='pending' ORDER BY position LIMIT 3",[run.id,run.owner_id])).rows;
  const outcomes=await runParallel(steps,async step=>{
    const state=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
    if(!state||state.status==='cancelled')return {kind:'skipped',step};
    const dependencies=Array.isArray(step.depends_on)?step.depends_on:[];
    if(dependencies.length) {
      const prerequisiteRows=(await db.query("SELECT position,status FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND position=ANY($3::int[])",[run.id,run.owner_id,dependencies])).rows;
      if(!dependenciesSatisfied(dependencies,prerequisiteRows))return {kind:'skipped',step};
    }
    const claim=await db.query("UPDATE ultron_agent_steps SET status='running',attempts=attempts+1,started_at=now(),error='' WHERE id=$1 AND owner_id=$2 AND status='pending' RETURNING id,attempts",[step.id,run.owner_id]);
    if(!claim.rows.length)return {kind:'skipped',step};
    const role=specialistRoleForStep(step.step_type);
    await db.query("INSERT INTO ultron_specialist_tasks(owner_id,run_id,step_id,phase,specialist_role,capabilities,context_snapshot,status) VALUES($1,$2,$3,'execution',$4,$5::jsonb,$6::jsonb,'pending') ON CONFLICT(owner_id,step_id,phase) DO NOTHING",[run.owner_id,run.id,step.id,role,JSON.stringify(specialistCapabilitiesForRole(role)),JSON.stringify({position:step.position,stepType:step.step_type,title:step.title,input:step.input||{},depends_on:step.depends_on||[]})]);
    await db.query("INSERT INTO ultron_specialist_tasks(owner_id,run_id,step_id,phase,specialist_role,capabilities,context_snapshot,status) VALUES($1,$2,$3,'verification','verifier',$4::jsonb,$5::jsonb,'pending') ON CONFLICT(owner_id,step_id,phase) DO NOTHING",[run.owner_id,run.id,step.id,JSON.stringify(specialistCapabilitiesForRole('verifier')),JSON.stringify({position:step.position,targetStepId:step.id,targetRole:role,verificationContract:'independent_operation_evidence_review'})]);
    const executionTask=(await db.query("UPDATE ultron_specialist_tasks SET status='running',attempts=attempts+1,lease_until=now()+interval '10 minutes',error='',updated_at=now() WHERE owner_id=$1 AND step_id=$2 AND phase='execution' AND status='pending' RETURNING id,context_snapshot,attempts",[run.owner_id,step.id])).rows[0];
    if(!executionTask){await db.query("UPDATE ultron_agent_steps SET status='pending',started_at=NULL WHERE id=$1 AND owner_id=$2 AND status='running'",[step.id,run.owner_id]);return {kind:'skipped',step,note:'Specialist execution task was not claimable.'};}
    let approvedLessons=[];
    let effectiveLessons=[];
    let experimentAssignment=null;
    let verifierRejectionCount=0;
    let strategyPolicy=null;
    let executionAttempt=Number(executionTask.attempts||0);
    let verifierTask=null;
    let verifierAttempt=null;
    try {
      strategyPolicy=executionTask.context_snapshot?.strategyPolicy;
      if(!strategyPolicy){
        const configuredPolicy=(await db.query("SELECT step_type,lesson_id,policy_version,approved_at FROM ultron_strategy_policies WHERE owner_id=$1 AND step_type=$2 AND active=true",[run.owner_id,step.step_type])).rows[0];
        strategyPolicy=configuredPolicy?{enabled:true,stepType:String(configuredPolicy.step_type),lessonId:String(configuredPolicy.lesson_id),policyVersion:String(configuredPolicy.policy_version),approvedAt:configuredPolicy.approved_at}:{enabled:false,stepType:String(step.step_type),lessonId:null,policyVersion:null,approvedAt:null};
        await db.query("UPDATE ultron_specialist_tasks SET context_snapshot=COALESCE(context_snapshot,'{}'::jsonb)||jsonb_build_object('strategyPolicy',$3::jsonb),updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$4 AND owner_id=$2 AND status='running')",[executionTask.id,run.owner_id,JSON.stringify(strategyPolicy),run.id]);
      }
      approvedLessons=(await db.query("SELECT id,lesson,confidence,evidence FROM ultron_agent_lessons WHERE owner_id=$1 AND status='approved' AND evidence->>'stepType'=$2 AND ($3::text IS NULL OR id=$3) ORDER BY CASE WHEN id=$3 THEN 0 ELSE 1 END,reviewed_at DESC LIMIT 3",[run.owner_id,step.step_type,strategyPolicy.enabled?strategyPolicy.lessonId:null])).rows;
      approvedLessons=applyApprovedStrategyPolicy(approvedLessons,strategyPolicy);
      experimentAssignment=executionTask.context_snapshot?.lessonExperiment;
      if(!experimentAssignment){
        const experimentConfig=(await db.query("SELECT enabled FROM ultron_lesson_experiments WHERE owner_id=$1",[run.owner_id])).rows[0];
        experimentAssignment=assignLessonExperiment({enabled:experimentConfig?.enabled===true,runId:run.id,stepId:step.id,stepType:step.step_type,lessons:approvedLessons});
      }
      effectiveLessons=experimentAssignment.enabled?(experimentAssignment.cohort==='control'?[]:approvedLessons.filter(x=>(experimentAssignment.lessonIds||[]).includes(String(x.id)))):approvedLessons;
      const startedObservations=createLessonObservationEvents(effectiveLessons,'started',claim.rows[0].attempts,step.step_type);
      await db.query("UPDATE ultron_specialist_tasks SET context_snapshot=COALESCE(context_snapshot,'{}'::jsonb)||jsonb_build_object('lessonExperiment',$3::jsonb),updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$4 AND owner_id=$2 AND status='running')",[executionTask.id,run.owner_id,JSON.stringify(experimentAssignment),run.id]);
      if(startedObservations.length) await db.query("UPDATE ultron_specialist_tasks SET context_snapshot=jsonb_set(COALESCE(context_snapshot,'{}'::jsonb),'{lessonObservations}',COALESCE(context_snapshot->'lessonObservations','[]'::jsonb)||$3::jsonb,true),updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$4 AND owner_id=$2 AND status='running')",[executionTask.id,run.owner_id,JSON.stringify(startedObservations),run.id]);
      let workingStep=step;
      let result=await executeStep(workingStep,run.owner_id,run.id,effectiveLessons);
      const postExecutionState=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
      if(!isMissionActive(postExecutionState?.status)) return {kind:'skipped',step,note:'Mission was cancelled while this specialist was executing; no further verifier or completion writes were allowed.'};
      verifierTask=(await db.query("UPDATE ultron_specialist_tasks SET status='running',attempts=attempts+1,lease_until=now()+interval '10 minutes',error='',updated_at=now() WHERE owner_id=$1 AND step_id=$2 AND phase='verification' AND (status='pending' OR (status='running' AND lease_until<now())) RETURNING id,attempts",[run.owner_id,step.id])).rows[0];
      if(!verifierTask)throw new Error('Independent verifier task could not be claimed.');
      verifierAttempt=Number(verifierTask.attempts||0);
      let independentVerification=await verifyStepResult(workingStep,result,db,run.owner_id,run.id);
      const revisionHistory=[];
      for(let revisionNo=1;!independentVerification.passed&&revisionNo<=1;revisionNo++) {
        verifierRejectionCount++;
        const revision=buildRevisionRequest(workingStep,result,independentVerification,revisionNo);
        if(!revision)break;
        const savedRevision=(await db.query("INSERT INTO ultron_specialist_revisions(owner_id,run_id,step_id,revision_no,specialist_role,revision_instruction,input_snapshot,prior_output,prior_verification,status) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,'requested') ON CONFLICT(owner_id,step_id,revision_no) DO NOTHING RETURNING id",[run.owner_id,run.id,step.id,revisionNo,role,revision.instruction,JSON.stringify(revision.input),JSON.stringify(result),JSON.stringify(independentVerification)])).rows[0];
        if(!savedRevision)break;
        revisionHistory.push({id:savedRevision.id,revisionNo,role,instruction:revision.instruction,reason:revision.reason,mode:revision.mode});
        workingStep={...step,input:revision.input};
        const executionRevision=await db.query("UPDATE ultron_specialist_tasks SET attempts=attempts+1,context_snapshot=COALESCE(context_snapshot,'{}'::jsonb)||$3::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$4 RETURNING id",[executionTask.id,run.owner_id,JSON.stringify({position:step.position,stepType:step.step_type,title:step.title,input:revision.input,depends_on:step.depends_on||[],revisionNo}),executionAttempt]);
        if(!executionRevision.rowCount)throw new Error('Execution task attempt changed before its revision could be recorded.');
        executionAttempt++;
        const verifierRevision=await db.query("UPDATE ultron_specialist_tasks SET attempts=attempts+1,context_snapshot=$3::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$4 RETURNING id",[verifierTask.id,run.owner_id,JSON.stringify({position:step.position,targetStepId:step.id,targetRole:role,verificationContract:'independent_operation_evidence_review',revisionNo}),verifierAttempt]);
        if(!verifierRevision.rowCount)throw new Error('Verifier task attempt changed before its revision could be recorded.');
        verifierAttempt++;
        try {
          result=await executeStep(workingStep,run.owner_id,run.id,effectiveLessons);
          independentVerification=await verifyStepResult(workingStep,result,db,run.owner_id,run.id);
          await db.query("UPDATE ultron_specialist_revisions SET revised_output=$4::jsonb,revised_verification=$5::jsonb,status=$6,error='',completed_at=now() WHERE id=$1 AND owner_id=$2 AND step_id=$3",[savedRevision.id,run.owner_id,step.id,JSON.stringify(result),JSON.stringify(independentVerification),independentVerification.passed?'accepted':'rejected']);
        } catch(revisionError) {
          const revisionMessage=String(revisionError?.message||revisionError).slice(0,500);
          await db.query("UPDATE ultron_specialist_revisions SET status='rejected',error=$4,completed_at=now() WHERE id=$1 AND owner_id=$2 AND step_id=$3",[savedRevision.id,run.owner_id,step.id,revisionMessage]);
          throw revisionError;
        }
      }
      const verifierSaved=await db.query("UPDATE ultron_specialist_tasks SET status=$3,verification=$4::jsonb,lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$5 RETURNING id",[verifierTask.id,run.owner_id,independentVerification.passed?'completed':'failed',JSON.stringify({...independentVerification,revisionCount:revisionHistory.length}),verifierAttempt]);
      if(!verifierSaved.rowCount) throw new Error('Verifier task was cancelled or claimed elsewhere before its result could be committed.');
      if(!independentVerification.passed)throw new Error('Independent verifier rejected '+role+' output after '+revisionHistory.length+' bounded revision(s): '+independentVerification.challenge.join('; '));
      if(strategyPolicy?.enabled===true&&strategyPolicy.policyVersion&&effectiveLessons.some(x=>String(x.id)===String(strategyPolicy.lessonId))) await db.query("INSERT INTO ultron_strategy_trials(owner_id,policy_version,lesson_id,step_type,run_id,step_id,attempt,outcome,verifier_passed) VALUES($1,$2,$3,$4,$5,$6,$7,'operationally_verified',true) ON CONFLICT(owner_id,step_id,attempt,outcome) DO NOTHING",[run.owner_id,strategyPolicy.policyVersion,strategyPolicy.lessonId,step.step_type,run.id,step.id,claim.rows[0].attempts]);
      const successfulObservations=createLessonObservationEvents(effectiveLessons,'operationally_verified',claim.rows[0].attempts,step.step_type);
      if(successfulObservations.length) await db.query("UPDATE ultron_specialist_tasks SET context_snapshot=jsonb_set(COALESCE(context_snapshot,'{}'::jsonb),'{lessonObservations}',COALESCE(context_snapshot->'lessonObservations','[]'::jsonb)||$3::jsonb,true),updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$4 AND owner_id=$2 AND status='running')",[executionTask.id,run.owner_id,JSON.stringify(successfulObservations),run.id]);
      const experimentEvent=createExperimentObservationEvent(experimentAssignment,'operationally_verified',claim.rows[0].attempts,true,undefined,verifierRejectionCount);
      if(experimentEvent) await db.query("UPDATE ultron_specialist_tasks SET context_snapshot=jsonb_set(COALESCE(context_snapshot,'{}'::jsonb),'{experimentObservations}',COALESCE(context_snapshot->'experimentObservations','[]'::jsonb)||$3::jsonb,true),updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$4 AND owner_id=$2 AND status='running')",[executionTask.id,run.owner_id,JSON.stringify([experimentEvent]),run.id]);
      if(revisionHistory.length)result.specialistRevisions=revisionHistory;
      result.specialist={role,worker:'bounded_deterministic_specialist',parallelBatchLimit:MAX_SPECIALIST_CONCURRENCY,executionTaskId:executionTask.id,verifierTaskId:verifierTask.id};
      result.independentVerification=independentVerification;
      result.learningContext={source:experimentAssignment.enabled?'opt_in_lesson_experiment':'owner_approved_lessons',experiment:experimentAssignment.enabled?{id:experimentAssignment.experimentId,cohort:experimentAssignment.cohort,allocation:experimentAssignment.allocation}:null,timing:'loaded_before_execution',scope:'matching_step_type_only',lessonsConsulted:effectiveLessons.map(x=>({id:x.id,lesson:String(x.lesson||'').slice(0,1200),confidence:Number(x.confidence||0)})),count:effectiveLessons.length,applied:result.lessonUses||[],note:'Lessons are fallible owner-approved experience. They inform bounded operational safeguards; they never override user instructions or establish factual truth.'};
      delete result.lessonUses;
      const saved=await db.query("UPDATE ultron_agent_steps SET status='completed',result=$3::jsonb,completed_at=now(),error='' WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$4 RETURNING id",[step.id,run.owner_id,JSON.stringify(result),claim.rows[0].attempts]);
      if(!saved.rows.length)return {kind:'skipped',step,note:'Step state changed before completion was committed.'};
      await db.query("UPDATE ultron_specialist_tasks SET status='completed',output=$3::jsonb,lease_until=NULL,error='',updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$4",[executionTask.id,run.owner_id,JSON.stringify(result),executionAttempt]);
      return {kind:'completed',step,role};
    } catch(e) {
      const missionState=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
      if(!isMissionActive(missionState?.status)) return {kind:'skipped',step,note:'Mission was cancelled; late specialist results were discarded.'};
      const message=String(e?.message||e).slice(0,500),attempt=Number(claim.rows[0]?.attempts||1),disposition=classifyStepFailure(message,attempt);
      const lessonOutcome=message.startsWith('Independent verifier rejected')?'verifier_rejected':disposition.retry?'retryable_failure':'failed';
      if(strategyPolicy?.enabled===true&&strategyPolicy.policyVersion&&effectiveLessons.some(x=>String(x.id)===String(strategyPolicy.lessonId))) await db.query("INSERT INTO ultron_strategy_trials(owner_id,policy_version,lesson_id,step_type,run_id,step_id,attempt,outcome,verifier_passed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,false) ON CONFLICT(owner_id,step_id,attempt,outcome) DO NOTHING",[run.owner_id,strategyPolicy.policyVersion,strategyPolicy.lessonId,step.step_type,run.id,step.id,attempt,lessonOutcome]);
      const failedObservations=createLessonObservationEvents(effectiveLessons,lessonOutcome,attempt,step.step_type);
      if(failedObservations.length) await db.query("UPDATE ultron_specialist_tasks SET context_snapshot=jsonb_set(COALESCE(context_snapshot,'{}'::jsonb),'{lessonObservations}',COALESCE(context_snapshot->'lessonObservations','[]'::jsonb)||$3::jsonb,true),updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$4 AND owner_id=$2 AND status='running')",[executionTask.id,run.owner_id,JSON.stringify(failedObservations),run.id]);
      const experimentEvent=createExperimentObservationEvent(experimentAssignment,lessonOutcome,attempt,false,undefined,verifierRejectionCount|| (lessonOutcome==='verifier_rejected'?1:0));
      if(experimentEvent) await db.query("UPDATE ultron_specialist_tasks SET context_snapshot=jsonb_set(COALESCE(context_snapshot,'{}'::jsonb),'{experimentObservations}',COALESCE(context_snapshot->'experimentObservations','[]'::jsonb)||$3::jsonb,true),updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND EXISTS(SELECT 1 FROM ultron_agent_runs WHERE id=$4 AND owner_id=$2 AND status='running')",[executionTask.id,run.owner_id,JSON.stringify([experimentEvent]),run.id]);
      if(verifierTask&&Number.isSafeInteger(verifierAttempt)) await db.query("UPDATE ultron_specialist_tasks SET status=$3,lease_until=NULL,error=$4,updated_at=now(),completed_at=CASE WHEN $3='failed' THEN now() ELSE completed_at END WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$5",[verifierTask.id,run.owner_id,disposition.retry?'pending':'failed',message,verifierAttempt]);
      if(disposition.retry) {
        await db.query("UPDATE ultron_agent_steps SET status='pending',error=$3,started_at=NULL WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$4",[step.id,run.owner_id,'Transient failure on attempt '+attempt+': '+message,attempt]);
        await db.query("UPDATE ultron_specialist_tasks SET status='pending',lease_until=NULL,error=$3,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$4",[executionTask.id,run.owner_id,'Transient failure on attempt '+attempt+': '+message,executionAttempt]);
        return {kind:'retry',step,attempt,message};
      }
      await db.query("UPDATE ultron_specialist_tasks SET status='failed',lease_until=NULL,error=$3,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$4",[executionTask.id,run.owner_id,message,executionAttempt]);
      await db.query("UPDATE ultron_agent_steps SET status='failed',error=$3,completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts=$4",[step.id,run.owner_id,message,attempt]);
      if(!message.startsWith('Approved learning blocked an unchanged retry:'))await db.query("INSERT INTO ultron_agent_lessons(owner_id,lesson_key,lesson,evidence,confidence,status) VALUES($1,$2,$3,$4::jsonb,0.65,'candidate') ON CONFLICT(owner_id,lesson_key) DO NOTHING",[run.owner_id,run.id+':'+step.position,'Observed failure pattern: the '+String(step.step_type)+' step "'+String(step.title).slice(0,140)+'" failed. Review the recorded error and adjust the plan or inputs before retrying; do not assume the same attempt will succeed.',JSON.stringify({runId:run.id,stepId:step.id,position:step.position,stepType:step.step_type,status:'failed',verified:false,error:message,input:step.input||{}})]);
      return {kind:'failed',step,message};
    }
  },MAX_SPECIALIST_CONCURRENCY);
  const completed=outcomes.filter(x=>x.kind==='completed').length,failed=outcomes.filter(x=>x.kind==='failed').length;
  const retry=outcomes.find(x=>x.kind==='retry'),failure=outcomes.find(x=>x.kind==='failed');
  const afterBatch=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
  if(afterBatch?.status==='cancelled')return res.json({ok:true,runId:run.id,status:'cancelled',completedSteps:completed});
  if(failure){
    const message='Step '+failure.step.position+' failed: '+failure.message;
    await db.query("UPDATE ultron_agent_runs SET status='failed',error=$3,lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts="+Number(run.attempts),[run.id,run.owner_id,message]);
    await db.query("INSERT INTO ultron_recovery_observations(owner_id,run_id,revision_id,event_key,event_type,strategy_type,failed_step_type,failure_category,owner_modified_inputs,plan_version,metadata) SELECT a.owner_id,a.run_id,a.revision_id,a.revision_id||':terminal_failed','terminal_failed',a.strategy_type,a.failed_step_type,a.failure_category,a.owner_modified_inputs,r.plan_version,jsonb_build_object('operationallyVerified',false,'retryCount',COALESCE((SELECT SUM(GREATEST(s.attempts-1,0))::int FROM ultron_agent_steps s WHERE s.run_id=r.id AND s.owner_id=r.owner_id),0),'terminalStatus','failed') FROM ultron_recovery_observations a JOIN ultron_agent_runs r ON r.id=a.run_id AND r.owner_id=a.owner_id WHERE a.owner_id=$2 AND a.run_id=$1 AND a.event_type='approved' ON CONFLICT(owner_id,event_key) DO NOTHING",[run.id,run.owner_id]);
  }
  if(retry&&!failure){await db.query("UPDATE ultron_agent_runs SET status='queued',error=$3,lease_until=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts="+Number(run.attempts),[run.id,run.owner_id,'Retrying transient specialist failure: '+retry.message]);try{await scheduler.at(new Date(Date.now()+60000),ROUTE,{payload:{runId:run.id},name:'ultron-agent-retry-'+run.id+'-'+retry.attempt});return res.json({ok:true,runId:run.id,status:'queued',retryScheduled:true,completedSteps:completed,attempt:retry.attempt,nextAttempt:retry.attempt+1,note:'Other independent specialists completed; only the transiently failed task is queued for retry.'});}catch{return res.json({ok:true,runId:run.id,status:'queued',retryScheduled:false,completedSteps:completed,note:'Retry remains queued for the hourly recovery worker.'});}}
  if(failure)return res.json({ok:false,runId:run.id,status:'failed',completedSteps:completed,failedSteps:failed});
  const current=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
  if(current?.status==='cancelled') return res.json({ok:true,runId:run.id,status:'cancelled',completedSteps:completed});
  if(current?.status==='failed') return res.json({ok:false,runId:run.id,status:'failed',completedSteps:completed,failedSteps:failed});
  const counts=(await db.query("SELECT COUNT(*) FILTER (WHERE status='pending')::int AS pending,COUNT(*) FILTER (WHERE status='running')::int AS running,COUNT(*) FILTER (WHERE status='failed')::int AS failed,COUNT(*) FILTER (WHERE status='completed')::int AS completed,COUNT(*) FILTER (WHERE status='completed' AND (COALESCE((result->>'operationVerified')::boolean,false)=true OR COALESCE((result->>'verified')::boolean,false)=true))::int AS verified FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
  const lessonSteps=(await db.query("SELECT id,position,step_type,title,status,result,error FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND status='failed' ORDER BY position",[run.id,run.owner_id])).rows;
  for(const item of lessonSteps) {
    const isFailure=item.status==='failed';
    const lesson=isFailure
      ? 'Observed failure pattern: the '+String(item.step_type)+' step "'+String(item.title).slice(0,140)+'" failed. Review the recorded error and adjust the plan or inputs before retrying; do not assume the same attempt will succeed.'
      : 'Observed operationally verified outcome: the '+String(item.step_type)+' step "'+String(item.title).slice(0,140)+'" passed its explicit '+String((item.result||{}).verificationType||'')+' operation check. This does not establish factual accuracy; re-check when inputs or environment change.';
    const evidence={runId:run.id,stepId:item.id,position:item.position,stepType:item.step_type,status:item.status,operationVerified:!isFailure,verified:!!((item.result||{}).verified),factualAccuracyVerified:false,error:isFailure?String(item.error||'').slice(0,500):'',resultType:String((item.result||{}).verificationType||'')};
    const lessonKey=(isFailure?'failure:':'success:')+String(item.step_type);
    await db.query("INSERT INTO ultron_agent_lessons(owner_id,lesson_key,lesson,evidence,confidence,status) VALUES($1,$2,$3,$4::jsonb,$5,'candidate') ON CONFLICT(owner_id,lesson_key) DO UPDATE SET lesson=EXCLUDED.lesson,evidence=EXCLUDED.evidence,confidence=GREATEST(ultron_agent_lessons.confidence,EXCLUDED.confidence) WHERE ultron_agent_lessons.status='candidate'",[run.owner_id,lessonKey,lesson,JSON.stringify(evidence),isFailure?0.65:0.55]);
  }
  if(counts.running>0) {
    await db.query("UPDATE ultron_agent_runs SET lease_until=now()+interval '2 minutes',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts="+Number(run.attempts),[run.id,run.owner_id]);
    return res.json({ok:true,runId:run.id,status:'running',completedSteps:completed,runningSteps:counts.running,note:'ULTRON is waiting for already-claimed specialists; a mission cannot finalize while any step remains running.'});
  }
  if(counts.pending===0&&counts.failed===0) {
    if(counts.completed===0) {
      const message='Mission had no completed executable steps; an empty run cannot be reported as completed.';
      await db.query("UPDATE ultron_agent_runs SET status='failed',error=$3,lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts="+Number(run.attempts),[run.id,run.owner_id,message]);
      return res.json({ok:false,runId:run.id,status:'failed',completedSteps:0,failedSteps:0,verificationStatus:'not_verified',note:message});
    }
    const fullyOperationallyVerified=counts.completed>0&&counts.verified===counts.completed;
    const planData=(await db.query('SELECT plan FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2',[run.id,run.owner_id])).rows[0]?.plan;
    const acceptanceCriteria=Array.isArray(planData?.acceptanceCriteria)?planData.acceptanceCriteria:[];
    const acceptanceChecks=Array.isArray(planData?.acceptanceChecks)?planData.acceptanceChecks:acceptanceCriteria.map(text=>({text,check:{type:'human_review'}}));
    const persistedSteps=(await db.query('SELECT step_type,status,result FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[run.id,run.owner_id])).rows;
    const acceptanceResult=acceptanceChecks.length?verifyOutcome(acceptanceChecks,persistedSteps):{status:'not_defined',counts:{met:0,unmet:0,needs_review:0},criteria:[],note:'No structured acceptance checks were supplied.'};
    const acceptance={...acceptanceResult,count:acceptanceChecks.length,items:acceptanceChecks};
    const learningUsage=(await db.query("SELECT COUNT(DISTINCT step_id)::int AS steps_with_lessons,COUNT(DISTINCT lesson_id)::int AS distinct_lessons FROM (SELECT id AS step_id,jsonb_array_elements(COALESCE(result->'learningContext'->'lessonsConsulted','[]'::jsonb))->>'id' AS lesson_id FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND status='completed') q WHERE lesson_id IS NOT NULL",[run.id,run.owner_id])).rows[0]||{steps_with_lessons:0,distinct_lessons:0};
    const coordinationSteps=(await db.query('SELECT position,step_type,title,depends_on,status,result,error FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[run.id,run.owner_id])).rows;
    const coordinationSpecialists=(await db.query('SELECT step_id,phase,specialist_role,status,verification,error FROM ultron_specialist_tasks WHERE run_id=$1 AND owner_id=$2 ORDER BY created_at,phase',[run.id,run.owner_id])).rows;
    const coordination=buildMissionCoordinationReport(coordinationSteps,acceptance,coordinationSpecialists);
    const summary={stepsCompleted:counts.completed,stepsVerified:counts.verified,verifiedWork:fullyOperationallyVerified,verificationStatus:fullyOperationallyVerified?'operationally_verified':'partial',verificationScope:'operation_checks_only',acceptance,coordination,factualAccuracyVerified:false,learning:{stepsWithApprovedLessons:learningUsage.steps_with_lessons,distinctApprovedLessonsConsulted:learningUsage.distinct_lessons},completedAt:new Date().toISOString()};
    await db.query("UPDATE ultron_agent_runs SET status='completed',result=$3::jsonb,error='',lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts="+Number(run.attempts),[run.id,run.owner_id,JSON.stringify(summary)]);
    await db.query("INSERT INTO ultron_recovery_observations(owner_id,run_id,revision_id,event_key,event_type,strategy_type,failed_step_type,failure_category,owner_modified_inputs,plan_version,metadata) SELECT a.owner_id,a.run_id,a.revision_id,a.revision_id||':terminal_completed','terminal_completed',a.strategy_type,a.failed_step_type,a.failure_category,a.owner_modified_inputs,r.plan_version,jsonb_build_object('operationallyVerified',$3::boolean,'retryCount',COALESCE((SELECT SUM(GREATEST(s.attempts-1,0))::int FROM ultron_agent_steps s WHERE s.run_id=r.id AND s.owner_id=r.owner_id),0),'terminalStatus','completed','stepsCompleted',$4::int,'stepsVerified',$5::int) FROM ultron_recovery_observations a JOIN ultron_agent_runs r ON r.id=a.run_id AND r.owner_id=a.owner_id WHERE a.owner_id=$2 AND a.run_id=$1 AND a.event_type='approved' ON CONFLICT(owner_id,event_key) DO NOTHING",[run.id,run.owner_id,fullyOperationallyVerified,counts.completed,counts.verified]);
    return res.json({ok:true,runId:run.id,status:'completed',stepsCompleted:counts.completed,stepsVerified:counts.verified,verificationStatus:summary.verificationStatus,factualAccuracyVerified:false});
  }
  await db.query("UPDATE ultron_agent_runs SET status='queued',lease_until=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running' AND attempts="+Number(run.attempts),[run.id,run.owner_id]);
  try { await scheduler.at(new Date(Date.now()+60000),ROUTE,{payload:{runId:run.id},name:'ultron-agent-'+run.id}); }
  catch(e) { return res.json({ok:true,runId:run.id,status:'queued',completedSteps:completed,resumeScheduled:false,note:'The hourly recovery worker will resume this run.'}); }
  return res.json({ok:true,runId:run.id,status:'queued',completedSteps:completed,resumeScheduled:true});
}