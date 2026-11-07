const TERMINAL_OUTCOMES = new Set(['operationally_verified','retryable_failure','failed','verifier_rejected']);

export function createLessonObservationEvents(lessons, outcome, attempt, stepType, observedAt = new Date().toISOString()) {
  if (!Array.isArray(lessons)) return [];
  return lessons.filter(x => x && x.id).map(x => ({
    lessonId: String(x.id),
    lesson: String(x.lesson || '').slice(0, 1200),
    confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0)),
    stepType: String(stepType || ''),
    attempt: Math.max(1, Number(attempt) || 1),
    outcome: String(outcome || 'started'),
    consulted: true,
    verifierPassed: outcome === 'operationally_verified',
    observedAt
  }));
}

export function summarizeLessonEffectiveness(events, minimumSample = 5) {
  const groups = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || !event.lessonId || !TERMINAL_OUTCOMES.has(event.outcome)) continue;
    const key = String(event.lessonId);
    if (!groups.has(key)) groups.set(key, { lessonId:key, lesson:String(event.lesson || '').slice(0,1200), stepType:String(event.stepType || ''), attempts:0, operationallyVerified:0, retryableFailures:0, terminalFailures:0, verifierRejections:0 });
    const item = groups.get(key);
    item.attempts++;
    if (event.outcome === 'operationally_verified') item.operationallyVerified++;
    if (event.outcome === 'retryable_failure') item.retryableFailures++;
    if (event.outcome === 'failed') item.terminalFailures++;
    if (event.outcome === 'verifier_rejected') item.verifierRejections++;
  }
  return [...groups.values()].map(item => {
    const unsuccessful = item.retryableFailures + item.terminalFailures + item.verifierRejections;
    const sufficient = item.attempts >= Math.max(1, Number(minimumSample) || 5);
    return {
      ...item,
      unsuccessfulAttempts: unsuccessful,
      operationalSuccessRate: item.attempts ? Number((item.operationallyVerified / item.attempts).toFixed(3)) : null,
      evidenceLevel: sufficient ? 'descriptive_only' : 'insufficient_evidence',
      recommendation: sufficient ? 'review_pattern_not_causation' : 'collect_more_observations',
      causalEffectEstablished: false,
      autoPromotionAllowed: false
    };
  }).sort((a,b) => b.attempts-a.attempts || a.lessonId.localeCompare(b.lessonId));
}