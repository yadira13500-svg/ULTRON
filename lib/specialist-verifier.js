import { buildDocumentContext } from 'lib/document-context.js';

// Independent, deterministic specialist review of persisted operation results.
// This verifier checks evidence and read-backs; it does not certify factual truth.

export function verifyClaimPassageAnchors(passages,captured,expectedSourceCount) {
  const rows=Array.isArray(passages)?passages:[],sources=Array.isArray(captured)?captured:[];
  const checks=rows.map(p=>{const source=sources.find(x=>x.url===p.url&&x.retrieved===true);const quote=String(p.exactQuote||'');const start=Number(p.startOffset),end=Number(p.endOffset);const context=String(p.contextExcerpt||''),contextStart=Number(p.contextStartOffset),contextEnd=Number(p.contextEndOffset);const recomputed=source?buildDocumentContext(p.claimText||'',String(source.excerpt||''),start,end):null;const expectedContext=recomputed?String(recomputed.contextText||'').slice(0,1400):'';const expectedSegments=recomputed?.contextSegments||[];const suppliedSegments=Array.isArray(p.contextSegments)?p.contextSegments:[];const segmentsAnchored=!!recomputed&&suppliedSegments.length===expectedSegments.length&&expectedSegments.every((seg,i)=>{const got=suppliedSegments[i];return !!got&&got.paragraphIndex===seg.paragraphIndex&&got.startOffset===seg.startOffset&&got.endOffset===seg.endOffset&&got.reason===seg.reason&&got.text===seg.text&&String(source.excerpt||'').slice(got.startOffset,got.endOffset)===got.text;});const contextAnchored=!!source&&p.contextOffsetBasis==='captured_source_excerpt_utf16'&&Number.isInteger(contextStart)&&Number.isInteger(contextEnd)&&contextStart>=0&&contextEnd>contextStart&&contextEnd-contextStart===context.length&&context.length>0&&String(source.excerpt||'').slice(contextStart,contextEnd)===context&&p.contextId===String(p.index)+':ctx:'+String(contextStart)+':'+String(contextEnd)&&context.includes(quote)&&!!recomputed&&recomputed.contextStartOffset===contextStart&&expectedContext===context&&JSON.stringify(p.contextParagraphIndexes||[])===JSON.stringify(recomputed.contextParagraphIndexes||[])&&p.contextVersion==='document_context_v2'&&segmentsAnchored;const anchored=!!source&&p.offsetBasis==='captured_source_excerpt_utf16'&&Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>start&&end-start===quote.length&&quote.length>0&&String(source.excerpt||'').slice(start,end)===quote&&p.passageId===String(p.index)+':'+String(start)+':'+String(end)&&contextAnchored;return {url:p.url,anchored,contextAnchored};});
  return {passed:rows.length===Number(expectedSourceCount)&&checks.length>=2&&checks.every(x=>x.anchored),checks,anchoredCount:checks.filter(x=>x.anchored).length};
}

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
export function verifyResearchSearchResult(result) {
  const r=result||{}, items=Array.isArray(r.results)?r.results:[];
  const valid=items.filter(x=>x&&String(x.title||'').trim()&&/^https:\/\//i.test(String(x.url||'')));
  const hosts=new Set(valid.map(x=>{try{return new URL(x.url).hostname.toLowerCase().replace(/^www\\./,'')}catch{return ''}}).filter(Boolean));
  const checks=[];
  const add=(name,ok,evidence)=>checks.push({name,ok:!!ok,evidence:String(evidence||'').slice(0,300)});
  add('search_leads_have_titles_and_https_urls',valid.length>0,valid.length+' valid HTTPS lead(s) of '+items.length+' returned');
  add('research_host_diversity',valid.length<3||hosts.size>=3,hosts.size+' distinct hosts across '+valid.length+' usable leads; host diversity is not proof of publisher independence');
  const coverage=r.research_coverage||{};
  if(coverage.scholarly_search_attempted===true){
    const providers=Array.isArray(coverage.providers)?coverage.providers:[];
    add('scholarly_provider_coverage_reported',providers.length>0,providers.length+' scholarly provider status record(s) returned');
    if(Number(coverage.scholarly_results||0)>0)add('scholarly_leads_included_in_mission',valid.some(x=>x.source_kind==='scholarly_index'),'Scholarly results reported: '+Number(coverage.scholarly_results||0)+'; included in mission result: '+valid.some(x=>x.source_kind==='scholarly_index'));
  }
  add('search_results_not_claimed_as_factual_verdict',r.verified!==true,'Search discovery is operationally checked only; factual accuracy remains unverified unless a separate claim review is completed.');
  return {role:'verifier',passed:checks.every(x=>x.ok),checks,challenge:checks.filter(x=>!x.ok).map(x=>x.name+': '+x.evidence),verificationType:'independent_research_quality_review',factualAccuracyVerified:false,distinctHostCount:hosts.size,validLeadCount:valid.length};
}

export async function verifyStepResult(step, result, db, owner, runId) {
  const checks = [];
  const add = (name, ok, evidence) => checks.push({name,ok:!!ok,evidence:String(evidence||'').slice(0,300)});
  const r = result || {};
  if (step.step_type === 'research_search') {
    const review=verifyResearchSearchResult(r);
    for(const check of review.checks)add(check.name,check.ok,check.evidence);
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
    const captured=(await db.query("SELECT result FROM ultron_agent_steps WHERE run_id=$1 AND owner_id=$2 AND step_type='retrieve_source' AND status='completed' ORDER BY position",[runId,owner])).rows.map(x=>x.result||{});
    const passages=Array.isArray(saved?.assessment?.deepAnalysis?.perSource)?saved.assessment.deepAnalysis.perSource:[];
    const anchorReview=verifyClaimPassageAnchors(passages,captured,sourceCount);
    add('claim_passage_anchors_match_captured_sources',anchorReview.passed,anchorReview.anchoredCount+' of '+anchorReview.checks.length+' exact passage anchors matched persisted captured source text');
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