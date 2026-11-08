const CONTRACTS = {
  coordinator: {
    purpose: 'Coordinate mission scope, dependencies and acceptance criteria.',
    required: ['ordered_steps','explicit_dependencies','acceptance_criteria'],
    rules: ['Do not claim execution occurred.','Preserve completed work during replanning.','Escalate ambiguous or unsafe actions for owner approval.']
  },
  researcher: {
    purpose: 'Find and capture relevant public evidence with traceable provenance.',
    required: ['source_title','https_url','publisher_or_host','publication_date_or_unknown','captured_passage_or_search_snippet'],
    rules: ['Treat search results as leads, not facts.','Separate primary sources, secondary reporting and scholarly indexes.','Never invent a source, quotation, date or publisher.','Record missing evidence explicitly.']
  },
  analyst: {
    purpose: 'Compare evidence, test claims and identify uncertainty.',
    required: ['claim_atoms','supporting_evidence','contradicting_evidence','assumptions','confidence_limits','unresolved_questions'],
    rules: ['Do not equate keyword overlap with entailment.','Compare definitions, dates, scope and source context.','Keep contradictory evidence visible.','Do not label a claim true solely from source counts.']
  },
  executor: {
    purpose: 'Perform only the authorized, owner-scoped operation and read it back.',
    required: ['authorized_operation','immutable_input_identity','persisted_result','readback_check'],
    rules: ['Do not exceed granted permissions.','Do not spend paid credits or invoke paid providers without approval.','Use idempotent writes and preserve existing records.','Report partial completion and errors accurately.']
  },
  verifier: {
    purpose: 'Independently challenge the recorded result against its acceptance contract.',
    required: ['expected_state','observed_state','evidence_of_readback','failed_checks','verdict'],
    rules: ['Do not reuse the executor assertion as proof.','Inspect persisted state or source evidence independently.','Distinguish operational success from factual correctness.','Reject unsupported claims and identify the smallest corrective action.']
  }
};

const copy = value => JSON.parse(JSON.stringify(value));
export function specialistContractForRole(role) {
  const key = String(role || '');
  const contract = CONTRACTS[key];
  return contract ? { role: key, ...copy(contract) } : null;
}
export function buildSpecialistContext(role, step, extra = {}) {
  const contract = specialistContractForRole(role);
  if (!contract) throw new Error('Unknown specialist role: ' + String(role));
  const row = step || {};
  return {
    contextVersion: 'specialist_context_v1',
    role,
    contract,
    task: {
      position: Number(row.position || 0),
      stepType: String(row.step_type || row.stepType || ''),
      title: String(row.title || ''),
      input: copy(row.input || {}),
      depends_on: copy(row.depends_on || row.dependsOn || [])
    },
    extra: copy(extra || {}),
    executionBoundary: role === 'executor' ? 'authorized_owner_scoped_operations_only' : 'no_external_side_effects',
    truthBoundary: 'This context defines a work contract; it is not evidence that the task ran or that any claim is true.'
  };
}
const ROLE_INSTRUCTIONS = {
  researcher: 'You are the research specialist. Find evidence relevant to the question. Return only structured findings with source title, exact URL, publisher, date or unknown, short supporting passage, relevance, and limitations. Never infer a fact from a search-result title alone.',
  analyst: 'You are the analysis specialist. Independently inspect the supplied evidence packet. Break the question into atomic claims; map support and contradiction to specific source URLs; compare dates, definitions and scope; identify assumptions and missing evidence. Do not treat source count as proof.',
  verifier: 'You are the independent verification specialist. Challenge the proposed conclusion, not defend it. Check whether each material claim is entailed by cited evidence, whether sources are independent, whether contradictions remain, and whether operational read-back proves the claimed action. Return a verdict with failed checks and evidence URLs. Never certify factual truth from process success.'
};
export function buildSpecialistReasoningMessages(role, task, evidence = {}) {
  if (!ROLE_INSTRUCTIONS[role]) throw new Error('No independent reasoning session is defined for role: ' + String(role));
  const bounded = JSON.stringify({ task: copy(task || {}), evidence: copy(evidence || {}) });
  return [
    { role: 'system', content: ROLE_INSTRUCTIONS[role] + ' Output valid JSON only. If evidence is insufficient, say so explicitly. Do not invent citations, quotations, dates, or results.' },
    { role: 'user', content: bounded.slice(0, 24000) }
  ];
}
export function specialistReasoningSelfTest() {
  const packet = { claim: 'A test claim', sources: [{ title: 'Source A', url: 'https://example.org/a', excerpt: 'Example evidence' }] };
  const research = buildSpecialistReasoningMessages('researcher', { query: packet.claim }, packet);
  const analysis = buildSpecialistReasoningMessages('analyst', { claim: packet.claim }, packet);
  const verify = buildSpecialistReasoningMessages('verifier', { proposedConclusion: 'Candidate' }, packet);
  const distinct = new Set([research[0].content, analysis[0].content, verify[0].content]).size === 3;
  const isolated = research[1].content !== analysis[1].content && analysis[1].content !== verify[1].content &&
    [research, analysis, verify].every(x => x.length === 2 && x[0].role === 'system' && x[1].role === 'user');
  const bounded = research[1].content.length <= 24000 && verify[0].content.includes('Never certify factual truth');
  return { name: 'independent_specialist_reasoning_session_contracts', ok: distinct && isolated && bounded, semantic: distinct && isolated && bounded,
    distinctRoleInstructions: distinct, separateMessageSnapshots: isolated, boundedEvidencePacket: bounded,
    detail: 'Researcher, analyst and verifier have distinct system instructions and isolated JSON evidence packets. This validates session construction only; no model inference is enabled or claimed.' };
}

export function specialistContextSelfTest() {
  const step = { position: 2, step_type: 'assess_claim', title: 'Assess claim', input: { claim: 'A test claim' }, depends_on: [1] };
  const researcher = buildSpecialistContext('researcher', step);
  const analyst = buildSpecialistContext('analyst', step);
  const verifier = buildSpecialistContext('verifier', step, { targetRole: 'analyst', expectedResult: { status: 'candidate' } });
  const isolated = researcher.contract.purpose !== analyst.contract.purpose &&
    analyst.contract.purpose !== verifier.contract.purpose &&
    researcher.contract.required.includes('https_url') &&
    analyst.contract.required.includes('contradicting_evidence') &&
    verifier.contract.required.includes('evidence_of_readback') &&
    verifier.extra.targetRole === 'analyst' &&
    researcher.task.input.claim === analyst.task.input.claim;
  const safe = specialistContractForRole('executor').rules.some(x => /paid credits/i.test(x)) &&
    specialistContractForRole('analyst').rules.some(x => /claim true/i.test(x));
  return { name: 'specialist_context_contract_isolation', ok: isolated && safe, semantic: isolated && safe,
    detail: isolated && safe ? 'Research, analysis and verification have distinct versioned contracts and separate context snapshots; the verifier receives an explicit target role and read-back requirement.' : 'Specialist contracts are missing role-specific requirements or safety boundaries.',
    isolated, safe, contextVersion: researcher.contextVersion };
}