// Sentinel creates a review-ready packet from a single authorized observation.
// It organizes provider text and user-supplied provenance; it does not infer threats or certify facts.
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);

export function buildSentinelAssessment(input = {}) {
  const observation = clean(input.observation, 5000);
  if (!observation) throw new Error('An observation description is required.');
  const sourceType = clean(input.sourceType || 'uploaded_image', 80);
  const sourceMode = clean(input.sourceMode || 'user_upload', 80);
  const sourceLabel = clean(input.sourceLabel || 'User-provided image', 180);
  const capturedAt = clean(input.capturedAt || '', 80);
  const analystNotes = clean(input.analystNotes || '', 1200);
  return {
    schema: 'ultron.sentinel.assessment.v1',
    generatedAt: new Date().toISOString(),
    classification: 'UNCLASSIFIED · USER-SUPPLIED MATERIAL',
    status: 'pending_human_review',
    purpose: 'Authorized observation and condition-assessment support',
    source: { type: sourceType, mode: sourceMode, label: sourceLabel, capturedAt: capturedAt || null },
    observation: { text: observation, origin: 'AI-generated description; not independently verified' },
    analystNotes: analystNotes || null,
    reviewChecklist: [
      'Confirm the source is authentic, complete and authorized for this use.',
      'Check capture time, location and context against independent records.',
      'Separate directly visible facts from interpretation and missing information.',
      'Seek a second independent source before relying on consequential conclusions.',
      'Record disagreements and preserve the original source unchanged.'
    ],
    limitations: [
      'This packet does not identify people, infer intent, rank threats or select targets.',
      'No person tracking, persistent surveillance, weapon guidance or device control is performed.',
      'The description may omit details or contain errors; it is not a verified finding.',
      'No location, timestamp or operational context is inferred when it was not supplied.'
    ],
    controls: { humanReviewRequired: true, factualVerification: 'not_performed', actionExecution: false, deviceControl: false, identityRecognition: false, targeting: false },
  };
}

export function sentinelAssessmentSelfTest() {
  const report = buildSentinelAssessment({
    observation: 'A visible crack appears on the exterior wall.',
    sourceType: 'uploaded_image',
    sourceMode: 'user_upload',
    sourceLabel: 'Inspection photo'
  });
  const rejectsEmpty = (() => { try { buildSentinelAssessment({ observation: '   ' }); return false; } catch { return true; } })();
  const safe = report.status === 'pending_human_review'
    && report.controls.humanReviewRequired
    && report.controls.actionExecution === false
    && report.controls.targeting === false
    && report.reviewChecklist.length === 5
    && report.limitations.length >= 4
    && rejectsEmpty;
  return { ok: safe, schema: report.schema, reviewItems: report.reviewChecklist.length, limitations: report.limitations.length, rejectsEmpty, noActionExecution: report.controls.actionExecution === false, detail: safe ? 'Structured assessment packet preserves provenance, separates unverified observation from fact, requires human review and has no action execution.' : 'Sentinel assessment packet invariant failed.' };
}