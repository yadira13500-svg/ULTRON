// Independent, deterministic specialist review of persisted operation results.
// This verifier checks evidence and read-backs; it does not certify factual truth.

export function buildRevisionRequest(step, result, verification, revisionNo) {
  if (revisionNo !== 1 || step?.step_type !== 'research_search') return null;
  const failed = Array.isArray(verification?.checks) ? verification.checks.filter(x => !x.ok) : [];
  if (!failed.length) return null;
  const input = step.input || {};
  const original = String(input.query || '').trim();
  if (!original || original.length > 260) return null;
  const suffix = ' official sources primary research reports';
  const base = original.slice(0, Math.max(1, 300 - suffix.length)).trim();
  const revisedQuery = (base + suffix).slice(0, 300);
  if (!revisedQuery || revisedQuery === original) return null;
  return {
    instruction: 'The independent verifier found no usable titled HTTPS research leads. Broaden the query toward official sources and primary research; return only real search results and do not invent evidence.',
    input: { ...input, query: revisedQuery },
    reason: failed.map(x => String(x.name) + ': ' + String(x.evidence || '')).join('; ').slice(0, 1200),
    maxRevisions: 1,
    mode: 'bounded_deterministic_query_revision'
  };
}
export async function verifyStepResult(step, result, db, owner, runId) {
  const checks = [];
  const add = (name, ok, evidence) => checks.push({name,ok:!!ok,evidence:String(evidence||'').slice(0,300)});
  const r = result || {};
  if (step.step_type === 'research_search') {
    const items = Array.isArray(r.results) ? r.results : [];
    const valid = items.filter(x => x && String(x.title||'').trim() && /^https:\/\//i.test(String(x.url||'')));
    add('search_leads_have_titles_and_https_urls', valid.length > 0, valid.length+' valid HTTPS lead(s) of '+items.length+' returned');
  } else if (step.step_type === 'verify_url') {
    add('url_reachability_status', r.reachable === true && Number(r.status) >= 200 && Number(r.status) < 300, 'HTTP '+String(r.status||'unknown'));
  } else if (step.step_type === 'retrieve_source') {
    add('source_content_captured', r.retrieved === true && String(r.excerpt||'').trim().length >= 80 && /^https:\/\//i.test(String(r.url||'')), 'Captured excerpt length '+String(String(r.excerpt||'').length));
  } else if (step.step_type === 'assess_claim') {
    const saved = (await db.query('SELECT review_status,assessment_status,assessment FROM ultron_claim_reviews WHERE owner_id=$1 AND run_id=$2 AND step_id=$3',[owner,runId,step.id])).rows[0];
    const sourceCount = Number(saved?.assessment?.sourceCount || 0);
    const independentOrigins = Number(saved?.assessment?.deepAnalysis?.independence?.independentGroupCount ?? saved?.assessment?.independentPublisherCount ?? 0);
    add('claim_review_record_readback', !!saved && !!String(saved.review_status||'').trim(), 'Review status '+String(saved?.review_status||'missing'));
    add('claim_sources_present', sourceCount >= 2, sourceCount+' captured source(s)');
    add('claim_independent_origins_present', independentOrigins >= 2, independentOrigins+' independent origin group(s) among '+sourceCount+' captured source(s)');
    add('factual_verdict_not_auto_promoted', r.verified === false, 'Factual accuracy remains subject to human review');
  } else if (step.step_type === 'create_task') {
    const saved = (await db.query('SELECT id,title,kind FROM ultron_items WHERE owner_id=$1 AND agent_step_id=$2',[owner,step.id])).rows[0];
    add('task_persisted_readback', !!saved && saved.kind === 'task' && saved.title === String(step.input?.title||'').trim(), saved?.id||'No matching persisted task');
  } else if (step.step_type === 'save_learning') {
    const saved = (await db.query('SELECT id,topic,summary,source_url FROM ultron_knowledge WHERE owner_id=$1 AND agent_step_id=$2',[owner,step.id])).rows[0];
    add('knowledge_persisted_readback', !!saved && saved.topic === String(step.input?.topic||'').trim().slice(0,240) && !!saved.summary, saved?.id||'No matching persisted knowledge record');
  } else if (step.step_type === 'skill_apply') {
    const saved = (await db.query('SELECT id,skill_id,run_id,status FROM ultron_skill_applications WHERE owner_id=$1 AND agent_step_id=$2',[owner,step.id])).rows[0];
    add('skill_application_persisted_readback', !!saved && saved.run_id === runId && saved.status === 'awaiting_outcome', saved?.id||'No matching persisted skill application');
  } else {
    add('known_specialist_operation', false, 'No independent verifier contract exists for this step type');
  }
  const failed = checks.filter(x=>!x.ok);
  return {role:'verifier',passed:failed.length===0,checks,challenge:failed.length?failed.map(x=>x.name+': '+x.evidence):[],verificationType:'independent_operation_evidence_review',factualAccuracyVerified:false,reviewedAt:new Date().toISOString()};
}