const terminal=new Set(['terminal_completed','terminal_failed']);
const pct=(a,b)=>b?Math.round(a/b*1000)/10:null;
const classifyFailure=(s='')=>{const x=String(s).toLowerCase();if(/403|forbidden|unauthori[sz]ed|permission/.test(x))return 'access_denied';if(/timeout|timed out|network|fetch failed|temporar|429|rate limit/.test(x))return 'transient_or_rate_limit';if(/verifier rejected|verification/.test(x))return 'verification_rejection';if(/no useful result|no result|empty result/.test(x))return 'insufficient_results';if(/invalid|unsupported|malformed|validation/.test(x))return 'input_or_validation';return 'other';};
export function recoveryStrategyForRevision(r={}) {
 const rationale=r.rationale||{}, revised=Array.isArray(rationale.revised)?rationale.revised:[];
 const manual=Array.isArray(rationale.manualInputRequired)?rationale.manualInputRequired:[];
 const supplied=Array.isArray(rationale.ownerProvidedInputs)?rationale.ownerProvidedInputs:[];
 if(supplied.length)return 'owner_corrected_inputs';
 if(revised.some(x=>x.stepType==='research_search'))return 'broadened_research_query';
 if(manual.some(x=>x.stepType==='retrieve_source'||x.stepType==='verify_url'))return 'source_replacement_required';
 if(manual.length)return 'owner_reviewed_operation_inputs';
 return 'bounded_branch_replan';
}
export function recoveryFailureCategory(error=''){return classifyFailure(error);}
export function summarizeRecoveryEvidence(events=[],minimum=5) {
 const rows=Array.isArray(events)?events:[];
 const byStrategy=new Map();
 for(const e of rows){const key=String(e.strategy_type||'unknown');if(!byStrategy.has(key))byStrategy.set(key,[]);byStrategy.get(key).push(e);}
 return [...byStrategy.entries()].map(([strategyType,items])=>{
  const revisions=new Map();for(const e of items){const id=String(e.revision_id);if(!revisions.has(id))revisions.set(id,[]);revisions.get(id).push(e);}
  const all=[...revisions.values()];
  const event=(xs,t)=>xs.find(x=>x.event_type===t);
  const proposed=all.filter(xs=>event(xs,'proposed')).length;
  const approved=all.filter(xs=>event(xs,'approved')).length;
  const rejected=all.filter(xs=>event(xs,'rejected')).length;
  const terminalRows=all.filter(xs=>xs.some(e=>e.event_type==='terminal_completed'||e.event_type==='terminal_failed'));
  const completed=terminalRows.filter(xs=>xs.some(e=>e.event_type==='terminal_completed')).length,failed=terminalRows.filter(xs=>xs.some(e=>e.event_type==='terminal_failed')).length;
  const observations=terminalRows.length,verified=terminalRows.filter(xs=>xs.some(e=>e.event_type==='terminal_completed'&&e.metadata?.operationallyVerified===true)).length;
  const ownerModified=all.filter(xs=>event(xs,'owner_input')).length;
  const retries=terminalRows.reduce((n,x)=>{const e=x.find(v=>v.event_type==='terminal_completed'||v.event_type==='terminal_failed');return n+Number(e?.metadata?.retryCount||0);},0);
  const reasons={};for(const xs of all){const e=event(xs,'proposed');if(e)reasons[e.failure_category]=(reasons[e.failure_category]||0)+1;}
  const rate=observations?verified/observations:null;
  const recommendation=observations<minimum?'insufficient_evidence':rate>=0.8?'promising_review':rate<0.5?'investigate_recovery': 'mixed_results_review';
  return {strategyType,debugEventTypes:items.map(x=>String(x.event_type)),debugTerminalMatches:items.filter(x=>String(x.event_type||'').startsWith('terminal_')).length,proposed,approved,rejected,observations,completed,failed,verified,ownerModifiedInputs:ownerModified,retries,approvalRate:proposed?approved/proposed:null,completionRate:observations?completed/observations:null,verifiedRate:rate,verifiedRatePercent:pct(verified,observations),failureCategories:reasons,recommendation,minimumObservations:minimum,automaticSelection:false,automaticPromotion:false,causalEffectEstablished:false,baselineComparison:{available:false,note:'No matched or workload-adjusted baseline is available yet; comparisons remain descriptive.'}};
 }).sort((a,b)=>b.observations-a.observations||b.proposed-a.proposed);
}
export function buildRecoveryObservationEvent(revision,run,eventType,metadata={}) {
 const strategyType=recoveryStrategyForRevision(revision);
 const failedType=String(revision?.rationale?.failedRoots?.[0]?.stepType||revision?.rationale?.manualInputRequired?.[0]?.stepType||revision?.candidate_plan?.find?.(x=>revision?.affected_positions?.includes?.(x.position))?.type||'unknown');
 const failedError=String(revision?.rationale?.failureMessage||revision?.rationale?.error||'');
 return {event_key:String(revision.id)+':'+eventType,revision_id:revision.id,run_id:run.id,event_type:eventType,strategy_type:strategyType,failed_step_type:failedType,failure_category:classifyFailure(failedError),owner_modified_inputs:strategyType==='owner_corrected_inputs',plan_version:Number(run.plan_version||revision.base_plan_version||1),metadata};
}