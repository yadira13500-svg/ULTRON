import { db, scheduler } from 'hatchable';
import { buildMissionCoordinationReport } from 'lib/mission-coordinator.js';
import { buildEvidenceRepairProposal, verifyEvidenceRepairProposal } from 'lib/evidence-repair.js';
import { specialistRoleForStep, specialistCapabilitiesForRole } from 'lib/mission-runtime.js';

export const access='admin';
export const methods=['GET','POST'];
const uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||''));
export default async function(req,res){
 const owner=String(req.member.id);
 if(req.method==='GET'){
  const runId=String(req.query?.runId||'');
  if(!uuid(runId))return res.status(400).json({error:'A valid source mission ID is required.'});
  const run=(await db.query('SELECT id,title,objective,status,result FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2',[runId,owner])).rows[0];
  if(!run)return res.status(404).json({error:'Source mission not found.'});
  const steps=(await db.query('SELECT id,position,step_type,title,input,depends_on,status,result,error FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[runId,owner])).rows;
  const specialistTasks=(await db.query('SELECT step_id,phase,specialist_role,status,output,verification,error FROM ultron_specialist_tasks WHERE run_id=$1 AND owner_id=$2 ORDER BY created_at',[runId,owner])).rows;
  const coordination=buildMissionCoordinationReport(steps,run.result?.acceptance||null,specialistTasks);
  const proposal=buildEvidenceRepairProposal(run,steps,coordination.missionIntelligence);
  const verification=verifyEvidenceRepairProposal(proposal);
  const history=(await db.query('SELECT id,proposal_no,status,created_run_id,created_at,reviewed_at,proposal FROM ultron_evidence_repairs WHERE source_run_id=$1 AND owner_id=$2 ORDER BY proposal_no DESC LIMIT 10',[runId,owner])).rows;
  return res.json({sourceRun:run,proposal,verification,history});
 }
 const body=req.body||{},action=String(body.action||''),sourceRunId=String(body.sourceRunId||'');
 if(!uuid(sourceRunId))return res.status(400).json({error:'A valid source mission ID is required.'});
 if(action==='propose'){
  const run=(await db.query("SELECT id,title,objective,status,result FROM ultron_agent_runs WHERE id=$1 AND owner_id=$2",[sourceRunId,owner])).rows[0];
  if(!run)return res.status(404).json({error:'Source mission not found.'});
  if(!['completed','failed'].includes(run.status))return res.status(409).json({error:'Evidence repair is available after a mission reaches a terminal state.'});
  const steps=(await db.query('SELECT id,position,step_type,title,input,depends_on,status,result,error FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 ORDER BY position',[sourceRunId,owner])).rows;
  const specialists=(await db.query('SELECT step_id,phase,specialist_role,status,output,verification,error FROM ultron_specialist_tasks WHERE run_id=$1 AND owner_id=$2 ORDER BY created_at',[sourceRunId,owner])).rows;
  const report=buildMissionCoordinationReport(steps,run.result?.acceptance||null,specialists);
  const proposal=buildEvidenceRepairProposal(run,steps,report.missionIntelligence);
  const checked=verifyEvidenceRepairProposal(proposal);
  if(!checked.passed)return res.status(409).json({error:'Repair proposal failed its safety checks.',details:checked.errors});
  if(!proposal.tasks.length)return res.status(200).json({ok:true,created:false,proposal,note:'No actionable evidence repair tasks were identified.'});
  const n=Number((await db.query('SELECT COALESCE(MAX(proposal_no),0)::int AS n FROM ultron_evidence_repairs WHERE owner_id=$1 AND source_run_id=$2',[owner,sourceRunId])).rows[0]?.n||0)+1;
  await db.query("UPDATE ultron_evidence_repairs SET status='superseded',reviewed_at=now() WHERE owner_id=$1 AND source_run_id=$2 AND status='pending_owner_approval'",[owner,sourceRunId]);
  const saved=(await db.query("INSERT INTO ultron_evidence_repairs(owner_id,source_run_id,proposal_no,status,proposal) VALUES($1,$2,$3,'pending_owner_approval',$4::jsonb) RETURNING id,proposal_no,status,created_at",[owner,sourceRunId,n,JSON.stringify(proposal)])).rows[0];
  return res.status(201).json({ok:true,created:true,repair:{...saved,proposal},verification:checked,note:'Proposal saved. No follow-up mission has started; owner approval is required.'});
 }
 const proposalId=String(body.proposalId||'');
 if(!uuid(proposalId))return res.status(400).json({error:'A valid repair proposal ID is required.'});
 if(action==='reject'){
  const row=(await db.query("UPDATE ultron_evidence_repairs SET status='rejected',reviewed_at=now() WHERE id=$1 AND source_run_id=$2 AND owner_id=$3 AND status='pending_owner_approval' RETURNING id,status",[proposalId,sourceRunId,owner])).rows[0];
  if(!row)return res.status(409).json({error:'Only a pending repair proposal can be rejected.'});
  return res.json({ok:true,repair:row,note:'Proposal retained in history and will not execute.'});
 }
 if(action==='approve'){
  const saved=(await db.query("SELECT * FROM ultron_evidence_repairs WHERE id=$1 AND source_run_id=$2 AND owner_id=$3",[proposalId,sourceRunId,owner])).rows[0];
  if(!saved)return res.status(404).json({error:'Repair proposal not found.'});
  if(saved.status!=='pending_owner_approval')return res.status(409).json({error:'This repair proposal is no longer pending approval.'});
  const proposal=saved.proposal,checked=verifyEvidenceRepairProposal(proposal);
  if(!checked.passed)return res.status(409).json({error:'Stored repair proposal failed validation.',details:checked.errors});
  const claim=(await db.query("UPDATE ultron_evidence_repairs SET status='approved',reviewed_at=now() WHERE id=$1 AND owner_id=$2 AND status='pending_owner_approval' RETURNING id",[proposalId,owner])).rows[0];
  if(!claim)return res.status(409).json({error:'Proposal was already reviewed.'});
  const title=('Evidence repair: '+String(proposal.sourceMissionTitle||'ULTRON mission')).slice(0,180);
  const objective=String(proposal.objective||'Repair evidence gaps and independently verify new research leads.').slice(0,2000);
  const plan=proposal.tasks.map((t,i)=>({position:i+1,type:'research_search',title:String(t.title).slice(0,180),input:t.input,depends_on:[]}));
  const created=(await db.query("INSERT INTO ultron_agent_runs(owner_id,title,objective,plan) VALUES($1,$2,$3,$4::jsonb) RETURNING id,title,status,created_at",[owner,title,objective,JSON.stringify({steps:plan,sourceRunId,repairProposalId:proposalId,repairVersion:proposal.version})])).rows[0];
  for(const step of plan){
   const row=(await db.query('INSERT INTO ultron_agent_steps(run_id,owner_id,position,step_type,title,input,depends_on) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb) RETURNING id',[created.id,owner,step.position,step.type,step.title,JSON.stringify(step.input),JSON.stringify(step.depends_on)])).rows[0];
   const role=specialistRoleForStep(step.type);
   await db.query("INSERT INTO ultron_specialist_tasks(owner_id,run_id,step_id,phase,specialist_role,capabilities,context_snapshot,status) VALUES($1,$2,$3,'execution',$4,$5::jsonb,$6::jsonb,'pending') ON CONFLICT(owner_id,step_id,phase) DO NOTHING",[owner,created.id,row.id,role,JSON.stringify(specialistCapabilitiesForRole(role)),JSON.stringify({position:step.position,stepType:step.type,title:step.title,input:step.input,sourceRunId,repairProposalId:proposalId})]);
   await db.query("INSERT INTO ultron_specialist_tasks(owner_id,run_id,step_id,phase,specialist_role,capabilities,context_snapshot,status) VALUES($1,$2,$3,'verification','verifier',$4::jsonb,$5::jsonb,'pending') ON CONFLICT(owner_id,step_id,phase) DO NOTHING",[owner,created.id,row.id,JSON.stringify(specialistCapabilitiesForRole('verifier')),JSON.stringify({position:step.position,targetStepId:row.id,targetRole:role,verificationContract:'independent_operation_evidence_review',evidenceRepair:true,sourceRunId})]);
  }
  await db.query('UPDATE ultron_evidence_repairs SET created_run_id=$3 WHERE id=$1 AND owner_id=$2',[proposalId,owner,created.id]);
  try{await scheduler.now('/api/ultron/jobs/agent-runner',{runId:created.id});}
  catch{return res.status(202).json({ok:true,run:created,workerQueued:false,note:'Approved follow-up mission is durably queued for the recovery worker.'});}
  return res.status(202).json({ok:true,run:created,workerQueued:true,note:'Approved evidence-repair mission started. Every research step has a separate verifier task.'});
 }
 return res.status(400).json({error:'Unsupported evidence repair action.'});
}