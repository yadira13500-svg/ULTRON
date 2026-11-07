import { db, scheduler } from 'hatchable';

export const access = 'admin';
export const methods = ['GET','POST','PUT'];

const STEP_TYPES = new Set(['research_search','verify_url','retrieve_source','assess_claim','save_learning','create_task','skill_apply']);
const safeUrl = value => {
  try {
    const u = new URL(String(value || ''));
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !h || u.username || u.password ||
      h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '::1' || h.startsWith('[')) return null;
    return u;
  } catch { return null; }
};

export default async function(req,res) {
  const owner = String(req.member.id);
  if (req.method === 'GET') {
    const id = String(req.query?.id || '');
    if (id) {
      // Sourced-learning order is validated in the POST planner below.
    const run = (await db.query('SELECT id,title,objective,status,plan,result,error,attempts,created_at,updated_at,started_at,completed_at FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2',[id,owner])).rows[0];
      if (!run) return res.status(404).json({error:'Agent run not found.'});
      const steps = (await db.query('SELECT id,position,step_type,title,input,depends_on,status,result,error,attempts,started_at,completed_at FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[id,owner])).rows;
      return res.json({run,steps});
    }
    const runs = (await db.query('SELECT id,title,objective,status,result,error,attempts,created_at,updated_at,completed_at FROM ultron_agent_runs WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 40',[owner])).rows;
    return res.json({runs});
  }

  if (req.method === 'POST') {
    const body = req.body || {};
    const title = String(body.title || '').trim();
    const objective = String(body.objective || '').trim();
    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (!title || title.length > 180 || objective.length > 2000 || !steps.length || steps.length > 16)
      return res.status(400).json({error:'Provide a title, an objective under 2,000 characters, and 1–16 steps.'});
    const normalized = [];
    for (let i=0;i<steps.length;i++) {
      const s=steps[i] || {};
      const type=String(s.type || '');
      const label=String(s.title || type).trim();
      const input=s.input && typeof s.input === 'object' && !Array.isArray(s.input) ? s.input : {};
      if (!STEP_TYPES.has(type) || !label || label.length>180) return res.status(400).json({error:'Step '+(i+1)+' has an unsupported type or title.'});
      if (type==='research_search' && (!String(input.query||'').trim() || String(input.query).length>300)) return res.status(400).json({error:'Research steps need a query under 300 characters.'});
      // Claim input validation is performed once above.
      if (type==='assess_claim' && (!String(input.claim||'').trim() || String(input.claim).length>600 || !Array.isArray(input.source_urls) || input.source_urls.length<2 || input.source_urls.length>4 || new Set(input.source_urls).size!==input.source_urls.length)) return res.status(400).json({error:'Claim assessment needs a claim under 600 characters and 2–4 distinct source URLs.'});
      if ((type==='verify_url'||type==='retrieve_source') && !safeUrl(input.url)) return res.status(400).json({error:'Source steps require a public HTTPS URL.'});
      if (type==='save_learning' && (!String(input.topic||'').trim() || (!String(input.summary||'').trim()&&!String(input.source_url||'').trim()) || String(input.summary||'').length>3000)) return res.status(400).json({error:'Learning steps need a topic and either a summary under 3,000 characters or a source URL captured earlier in this mission.'});
      if (type==='create_task' && (!String(input.title||'').trim() || String(input.title).length>180 || String(input.body||'').length>2000)) return res.status(400).json({error:'Task steps need a title under 180 characters and optional details under 2,000 characters.'});
      if (type==='skill_apply' && (!String(input.skill_id||'').trim() || !String(input.task_description||'').trim() || !String(input.metric_label||'').trim() || !Number.isFinite(Number(input.baseline_value)) || !['higher_is_better','lower_is_better'].includes(input.metric_direction))) return res.status(400).json({error:'Skill application requires a skill ID, practical task, metric label, numeric baseline and metric direction.'});
      if (type==='skill_apply') { const skill=(await db.query("SELECT id,title FROM ultron_skill_modules WHERE id=$1 AND owner_id=$2 AND status='mastered'",[input.skill_id,owner])).rows[0]; if(!skill)return res.status(409).json({error:'Only an owner-reviewed mastered skill can be attached to an agent mission.'}); }
      const dependsOn=Array.isArray(s.depends_on)?s.depends_on:[];
      if(dependsOn.length>8||new Set(dependsOn).size!==dependsOn.length||dependsOn.some(n=>!Number.isInteger(n)||n<1||n>=i+1)) return res.status(400).json({error:'Step dependencies must reference unique earlier step positions only.'});
      normalized.push({position:i+1,type,title:label,input,depends_on:dependsOn});
    }
    for (let i=0;i<normalized.length;i++) { const s=normalized[i]; if(s.type==='save_learning'&&s.input.source_url&&!normalized.some((v,j)=>j<i&&v.type==='retrieve_source'&&v.input.url===s.input.source_url)) return res.status(400).json({error:'Add a retrieve_source step for the same source before saving sourced learning.'}); }
    for (let i=0;i<normalized.length;i++) { const s=normalized[i]; if(s.type==='assess_claim' && (!Array.isArray(s.input.source_urls) || !s.input.source_urls.every(url=>normalized.some((v,j)=>j<i&&v.type==='retrieve_source'&&v.input.url===url)))) return res.status(400).json({error:'Capture each exact source URL before assessing a claim.'}); }
    const acceptanceCriteria=Array.isArray(body.acceptanceCriteria)?body.acceptanceCriteria.map(x=>String(x).trim().slice(0,500)).filter(Boolean).slice(0,12):[];
    const planRecord=acceptanceCriteria.length?{steps:normalized,acceptanceCriteria,planner:body.planner||null}:normalized;
    const run = (await db.query("INSERT INTO ultron_agent_runs(owner_id,title,objective,plan) VALUES($1,$2,$3,$4::jsonb) RETURNING id,title,objective,status,created_at",[owner,title,objective,JSON.stringify(planRecord)])).rows[0];
    for (const s of normalized) {
      await db.query('INSERT INTO ultron_agent_steps(run_id,owner_id,position,step_type,title,input,depends_on) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)',[run.id,owner,s.position,s.type,s.title,JSON.stringify(s.input),JSON.stringify(s.depends_on)]);
    }
    try {
      await scheduler.now('/api/ultron/jobs/agent-runner',{runId:run.id});
    } catch (e) {
      await db.query("UPDATE ultron_agent_runs SET error=$3,updated_at=now() WHERE id=$1 AND owner_id=$2",[run.id,owner,'Immediate worker could not be queued: '+String(e?.message||e).slice(0,180)]);
      return res.status(202).json({runId:run.id,status:'queued',workerQueued:false,message:'Saved durably. The hourly recovery worker will pick it up.'});
    }
    return res.status(202).json({runId:run.id,status:'queued',workerQueued:true,message:'Plan saved. Background execution has been queued.'});
  }

  const body=req.body||{}, id=String(body.id||''), action=String(body.action||'');
  if (!id || !['cancel','retry'].includes(action)) return res.status(400).json({error:'Provide a run id and cancel/retry action.'});
  if (action==='cancel') {
    const r=await db.query("UPDATE ultron_agent_runs SET status='cancelled',lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('queued','running') RETURNING id,status",[id,owner]);
    if (!r.rows.length) return res.status(409).json({error:'This run is not cancellable.'});
    await db.query("UPDATE ultron_agent_steps SET status='skipped' WHERE run_id=$1 AND owner_id=$2 AND status IN ('pending','running')",[id,owner]);
    return res.json({ok:true,run:r.rows[0]});
  }
  const r=await db.query("UPDATE ultron_agent_runs SET status='queued',error='',lease_until=NULL,completed_at=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('failed','cancelled') RETURNING id",[id,owner]);
  if (!r.rows.length) return res.status(409).json({error:'Only failed or cancelled runs can be retried.'});
  await db.query("UPDATE ultron_agent_steps SET status='pending',error='',result='{}'::jsonb,started_at=NULL,completed_at=NULL WHERE run_id=$1 AND owner_id=$2 AND status IN ('failed','skipped')",[id,owner]);
  try { await scheduler.now('/api/ultron/jobs/agent-runner',{runId:id}); }
  catch (e) { return res.status(202).json({ok:true,status:'queued',workerQueued:false}); }
  return res.status(202).json({ok:true,status:'queued',workerQueued:true});
}