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
  return {reachable:r.status>=200&&r.status<300,verified:false,verificationType:'url_reachability',url:u.toString(),status:r.status,checkedAt:new Date().toISOString(),contentType:r.headers.get('content-type')||'',note:'This confirms that the URL responded. It does not verify the accuracy of claims on the page.'};
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
    return {query:input.query,results,source:data.source,retrievedAt:data.retrievedAt,verified:false,note:results.length?'Search results are leads, not verified facts. Run a verify_url step before treating a source as checked.':'The free public indexes returned no useful result for this query; no result was invented.'};
  }
  if(step.step_type==='verify_url') {
    const result=await verifyUrl(input.url);
    if(!result.reachable) throw new Error('Source reachability check failed: HTTP '+(result.status||'unavailable')+'. '+(result.error||''));
    return result;
  }
  if(step.step_type==='create_task') {
    const title=String(input.title||'').trim(), body=String(input.body||'').trim();
    const inserted=await db.query("INSERT INTO ultron_items(owner_id,kind,title,body,status) VALUES($1,'task',$2,$3,'open') RETURNING id,title,kind,status,created_at",[owner,title,body]);
    const saved=inserted.rows[0];
    const check=(await db.query('SELECT id,title,kind,status FROM ultron_items WHERE id=$1 AND owner_id=$2',[saved.id,owner])).rows[0];
    if(!check||check.id!==saved.id||check.status!=='open') throw new Error('The task was inserted but its persisted state could not be verified.');
    return {created:true,verified:true,item:check};
  }
  if(step.step_type==='save_learning') {
    const sourceUrl=String(input.source_url||'');
    let sourceName='Owner-provided';
    if(sourceUrl) {
      const prior=(await db.query("SELECT result FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND step_type='verify_url' AND status='completed' ORDER BY position DESC",[runId,owner])).rows;
      const match=prior.map(x=>x.result||{}).find(x=>x.url===sourceUrl&&x.reachable===true);
      if(!match) throw new Error('This source has not passed a verify_url step in this run. Add verification before saving sourced learning.');
      sourceName=new URL(sourceUrl).hostname.slice(0,160);
    }
    const topic=String(input.topic).trim().slice(0,240), summary=String(input.summary).trim().slice(0,3000);
    const saved=await db.query("INSERT INTO ultron_knowledge(owner_id,topic,summary,source_url,source_name,published_at,source_status,last_checked_at) VALUES($1,$2,$3,$4,$5,'','available',CASE WHEN $4<>'' THEN now() ELSE NULL END) RETURNING id,topic,summary,source_url,source_name,created_at",[owner,topic,summary,sourceUrl,sourceName]);
    const row=saved.rows[0];
    const persisted=(await db.query('SELECT id,topic,summary,source_url,source_name,created_at FROM ultron_knowledge WHERE id=$1 AND owner_id=$2',[row.id,owner])).rows[0];
    if(!persisted||persisted.topic!==topic||persisted.summary!==summary||persisted.source_url!==sourceUrl) throw new Error('Learning was written but its persisted contents could not be independently checked.');
    return {saved:true,verified:true,verificationType:'knowledge_persistence',knowledge:persisted,sourceReachable:!!sourceUrl,factualAccuracyVerified:false,note:'The knowledge record was read back successfully. Its factual claims have not been independently established.'};
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
      failed++;
      break;
    }
  }
  const current=(await db.query("SELECT status FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
  if(current?.status==='cancelled') return res.json({ok:true,runId:run.id,status:'cancelled',completedSteps:completed});
  if(current?.status==='failed') return res.json({ok:false,runId:run.id,status:'failed',completedSteps:completed,failedSteps:failed});
  const counts=(await db.query("SELECT COUNT(*) FILTER (WHERE status='pending')::int AS pending,COUNT(*) FILTER (WHERE status='failed')::int AS failed,COUNT(*) FILTER (WHERE status='completed')::int AS completed,COUNT(*) FILTER (WHERE status='completed' AND COALESCE((result->>'verified')::boolean,false)=true)::int AS verified FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2",[run.id,run.owner_id])).rows[0];
  if(counts.pending===0&&counts.failed===0) {
    const fullyVerified=counts.completed>0&&counts.verified===counts.completed;
    const summary={stepsCompleted:counts.completed,stepsVerified:counts.verified,verifiedWork:fullyVerified,verificationStatus:fullyVerified?'verified':'partial',completedAt:new Date().toISOString()};
    await db.query("UPDATE ultron_agent_runs SET status='completed',result=$3::jsonb,error='',lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status='running'",[run.id,run.owner_id,JSON.stringify(summary)]);
    return res.json({ok:true,runId:run.id,status:'completed',stepsCompleted:counts.completed,stepsVerified:counts.verified,verificationStatus:summary.verificationStatus});
  }
  await db.query("UPDATE ultron_agent_runs SET status='queued',lease_until=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='running'",[run.id,run.owner_id]);
  try { await scheduler.at(new Date(Date.now()+60000),ROUTE,{payload:{runId:run.id},name:'ultron-agent-'+run.id}); }
  catch(e) { return res.json({ok:true,runId:run.id,status:'queued',completedSteps:completed,resumeScheduled:false,note:'The hourly recovery worker will resume this run.'}); }
  return res.json({ok:true,runId:run.id,status:'queued',completedSteps:completed,resumeScheduled:true});
}