import { validateMissionGraph } from 'lib/mission-coordinator.js';

const clone=value=>JSON.parse(JSON.stringify(value??{}));
const descendantClosure=(steps,roots)=>{
  const affected=new Set(roots);
  let changed=true;
  while(changed){changed=false;for(const step of steps){if(affected.has(Number(step.position)))continue;const deps=Array.isArray(step.depends_on)?step.depends_on:[];if(deps.some(x=>affected.has(Number(x)))){affected.add(Number(step.position));changed=true;}}}
  return affected;
};
function recoverySuggestion(step){
  if(step.step_type==='research_search'){
    const old=String(step.input?.query||'').trim();
    const suffix=old.toLowerCase().includes('official documentation')?' alternative primary sources':' official documentation primary sources';
    const next=(old.slice(0,260)+suffix).slice(0,300);
    return {input:{...(step.input||{}),query:next},automaticallyRevised:next!==old,requiresOwnerInput:next===old,reason:'Broaden the search toward primary and official sources without changing the mission objective.'};
  }
  if(step.step_type==='verify_url'||step.step_type==='retrieve_source')return {input:clone(step.input),automaticallyRevised:false,requiresOwnerInput:true,reason:'A different accessible public HTTPS source may be needed. ULTRON will not invent or silently substitute a URL.'};
  if(step.step_type==='assess_claim')return {input:clone(step.input),automaticallyRevised:false,requiresOwnerInput:true,reason:'The claim and its captured sources need human review before another assessment.'};
  if(step.step_type==='save_learning')return {input:clone(step.input),automaticallyRevised:false,requiresOwnerInput:true,reason:'Review the learning topic, summary and source provenance before saving again.'};
  if(step.step_type==='create_task')return {input:clone(step.input),automaticallyRevised:false,requiresOwnerInput:true,reason:'Review the requested task details before creating another persisted task.'};
  if(step.step_type==='skill_apply')return {input:clone(step.input),automaticallyRevised:false,requiresOwnerInput:true,reason:'Review the practical task and measurement baseline before another skill application.'};
  return {input:clone(step.input),automaticallyRevised:false,requiresOwnerInput:true,reason:'This operation requires owner review before its inputs can be revised.'};
}

export function buildAdaptiveReplan(steps){
  const rows=(Array.isArray(steps)?steps:[]).map(s=>({position:Number(s.position),step_type:s.step_type,title:s.title,input:clone(s.input),depends_on:Array.isArray(s.depends_on)?s.depends_on.map(Number):[],status:s.status,result:clone(s.result),error:String(s.error||'')})).sort((a,b)=>a.position-b.position);
  const graph=validateMissionGraph(rows);
  if(!graph.valid)return {valid:false,errors:graph.errors};
  const failedRoots=rows.filter(s=>s.status==='failed').map(s=>s.position);
  if(!failedRoots.length)return {valid:false,errors:['No failed step is available for adaptive replanning.']};
  const affected=descendantClosure(rows,failedRoots);
  const preserved=rows.filter(s=>s.status==='completed').map(s=>s.position);
  const revised=[],manual=[],resetPositions=[];
  const candidate=rows.map(step=>{
    if(!affected.has(step.position)||step.status==='completed')return {position:step.position,type:step.step_type,title:step.title,input:clone(step.input),depends_on:step.depends_on};
    resetPositions.push(step.position);
    const root=failedRoots.includes(step.position);
    if(root){const suggestion=recoverySuggestion(step);if(suggestion.requiresOwnerInput)manual.push({position:step.position,stepType:step.step_type,reason:suggestion.reason});else revised.push({position:step.position,stepType:step.step_type,reason:suggestion.reason,previousInput:clone(step.input),proposedInput:clone(suggestion.input)});return {position:step.position,type:step.step_type,title:step.title,input:clone(suggestion.input),depends_on:step.depends_on};}
    return {position:step.position,type:step.step_type,title:step.title,input:clone(step.input),depends_on:step.depends_on};
  });
  const check=verifyAdaptiveReplan(rows,candidate,preserved,resetPositions);
  return {valid:check.passed,errors:check.errors,plan:candidate,failedRoots,affectedPositions:[...affected].sort((a,b)=>a-b),resetPositions,preservedPositions:preserved,revised,manualInputRequired:manual,verifier:check,readyForOwnerApproval:check.passed&&manual.length===0,note:'Only failed steps and their non-completed dependents are reconsidered. Completed steps remain untouched. Approval is always required before execution resumes.'};
}

export function verifyAdaptiveReplan(original,candidate,preservedPositions,resetPositions){
  const errors=[];
  const graph=validateMissionGraph(candidate);
  if(!graph.valid)errors.push(...graph.errors);
  const before=new Map((Array.isArray(original)?original:[]).map(x=>[Number(x.position),x]));
  const after=new Map((Array.isArray(candidate)?candidate:[]).map(x=>[Number(x.position),x]));
  for(const position of preservedPositions||[]){const a=before.get(Number(position)),b=after.get(Number(position));if(!a||!b||a.step_type!==b.type||a.title!==b.title||JSON.stringify(a.input)!==JSON.stringify(b.input)||JSON.stringify(a.depends_on||[])!==JSON.stringify(b.depends_on||[]))errors.push('Completed step '+position+' was changed in the candidate plan.');}
  const allowed=new Set((resetPositions||[]).map(Number));
  for(const [position,step] of before){const next=after.get(position);if(!next){errors.push('Candidate removed step '+position+'.');continue;}if(!allowed.has(position)&&(step.step_type!==next.type||step.title!==next.title||JSON.stringify(step.input||{})!==JSON.stringify(next.input||{})||JSON.stringify(step.depends_on||[])!==JSON.stringify(next.depends_on||[])))errors.push('Unaffected step '+position+' was modified.');}
  if(after.size!==before.size)errors.push('Candidate changed the number of mission steps.');
  return {passed:errors.length===0,errors,checks:{dependencyGraph:graph.valid,completedStepsPreserved:errors.every(x=>!x.startsWith('Completed step')),unaffectedStepsUnchanged:errors.every(x=>!x.startsWith('Unaffected step')),stepCountPreserved:after.size===before.size},independentOfExecutionResult:true,factualAccuracyVerified:false};
}