import { specialistRoleForStep } from 'lib/mission-runtime.js';
import { buildMissionIntelligence } from 'lib/mission-intelligence.js';

export function validateMissionGraph(steps) {
  const rows=Array.isArray(steps)?steps:[];
  const positions=rows.map(x=>Number(x?.position));
  const errors=[];
  if(!rows.length)errors.push('Mission graph has no steps.');
  if(rows.length>16)errors.push('Mission graph exceeds the 16-step limit.');
  if(new Set(positions).size!==positions.length)errors.push('Mission graph contains duplicate step positions.');
  rows.forEach((step,index)=>{
    const position=Number(step?.position);
    if(position!==index+1)errors.push('Step positions must be contiguous and ordered from 1.');
    const deps=Array.isArray(step?.depends_on)?step.depends_on:[];
    if(new Set(deps).size!==deps.length)errors.push('Step '+position+' repeats a dependency.');
    for(const dep of deps)if(!Number.isInteger(dep)||dep<1||dep>=position)errors.push('Step '+position+' has an invalid or forward dependency '+String(dep)+'.');
  });
  return {valid:errors.length===0,errors,stepCount:rows.length,edgeCount:rows.reduce((n,x)=>n+(Array.isArray(x?.depends_on)?x.depends_on.length:0),0)};
}

function safeArray(value){return Array.isArray(value)?value:[];}
function hostOf(value){try{return new URL(String(value)).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
export function buildMissionCoordinationReport(steps, acceptance = null, specialistTasks = []) {
  const rows=safeArray(steps).slice().sort((a,b)=>Number(a.position)-Number(b.position));
  const graph=validateMissionGraph(rows);
  const roles={researcher:0,analyst:0,executor:0,coordinator:0};
  const states={completed:0,failed:0,pending:0,running:0,skipped:0};
  const edges=[];
  const conflicts=[];
  const sourceUrls=new Set(), sourceHosts=new Set();
  const verificationFailures=[];
  for(const step of rows){
    const role=specialistRoleForStep(step.step_type);
    roles[role]=(roles[role]||0)+1;
    states[step.status]=(states[step.status]||0)+1;
    for(const dep of safeArray(step.depends_on))edges.push({from:Number(dep),to:Number(step.position)});
    const result=step.result||{};
    for(const item of safeArray(result.results)){if(item?.url){sourceUrls.add(String(item.url));const host=hostOf(item.url);if(host)sourceHosts.add(host);}}
    if(result.url&&result.retrieved===true){sourceUrls.add(String(result.url));const host=hostOf(result.url);if(host)sourceHosts.add(host);}
    const verification=result.independentVerification||{};
    if(step.status==='completed'&&verification.passed===false)verificationFailures.push({position:step.position,title:step.title,challenge:safeArray(verification.challenge).slice(0,5)});
    const assessment=result.deepAnalysis||result.assessment?.deepAnalysis||{};
    const candidates=[...safeArray(assessment.contradictions),...safeArray(assessment.contradictionCandidates),...safeArray(assessment.candidates).filter(x=>/contradict|conflict/i.test(String(x?.stance||x?.type||'')))];
    for(const candidate of candidates.slice(0,12))conflicts.push({stepPosition:step.position,title:step.title,signal:String(candidate?.reason||candidate?.sentence||candidate?.text||candidate?.type||'Contradiction candidate').slice(0,360),sourceUrl:String(candidate?.url||candidate?.sourceUrl||'').slice(0,1000),status:'requires_human_review'});
  }
  const acceptanceStatus=acceptance?.status||'not_evaluated';
  const unmet=Number(acceptance?.counts?.unmet||0), needsReview=Number(acceptance?.counts?.needs_review||0);
  const allDone=rows.length>0&&rows.every(x=>x.status==='completed');
  const allVerified=allDone&&rows.every(x=>x.result?.independentVerification?.passed===true);
  const factualReviewRequired=rows.some(x=>x.step_type==='assess_claim')||conflicts.length>0;
  const missionIntelligence=buildMissionIntelligence(rows,acceptance,specialistTasks);
  return {
    graph:{...graph,edges},
    specialistAllocation:roles,
    execution:{...states,total:rows.length,allStepsCompleted:allDone,allIndependentChecksPassed:allVerified},
    evidence:{uniqueSourceUrls:sourceUrls.size,distinctSourceHosts:sourceHosts.size,contradictionCandidates:conflicts.length,conflicts:conflicts.slice(0,20),verificationFailures},
    acceptance:{status:acceptanceStatus,unmet,needsReview},
    missionIntelligence,
    coordinatorDecision:!graph.valid?'blocked_invalid_graph':rows.some(x=>x.status==='failed')?'mission_failed_recovery_required':!allDone?'in_progress':!allVerified?'verification_incomplete':unmet>0?'acceptance_not_met':needsReview>0?'owner_review_required':factualReviewRequired?'human_factual_review_required':'operational_checks_passed',
    factualAccuracyVerified:false,
    note:'The coordinator reconciles recorded task states, independent operation checks, source provenance and explicit contradiction candidates. It does not infer factual truth; claim verdicts and detected conflicts remain subject to human review.'
  };
}