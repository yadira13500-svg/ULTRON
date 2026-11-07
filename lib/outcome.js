// General mission-outcome verification: evaluates structured acceptance checks against persisted step results.
// met = machine-checked against evidence; unmet = machine-checked and failed; needs_review = only a human can decide.
export function verifyOutcome(checks, steps) {
  const done = steps.filter(s => s.status === 'completed');
  const by = type => done.filter(s => s.step_type === type);
  const R = s => (s && s.result) || {};
  const results = (Array.isArray(checks) ? checks : []).map(item => {
    const text = typeof item === 'string' ? item : String(item.text || '');
    const c = (typeof item === 'object' && item.check) || { type: 'human_review' };
    let status = 'needs_review', evidence = '';
    switch (c.type) {
      case 'search_results': {
        const research=by('research_search');
        const n=research.reduce((total,s)=>total+(Array.isArray(R(s).results)?R(s).results.length:0),0);
        if(c.perStep===true) {
          const withResults=research.filter(s=>Array.isArray(R(s).results)&&R(s).results.length>0).length;
          status=research.length>0&&withResults===research.length&&research.length>=(c.min||1)?'met':'unmet';
          evidence=withResults+' of '+research.length+' research subtask(s) returned at least one lead; '+n+' lead(s) total.';
        } else {
          status=n >= (c.min || 1) ? 'met' : 'unmet';
          evidence=n+' search lead(s) returned.';
        }
        break; }
      case 'sources_captured': {
        const n = by('retrieve_source').filter(s => R(s).retrieved === true).length;
        status = n >= (c.min || 1) ? 'met' : 'unmet'; evidence = n + ' source(s) captured with content.'; break; }
      case 'independent_origins': {
        const a = by('assess_claim').map(R).pop();
        if (!a) { status = 'unmet'; evidence = 'No claim assessment was completed.'; break; }
        const n = a.deepAnalysis?.independence?.independentGroupCount ?? a.independentPublisherCount ?? 0;
        status = n >= (c.min || 2) ? 'met' : 'unmet'; evidence = n + ' independent origin group(s) among ' + (a.sourceCount ?? '?') + ' source(s).'; break; }
      case 'contradictions_reviewed': {
        const a = by('assess_claim').map(R).pop();
        if (!a) { status = 'unmet'; evidence = 'No claim assessment was completed.'; break; }
        const k = (a.contradictionCandidates || []).length;
        status = k === 0 ? 'met' : 'needs_review'; evidence = k === 0 ? 'No contradiction candidates were flagged.' : k + ' contradiction candidate(s) need your inspection.'; break; }
      case 'task_persisted': {
        const ok = by('create_task').filter(s => R(s).item && R(s).item.id);
        status = ok.length ? 'met' : 'unmet'; evidence = ok.length ? 'Task ' + R(ok[0]).item.id + ' read back from the owner-scoped list.' : 'No persisted task was found.'; break; }
      case 'knowledge_persisted': {
        const ok = by('save_learning').filter(s => R(s).knowledge && R(s).knowledge.id);
        status = ok.length ? 'met' : 'unmet'; evidence = ok.length ? 'Knowledge record ' + R(ok[0]).knowledge.id + ' read back.' : 'No persisted knowledge record was found.'; break; }
      case 'steps_completed': {
        const all = steps.filter(s => s.step_type === c.stepType), ok = all.filter(s => s.status === 'completed');
        status = all.length && ok.length === all.length ? 'met' : 'unmet'; evidence = ok.length + ' of ' + all.length + ' ' + c.stepType + ' step(s) completed.'; break; }
      default: status = 'needs_review'; evidence = 'Only a human reviewer can decide this criterion.';
    }
    return { criterion: text, check: c.type || 'human_review', status, evidence };
  });
  const counts = { met: 0, unmet: 0, needs_review: 0 }; results.forEach(r => counts[r.status]++);
  const status = !results.length ? 'no_criteria_defined' : counts.unmet ? 'criteria_unmet' : counts.needs_review ? 'criteria_met_pending_review' : 'criteria_met';
  return { status, counts, criteria: results, note: 'Machine checks evaluate returned search leads, source capture, persistence and source-independence signals. They do not establish factual accuracy or prove publisher independence.' };
}