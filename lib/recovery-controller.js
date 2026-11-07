const HUMAN_APPROVAL_TYPES = new Set(['external_action','device_control','publish_content','send_message','payment','purchase','delete_external']);
export function decideRecoveryAction(snapshot={}) {
  const step=snapshot.step||{};
  if(step.status==='completed') return {action:'preserve',reason:'Completed step is authoritative; never reopen or replay it.',safeToExecute:false};
  if(snapshot.activeLease===true || step.has_active_execution_task===true || step.hasActiveExecutionTask===true)
    return {action:'wait',reason:'A valid execution lease is still active.',safeToExecute:false};
  if(snapshot.externalSideEffect===true || HUMAN_APPROVAL_TYPES.has(String(step.step_type||'')))
    return {action:'human_approval',reason:'This operation may create an external side effect; recovery requires owner approval.',safeToExecute:false};
  if(snapshot.dependenciesReady===false)
    return {action:'wait',reason:'One or more prerequisite steps are not complete.',safeToExecute:false};
  const failure=String(snapshot.failure||step.error||'');
  if(failure) {
    const transient=/(408|425|429|500|502|503|504)|timeout|temporarily unavailable|network|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(failure);
    if(!transient) return {action:'replan',reason:'The recorded failure is not classified as transient; change the plan or inputs before retrying.',safeToExecute:false};
    if(Number(snapshot.attempts||step.attempts||0)>=3) return {action:'human_approval',reason:'The bounded retry budget is exhausted.',safeToExecute:false};
    return {action:'retry',reason:'The failure appears transient and remains within the bounded retry budget.',safeToExecute:true};
  }
  if(step.status==='running' || step.status==='pending')
    return {action:'resume',reason:'No active lease or completed result blocks safe continuation.',safeToExecute:true};
  return {action:'replan',reason:'The current state is ambiguous; do not execute automatically.',safeToExecute:false};
}
export function recoveryEventKey(runId, stepId, action, attempt=0) {
  return [String(runId),String(stepId||'run'),String(action),String(attempt||0)].join(':');
}