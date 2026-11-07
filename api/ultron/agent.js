import { db, scheduler } from 'hatchable';
import { specialistRoleForStep, specialistCapabilitiesForRole } from 'lib/mission-runtime.js';
import { buildMissionCoordinationReport, validateMissionGraph } from 'lib/mission-coordinator.js';
import { buildAdaptiveReplan, verifyAdaptiveReplan } from 'lib/mission-replanning.js';
import { recoveryFailureCategory, recoveryStrategyForRevision } from 'lib/recovery-evaluation.js';

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
    const run = (await db.query('SELECT id,title,objective,status,plan,plan_version,result,error,attempts,created_at,updated_at,started_at,completed_at FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2',[id,owner])).rows[0];
      if (!run) return res.status(404).json({error:'Agent run not found.'});
      const steps = (await db.query('SELECT id,position,step_type,title,input,depends_on,status,result,error,attempts,started_at,completed_at FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[id,owner])).rows;
      const specialistTasks = (await db.query('SELECT id,step_id,phase,specialist_role,capabilities,context_snapshot,status,attempts,lease_until,output,verification,error,created_at,updated_at,completed_at FROM ultron_specialist_tasks WHERE run_id=$1 AND owner_id=$2 ORDER BY created_at,phase',[id,owner])).rows;
      const specialistRevisions = (await db.query('SELECT id,step_id,revision_no,specialist_role,revision_instruction,input_snapshot,prior_output,prior_verification,revised_output,revised_verification,status,error,created_at,completed_at FROM ultron_specialist_revisions WHERE run_id=$1 AND owner_id=$2 ORDER BY created_at,revision_no',[id,owner])).rows;
      const missionRevisions=(await db.query('SELECT id,revision_no,base_plan_version,candidate_plan,affected_positions,preserved_positions,verifier,status,rationale,created_at,reviewed_at FROM ultron_mission_revisions WHERE run_id=$1 AND owner_id=$2 ORDER BY revision_no DESC',[id,owner])).rows;
      const evidenceRepairs=(await db.query('SELECT id,proposal_no,status,proposal,created_run_id,created_at,reviewed_at FROM ultron_evidence_repairs WHERE source_run_id=$1 AND owner_id=$2 ORDER BY proposal_no DESC',[id,owner])).rows;
      const recoveryEvents=(await db.query('SELECT id,step_id,action,reason,attempt,snapshot,created_at FROM ultron_recovery_events WHERE run_id=$1 AND owner_id=$2 ORDER BY created_at DESC LIMIT 100',[id,owner])).rows;
      const coordination=buildMissionCoordinationReport(steps,run.result?.acceptance||null,specialistTasks);
      let evidenceRepairComparison=null;
      if(run.plan?.evidenceRepairVersion==='evidence_repair_assessment_v1'&&run.plan?.sourceRunId&&Number.isInteger(Number(run.plan?.originalClaimPosition))){
        const originalStep=(await db.query("SELECT id,title,input,result FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND position=$3 AND step_type='assess_claim'",[run.plan.sourceRunId,owner,Number(run.plan.originalClaimPosition)])).rows[0]||null;
        const revisedStep=steps.find(s=>s.step_type==='assess_claim')||null;
        const review=revisedStep?(await db.query('SELECT review_status,reviewer_note,correction,reviewed_at FROM ultron_claim_reviews WHERE owner_id=$1 AND step_id=$2',[owner,revisedStep.id])).rows[0]||null:null;
        evidenceRepairComparison={originalRunId:run.plan.sourceRunId,repairRunId:run.plan.repairRunId,claimPosition:Number(run.plan.originalClaimPosition),claim:run.plan.originalClaim,originalAssessmentStatus:originalStep?.result?.deepAnalysis?.status||originalStep?.result?.assessmentStatus||'not_assessed',revisedAssessmentStatus:revisedStep?.result?.deepAnalysis?.status||revisedStep?.result?.assessmentStatus||'pending',originalSourceCount:Number(originalStep?.result?.sourceCount||originalStep?.result?.allSources?.length||0),revisedSourceCount:Number(revisedStep?.result?.sourceCount||0),revisedSources:revisedStep?.result?.allSources||[],reviewStatus:review?.review_status||'pending',reviewerNote:review?.reviewer_note||'',correction:review?.correction||'',factualTruthVerified:false};
      }
      return res.json({run,steps,specialistTasks,specialistRevisions,missionRevisions,evidenceRepairs,recoveryEvents,evidenceRepairComparison,coordination});
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
    const graphCheck=validateMissionGraph(normalized);
    if(!graphCheck.valid)return res.status(400).json({error:'Mission graph validation failed.',details:graphCheck.errors});
    for (let i=0;i<normalized.length;i++) { const s=normalized[i]; if(s.type==='save_learning'&&s.input.source_url&&!normalized.some((v,j)=>j<i&&v.type==='retrieve_source'&&v.input.url===s.input.source_url)) return res.status(400).json({error:'Add a retrieve_source step for the same source before saving sourced learning.'}); }
    for (let i=0;i<normalized.length;i++) { const s=normalized[i]; if(s.type==='assess_claim' && (!Array.isArray(s.input.source_urls) || !s.input.source_urls.every(url=>normalized.some((v,j)=>j<i&&v.type==='retrieve_source'&&v.input.url===url)))) return res.status(400).json({error:'Capture each exact source URL before assessing a claim.'}); }
    const acceptanceCriteria=Array.isArray(body.acceptanceCriteria)?body.acceptanceCriteria.map(x=>String(x).trim().slice(0,500)).filter(Boolean).slice(0,12):[];
    const allowedChecks=new Set(['search_results','sources_captured','independent_origins','contradictions_reviewed','task_persisted','knowledge_persisted','steps_completed','human_review']);
    const rawAcceptanceChecks=Array.isArray(body.acceptanceChecks)?body.acceptanceChecks.slice(0,12):[];
    const acceptanceChecks=[];
    for(const item of rawAcceptanceChecks) {
      const check=item&&typeof item==='object'&&!Array.isArray(item)?item.check||{}:{};
      const type=String(check.type||'human_review');
      if(!allowedChecks.has(type)) return res.status(400).json({error:'One or more acceptance checks use an unsupported type.'});
      const normalizedCheck={type};
      if(['search_results','sources_captured','independent_origins'].includes(type)) normalizedCheck.min=Math.max(1,Math.min(20,Number.isInteger(Number(check.min))?Number(check.min):1));
      if(type==='search_results'&&check.perStep===true) normalizedCheck.perStep=true;
      if(type==='steps_completed'&&STEP_TYPES.has(String(check.stepType||''))) normalizedCheck.stepType=String(check.stepType);
      acceptanceChecks.push({text:String(item&&item.text||'Acceptance criterion').trim().slice(0,500),check:normalizedCheck});
    }
    const planRecord=(acceptanceCriteria.length||acceptanceChecks.length)?{steps:normalized,acceptanceCriteria,acceptanceChecks,planner:body.planner||null}:normalized;
    const run = (await db.query("INSERT INTO ultron_agent_runs(owner_id,title,objective,plan) VALUES($1,$2,$3,$4::jsonb) RETURNING id,title,objective,status,created_at",[owner,title,objective,JSON.stringify(planRecord)])).rows[0];
    for (const s of normalized) {
      const savedStep=(await db.query('INSERT INTO ultron_agent_steps(run_id,owner_id,position,step_type,title,input,depends_on) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id',[run.id,owner,s.position,s.type,s.title,JSON.stringify(s.input),JSON.stringify(s.depends_on)])).rows[0];
      const role=specialistRoleForStep(s.type);
      await db.query("INSERT INTO ultron_specialist_tasks(owner_id,run_id,step_id,phase,specialist_role,capabilities,context_snapshot,status) VALUES($1,$2,$3,'execution',$4,$5::jsonb,$6::jsonb,'pending') ON CONFLICT(owner_id,step_id,phase) DO NOTHING",[owner,run.id,savedStep.id,role,JSON.stringify(specialistCapabilitiesForRole(role)),JSON.stringify({position:s.position,stepType:s.type,title:s.title,input:s.input,depends_on:s.depends_on})]);
      await db.query("INSERT INTO ultron_specialist_tasks(owner_id,run_id,step_id,phase,specialist_role,capabilities,context_snapshot,status) VALUES($1,$2,$3,'verification','verifier',$4::jsonb,$5::jsonb,'pending') ON CONFLICT(owner_id,step_id,phase) DO NOTHING",[owner,run.id,savedStep.id,JSON.stringify(specialistCapabilitiesForRole('verifier')),JSON.stringify({position:s.position,targetStepId:savedStep.id,targetRole:role,verificationContract:'independent_operation_evidence_review'})]);
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
  if (!id || !['cancel','retry','propose_replan','revise_replan','approve_replan','reject_replan'].includes(action)) return res.status(400).json({error:'Provide a run id and a supported mission action.'});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return res.status(400).json({error:'A valid mission ID is required.'});
  if(action==='propose_replan'){
    const run=(await db.query("SELECT id,status,plan,plan_version FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[id,owner])).rows[0];
    if(!run)return res.status(404).json({error:'Mission not found.'});
    if(run.status!=='failed')return res.status(409).json({error:'Adaptive replanning is available only after a mission has failed.'});
    const steps=(await db.query('SELECT position,step_type,title,input,depends_on,status,result,error FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[id,owner])).rows;
    const proposal=buildAdaptiveReplan(steps);
    if(!proposal.valid)return res.status(409).json({error:'A safe recovery plan could not be constructed.',details:proposal.errors});
    const revisionNo=Number((await db.query('SELECT COALESCE(MAX(revision_no),0)::int AS n FROM ultron_mission_revisions WHERE run_id=$1 AND owner_id=$2',[id,owner])).rows[0]?.n||0)+1;
    const status=proposal.readyForOwnerApproval?'ready_for_owner_approval':'needs_owner_input';
    const failedStep=steps.find(x=>proposal.failedRoots.includes(Number(x.position)))||{};
    const recoveryRationale={failedRoots:proposal.failedRoots,revised:proposal.revised,manualInputRequired:proposal.manualInputRequired,note:proposal.note,failureMessage:String(failedStep.error||'').slice(0,500)};
    await db.query("UPDATE ultron_mission_revisions SET status='superseded',reviewed_at=now() WHERE run_id=$1 AND owner_id=$2 AND status IN ('ready_for_owner_approval','needs_owner_input')",[id,owner]);
    const saved=(await db.query("INSERT INTO ultron_mission_revisions(owner_id,run_id,revision_no,base_plan_version,candidate_plan,affected_positions,preserved_positions,verifier,status,rationale) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb) RETURNING id,revision_no,status,verifier,affected_positions,preserved_positions,rationale,created_at",
      [owner,id,revisionNo,run.plan_version,JSON.stringify(proposal.plan),JSON.stringify(proposal.resetPositions),JSON.stringify(proposal.preservedPositions),JSON.stringify(proposal.verifier),status,JSON.stringify(recoveryRationale)])).rows[0];
    const recoveryStrategy=recoveryStrategyForRevision({id:saved.id,rationale:recoveryRationale,candidate_plan:proposal.plan,affected_positions:proposal.resetPositions});
    await db.query("INSERT INTO ultron_recovery_observations(owner_id,run_id,revision_id,event_key,event_type,strategy_type,failed_step_type,failure_category,plan_version,metadata) VALUES($1,$2,$3,$4,'proposed',$5,$6,$7,$8,$9::jsonb) ON CONFLICT(owner_id,event_key) DO NOTHING",[owner,id,saved.id,saved.id+':proposed',recoveryStrategy,String(failedStep.step_type||'unknown'),recoveryFailureCategory(failedStep.error||''),Number(run.plan_version||1),JSON.stringify({revisionNo,status,affectedPositions:proposal.resetPositions,preservedPositions:proposal.preservedPositions})]);
    return res.status(201).json({ok:true,revision:saved,proposal});
  }
  if(action==='revise_replan'){
    const revisionId=String(body.revisionId||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId))return res.status(400).json({error:'A valid revision ID is required.'});
    const revision=(await db.query("SELECT * FROM ultron_mission_revisions WHERE id=$1 AND run_id=$2 AND owner_id=$3",[revisionId,id,owner])).rows[0];
    if(!revision||revision.status!=='needs_owner_input')return res.status(409).json({error:'This revision is not waiting for owner input.'});
    const run=(await db.query("SELECT status,plan_version FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[id,owner])).rows[0];
    if(!run||run.status!=='failed'||Number(run.plan_version)!==Number(revision.base_plan_version))return res.status(409).json({error:'The mission changed. Prepare a fresh recovery plan.'});
    const inputs=body.stepInputs&&typeof body.stepInputs==='object'&&!Array.isArray(body.stepInputs)?body.stepInputs:{};
    const proposal=buildAdaptiveReplan((await db.query('SELECT position,step_type,title,input,depends_on,status,result,error FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[id,owner])).rows);
    if(!proposal.valid)return res.status(409).json({error:'The original recovery plan is no longer valid.',details:proposal.errors});
    const manualPositions=new Set(proposal.manualInputRequired.map(x=>String(x.position)));
    for(const key of Object.keys(inputs))if(!manualPositions.has(key))return res.status(400).json({error:'Owner input may only revise steps explicitly marked as requiring input.'});
    const supplied=[];
    for(const item of proposal.manualInputRequired){
      const position=String(item.position),patch=inputs[position];
      if(!patch||typeof patch!=='object'||Array.isArray(patch))return res.status(400).json({error:'Provide corrected input for step '+position+'.'});
      const step=proposal.plan.find(x=>Number(x.position)===item.position);
      const merged={...(step.input||{}),...patch};
      if(JSON.stringify(merged)===JSON.stringify(step.input||{}))return res.status(400).json({error:'Step '+position+' must receive a meaningful input change before it can be replanned.'});
      if(step.type==='verify_url'||step.type==='retrieve_source'){
        if(!safeUrl(merged.url))return res.status(400).json({error:'Step '+position+' requires a public HTTPS URL.'});
      }else if(step.type==='research_search'){
        if(!String(merged.query||'').trim()||String(merged.query).length>300)return res.status(400).json({error:'Step '+position+' needs a research query under 300 characters.'});
      }else if(step.type==='assess_claim'){
        if(!String(merged.claim||'').trim()||String(merged.claim).length>600||!Array.isArray(merged.source_urls)||merged.source_urls.length<2||merged.source_urls.length>4||new Set(merged.source_urls).size!==merged.source_urls.length)return res.status(400).json({error:'Step '+position+' needs a claim and 2–4 distinct source URLs.'});
        for(const url of merged.source_urls)if(!safeUrl(url)||!proposal.plan.some((x,j)=>j+1<item.position&&x.type==='retrieve_source'&&x.input.url===url))return res.status(400).json({error:'Every claim source must be a public HTTPS URL captured by an earlier retrieve-source step.'});
      }else if(step.type==='save_learning'){
        if(!String(merged.topic||'').trim()||(!String(merged.summary||'').trim()&&!String(merged.source_url||'').trim())||String(merged.summary||'').length>3000)return res.status(400).json({error:'Step '+position+' needs a topic and a summary or earlier captured source.'});
        if(merged.source_url&&(!safeUrl(merged.source_url)||!proposal.plan.some((x,j)=>j+1<item.position&&x.type==='retrieve_source'&&x.input.url===merged.source_url)))return res.status(400).json({error:'Learning source must be captured by an earlier retrieve-source step.'});
      }else if(step.type==='create_task'){
        if(!String(merged.title||'').trim()||String(merged.title).length>180||String(merged.body||'').length>2000)return res.status(400).json({error:'Step '+position+' needs a task title under 180 characters and details under 2,000 characters.'});
      }else if(step.type==='skill_apply'){
        if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(merged.skill_id||''))||!String(merged.task_description||'').trim()||!String(merged.metric_label||'').trim()||!Number.isFinite(Number(merged.baseline_value))||!['higher_is_better','lower_is_better'].includes(merged.metric_direction))return res.status(400).json({error:'Step '+position+' needs a valid mastered skill and complete measurement details.'});
        const skill=(await db.query("SELECT id FROM ultron_skill_modules WHERE id=$1 AND owner_id=$2 AND status='mastered'",[merged.skill_id,owner])).rows[0];
        if(!skill)return res.status(409).json({error:'Only an owner-reviewed mastered skill can be used in a recovery plan.'});
      }
      step.input=merged;
      supplied.push({position:item.position,stepType:step.type,input:merged});
    }
    const verification=verifyAdaptiveReplan((await db.query('SELECT position,step_type,title,input,depends_on,status,result,error FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[id,owner])).rows,proposal.plan,proposal.preservedPositions,proposal.resetPositions);
    if(!verification.passed)return res.status(409).json({error:'The corrected recovery plan did not pass independent validation.',details:verification.errors});
    const rationale={failedRoots:proposal.failedRoots,revised:proposal.revised,manualInputRequired:[],ownerProvidedInputs:supplied,note:'Owner corrections were validated against the original mission graph. Review and approve this version before execution resumes.'};
    const saved=(await db.query("UPDATE ultron_mission_revisions SET candidate_plan=$4::jsonb,verifier=$5::jsonb,status='ready_for_owner_approval',rationale=$6::jsonb WHERE id=$1 AND run_id=$2 AND owner_id=$3 AND status='needs_owner_input' RETURNING id,revision_no,status,verifier,rationale,created_at",[revisionId,id,owner,JSON.stringify(proposal.plan),JSON.stringify(verification),JSON.stringify(rationale)])).rows[0];
    if(!saved)return res.status(409).json({error:'The revision changed before owner corrections could be saved.'});
    await db.query("INSERT INTO ultron_recovery_observations(owner_id,run_id,revision_id,event_key,event_type,strategy_type,failed_step_type,failure_category,owner_modified_inputs,plan_version,metadata) SELECT $1,$2,$3,$4,'owner_input',$5,failed_step_type,failure_category,true,$6,$7::jsonb FROM ultron_recovery_observations WHERE owner_id=$1 AND revision_id=$3 AND event_type='proposed' ON CONFLICT(owner_id,event_key) DO NOTHING",[owner,id,revisionId,revisionId+':owner_input','owner_corrected_inputs',Number(revision.base_plan_version||1),JSON.stringify({positions:supplied.map(x=>x.position)})]);
    return res.json({ok:true,revision:saved,note:'Corrected plan passed independent structural checks. Owner approval is still required.'});
  }
  if(action==='approve_replan'){
    const revisionId=String(body.revisionId||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId))return res.status(400).json({error:'A valid revision ID is required.'});
    const revision=(await db.query("SELECT * FROM ultron_mission_revisions WHERE id=$1 AND run_id=$2 AND owner_id=$3",[revisionId,id,owner])).rows[0];
    if(!revision)return res.status(404).json({error:'Mission revision not found.'});
    if(revision.status!=='ready_for_owner_approval'||revision.verifier?.passed!==true)return res.status(409).json({error:'This revision is not independently verified and ready for owner approval.'});
    const run=(await db.query("SELECT id,status,plan,plan_version FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[id,owner])).rows[0];
    if(!run||run.status!=='failed'||Number(run.plan_version)!==Number(revision.base_plan_version))return res.status(409).json({error:'The mission state or plan version changed. Prepare a fresh recovery plan.'});
    const candidate=Array.isArray(revision.candidate_plan)?revision.candidate_plan:[];
    const resetPositions=Array.isArray(revision.affected_positions)?revision.affected_positions.map(Number):[];
    const graph=validateMissionGraph(candidate);
    if(!graph.valid||!resetPositions.length)return res.status(409).json({error:'The saved revision no longer passes graph or recovery validation.'});
    const currentSteps=(await db.query('SELECT position,status FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[id,owner])).rows;
    const currentFailed=currentSteps.some(s=>s.status==='failed');
    if(!currentFailed)return res.status(409).json({error:'No failed branch remains to replan.'});
    for(const position of resetPositions){
      const next=candidate.find(x=>Number(x.position)===position);
      if(!next)return res.status(409).json({error:'A recovery step is missing from the verified revision.'});
      await db.query("UPDATE ultron_agent_steps SET input=$4::jsonb,status='pending',result='{}'::jsonb,error='',started_at=NULL,completed_at=NULL WHERE run_id=$1 AND owner_id=$2 AND position=$3 AND status IN ('failed','pending','skipped')",[id,owner,position,JSON.stringify(next.input||{})]);
      await db.query("UPDATE ultron_specialist_tasks SET status='pending',output='{}'::jsonb,verification='{}'::jsonb,error='',lease_until=NULL,updated_at=now(),completed_at=NULL WHERE run_id=$1 AND owner_id=$2 AND step_id=(SELECT id FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND position=$3) AND status IN ('failed','skipped')",[id,owner,position]);
    }
    const nextPlan=Array.isArray(run.plan)?candidate:{...(run.plan||{}),steps:candidate};
    const updated=await db.query("UPDATE ultron_agent_runs SET plan=$3::jsonb,plan_version=plan_version+1,status='queued',error='',lease_until=NULL,completed_at=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='failed' AND plan_version=$4 RETURNING id,plan_version",[id,owner,JSON.stringify(nextPlan),revision.base_plan_version]);
    if(!updated.rows.length)return res.status(409).json({error:'Mission changed before the revised plan could be activated. No new execution was queued.'});
    await db.query("UPDATE ultron_mission_revisions SET status='approved',reviewed_at=now() WHERE id=$1 AND owner_id=$2 AND status='ready_for_owner_approval'",[revisionId,owner]);
    await db.query("INSERT INTO ultron_recovery_observations(owner_id,run_id,revision_id,event_key,event_type,strategy_type,failed_step_type,failure_category,owner_modified_inputs,plan_version,metadata) SELECT $1,$2,$3,$4,'approved',strategy_type,failed_step_type,failure_category,(owner_modified_inputs OR EXISTS(SELECT 1 FROM ultron_recovery_observations oi WHERE oi.owner_id=$1 AND oi.revision_id=$3 AND oi.event_type='owner_input')),$5,$6::jsonb FROM ultron_recovery_observations WHERE owner_id=$1 AND revision_id=$3 AND event_type='proposed' ON CONFLICT(owner_id,event_key) DO NOTHING",[owner,id,revisionId,revisionId+':approved',Number(updated.rows[0].plan_version),JSON.stringify({approvedByOwner:true})]);
    await db.query("UPDATE ultron_mission_revisions SET status='superseded' WHERE run_id=$1 AND owner_id=$2 AND id<>$3 AND status IN ('ready_for_owner_approval','needs_owner_input')",[id,owner,revisionId]);
    try{await scheduler.now('/api/ultron/jobs/agent-runner',{runId:id});}catch{return res.status(202).json({ok:true,status:'queued',workerQueued:false,planVersion:updated.rows[0].plan_version,note:'Approved recovery plan is saved. The recovery worker will resume it.'});}
    return res.status(202).json({ok:true,status:'queued',workerQueued:true,planVersion:updated.rows[0].plan_version,resetPositions,preservedPositions:revision.preserved_positions});
  }
  if(action==='reject_replan'){
    const revisionId=String(body.revisionId||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(revisionId))return res.status(400).json({error:'A valid revision ID is required.'});
    const rejected=(await db.query("UPDATE ultron_mission_revisions SET status='rejected',reviewed_at=now() WHERE id=$1 AND run_id=$2 AND owner_id=$3 AND status IN ('needs_owner_input','ready_for_owner_approval') RETURNING id,revision_no,status",[revisionId,id,owner])).rows[0];
    if(!rejected)return res.status(409).json({error:'Only an unapproved recovery proposal can be rejected.'});
    await db.query("INSERT INTO ultron_recovery_observations(owner_id,run_id,revision_id,event_key,event_type,strategy_type,failed_step_type,failure_category,plan_version,metadata) SELECT $1,$2,$3,$4,'rejected',strategy_type,failed_step_type,failure_category,plan_version,$5::jsonb FROM ultron_recovery_observations WHERE owner_id=$1 AND revision_id=$3 AND event_type='proposed' ON CONFLICT(owner_id,event_key) DO NOTHING",[owner,id,revisionId,revisionId+':rejected',JSON.stringify({reason:String(body.reason||'Owner rejected proposal').slice(0,300)})]);
    return res.json({ok:true,revision:rejected,note:'Recovery proposal rejected and retained in history. It will not execute.'});
  }
  if (action==='cancel') {
    const r=await db.query("UPDATE ultron_agent_runs SET status='cancelled',lease_until=NULL,updated_at=now(),completed_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('queued','running') RETURNING id,status",[id,owner]);
    if (!r.rows.length) return res.status(409).json({error:'This run is not cancellable.'});
    await db.query("UPDATE ultron_agent_steps SET status='skipped' WHERE run_id=$1 AND owner_id=$2 AND status IN ('pending','running')",[id,owner]);
    await db.query("UPDATE ultron_specialist_tasks SET status='skipped',lease_until=NULL,updated_at=now(),completed_at=now() WHERE run_id=$1 AND owner_id=$2 AND status IN ('pending','running')",[id,owner]);
    return res.json({ok:true,run:r.rows[0]});
  }
  const r=await db.query("UPDATE ultron_agent_runs SET status='queued',error='',lease_until=NULL,completed_at=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('failed','cancelled') RETURNING id",[id,owner]);
  if (!r.rows.length) return res.status(409).json({error:'Only failed or cancelled runs can be retried.'});
  await db.query("UPDATE ultron_agent_steps SET status='pending',error='',result='{}'::jsonb,started_at=NULL,completed_at=NULL WHERE run_id=$1 AND owner_id=$2 AND status IN ('failed','skipped')",[id,owner]);
  await db.query("UPDATE ultron_specialist_tasks SET status='pending',error='',output='{}'::jsonb,verification='{}'::jsonb,lease_until=NULL,updated_at=now(),completed_at=NULL WHERE run_id=$1 AND owner_id=$2 AND status IN ('failed','skipped')",[id,owner]);
  try { await scheduler.now('/api/ultron/jobs/agent-runner',{runId:id}); }
  catch (e) { return res.status(202).json({ok:true,status:'queued',workerQueued:false}); }
  return res.status(202).json({ok:true,status:'queued',workerQueued:true});
}