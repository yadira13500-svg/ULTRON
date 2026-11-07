const EXPERIMENT_STEP_TYPES = new Set(['research_search','verify_url','retrieve_source']);

function stableBucket(value) {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2;
}

const TERMINAL_OUTCOMES = new Set(['operationally_verified','retryable_failure','failed','verifier_rejected']);

export function createLessonObservationEvents(lessons, outcome, attempt, stepType, observedAt = new Date().toISOString()) {
  if (!Array.isArray(lessons)) return [];
  return lessons.filter(x => x && x.id).map(x => ({
    lessonId:String(x.id), lesson:String(x.lesson||'').slice(0,1200),
    confidence:Math.max(0,Math.min(1,Number(x.confidence)||0)), stepType:String(stepType||''),
    attempt:Math.max(1,Number(attempt)||1), outcome:String(outcome||'started'),
    consulted:true, verifierPassed:outcome==='operationally_verified', observedAt
  }));
}

export function summarizeLessonEffectiveness(events, minimumSample = 5) {
  const groups=new Map();
  for(const event of Array.isArray(events)?events:[]) {
    if(!event||!event.lessonId||!TERMINAL_OUTCOMES.has(event.outcome))continue;
    const key=String(event.lessonId);
    if(!groups.has(key))groups.set(key,{lessonId:key,lesson:String(event.lesson||'').slice(0,1200),stepType:String(event.stepType||''),attempts:0,operationallyVerified:0,retryableFailures:0,terminalFailures:0,verifierRejections:0});
    const item=groups.get(key);item.attempts++;
    if(event.outcome==='operationally_verified')item.operationallyVerified++;
    if(event.outcome==='retryable_failure')item.retryableFailures++;
    if(event.outcome==='failed')item.terminalFailures++;
    if(event.outcome==='verifier_rejected')item.verifierRejections++;
  }
  return [...groups.values()].map(item=>{
    const unsuccessful=item.retryableFailures+item.terminalFailures+item.verifierRejections;
    const sufficient=item.attempts>=Math.max(1,Number(minimumSample)||5);
    return {...item,unsuccessfulAttempts:unsuccessful,operationalSuccessRate:item.attempts?Number((item.operationallyVerified/item.attempts).toFixed(3)):null,evidenceLevel:sufficient?'descriptive_only':'insufficient_evidence',recommendation:sufficient?'review_pattern_not_causation':'collect_more_observations',causalEffectEstablished:false,autoPromotionAllowed:false};
  }).sort((a,b)=>b.attempts-a.attempts||a.lessonId.localeCompare(b.lessonId));
}

export function applyApprovedStrategyPolicy(approvedLessons, policy) {
  const lessons=Array.isArray(approvedLessons)?approvedLessons:[];
  if(policy?.enabled!==true)return lessons;
  return lessons.filter(lesson=>String(lesson.id)===String(policy.lessonId)&&String(lesson.evidence?.stepType||'')===String(policy.stepType||'')).slice(0,1);
}

export function recommendLessonStrategies(approvedLessons, observations, minimumSample = 5) {
  const lessons=Array.isArray(approvedLessons)?approvedLessons:[];
  const events=Array.isArray(observations)?observations:[];
  return lessons.map(lesson=>{
    const matched=events.filter(event=>event&&String(event.lessonId)===String(lesson.id)&&String(event.stepType||'')===String(lesson.evidence?.stepType||'')&&TERMINAL_OUTCOMES.has(event.outcome));
    const verified=matched.filter(event=>event.outcome==='operationally_verified'&&event.verifierPassed===true).length;
    const retries=matched.filter(event=>event.outcome==='retryable_failure').length;
    const failures=matched.filter(event=>event.outcome==='failed').length;
    const rejections=matched.filter(event=>event.outcome==='verifier_rejected').length;
    const count=matched.length,rate=count?verified/count:null,minimum=Math.max(1,Number(minimumSample)||5);
    let recommendation='collect_more_evidence',label='Insufficient evidence';
    if(count>=minimum&&rate>=0.8){recommendation='retain_for_human_review';label='Promising — review before continued use';}
    else if(count>=minimum&&rate<0.5){recommendation='investigate_before_reuse';label='Weak outcomes — investigate before reuse';}
    else if(count>=minimum){recommendation='mixed_results_review';label='Mixed outcomes — inspect failures and context';}
    return {lessonId:String(lesson.id),lesson:String(lesson.lesson||'').slice(0,1200),stepType:String(lesson.evidence?.stepType||''),observations:count,minimumSample:minimum,verified,retries,failures,verifierRejections:rejections,operationalSuccessRate:rate===null?null:Number(rate.toFixed(3)),recommendation,label,automaticSelection:false,automaticPromotion:false,reason:count<minimum?'The lesson does not yet have enough terminal observations for a strategy recommendation.':recommendation==='retain_for_human_review'?'Observed outcomes are promising but may reflect task mix or other confounders.':recommendation==='investigate_before_reuse'?'Observed operational failures or verifier rejections warrant owner review.':'Results are mixed; inspect task difficulty, input quality and failure categories.'};
  }).sort((a,b)=>{const order={investigate_before_reuse:0,mixed_results_review:1,retain_for_human_review:2,collect_more_evidence:3};return order[a.recommendation]-order[b.recommendation]||b.observations-a.observations;});
}

export function assignLessonExperiment({ enabled, runId, stepId, stepType, lessons = [] }) {
  const eligible = enabled === true && EXPERIMENT_STEP_TYPES.has(String(stepType || '')) && Array.isArray(lessons) && lessons.length > 0;
  if (!eligible) return { enabled:false, eligible:false, experimentId:'approved_lesson_stratified_v1', cohort:'not_enrolled', stepType:String(stepType || ''), lessonIds:[] };
  const cohort = stableBucket(String(runId) + ':' + String(stepId)) === 0 ? 'treatment' : 'control';
  return {
    enabled:true,
    eligible:true,
    experimentId:'approved_lesson_stratified_v1',
    allocation:'stable_hash_50_50_by_step_id',
    cohort,
    stepType:String(stepType),
    lessonIds:cohort === 'treatment' ? lessons.map(x=>String(x.id)) : [],
    eligibleLessonCount:lessons.length,
    safety:'Only approved operational lessons are withheld in the opt-in control cohort; mission cancellation, verifier and write-safety guards remain active.'
  };
}

export function createExperimentObservationEvent(assignment, outcome, attempt, verifierPassed = false, observedAt = new Date().toISOString(), verifierRejections = 0) {
  if (!assignment?.enabled || !assignment?.eligible || !['treatment','control'].includes(assignment.cohort)) return null;
  if (!['operationally_verified','retryable_failure','failed','verifier_rejected'].includes(outcome)) return null;
  return {
    experimentId:assignment.experimentId,
    cohort:assignment.cohort,
    stepType:assignment.stepType,
    outcome,
    attempt:Math.max(1,Number(attempt)||1),
    verifierPassed:verifierPassed === true,
    verifierRejections:Math.max(0,Number(verifierRejections)||0),
    observedAt
  };
}

export function summarizeLessonExperiment(events, minimumPerCohort = 5) {
  const groups = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.experimentId !== 'approved_lesson_stratified_v1' || !['treatment','control'].includes(event.cohort) || !['operationally_verified','retryable_failure','failed','verifier_rejected'].includes(event.outcome)) continue;
    const key = String(event.stepType || '') + ':' + event.cohort;
    if (!groups.has(key)) groups.set(key,{stepType:String(event.stepType||''),cohort:event.cohort,attempts:0,verified:0,retries:0,failures:0,verifierRejections:0});
    const g=groups.get(key);g.attempts++;
    if(event.outcome==='operationally_verified'&&event.verifierPassed)g.verified++;
    if(event.outcome==='retryable_failure')g.retries++;
    if(event.outcome==='failed')g.failures++;
    g.verifierRejections+=Math.max(0,Number(event.verifierRejections)||(event.outcome==='verifier_rejected'?1:0));
  }
  const types=[...new Set([...groups.values()].map(x=>x.stepType))];
  return types.map(stepType=>{
    const treatment=groups.get(stepType+':treatment')||{stepType,cohort:'treatment',attempts:0,verified:0,retries:0,failures:0,verifierRejections:0};
    const control=groups.get(stepType+':control')||{stepType,cohort:'control',attempts:0,verified:0,retries:0,failures:0,verifierRejections:0};
    const minimum=Math.max(3,Number(minimumPerCohort)||5);
    const sufficient=treatment.attempts>=minimum&&control.attempts>=minimum;
    const rate=x=>x.attempts?Number((x.verified/x.attempts).toFixed(3)):null;
    const treatmentRate=rate(treatment),controlRate=rate(control);
    return {
      stepType,treatment:{...treatment,operationalSuccessRate:treatmentRate},
      control:{...control,operationalSuccessRate:controlRate},
      minimumPerCohort:minimum,
      evidenceLevel:sufficient?'descriptive_comparison':'insufficient_evidence',
      differencePercentagePoints:sufficient?Number(((treatmentRate-controlRate)*100).toFixed(1)):null,
      causalEffectEstablished:false,
      recommendation:sufficient?'review_for_confounders_before_any_conclusion':'collect_more_balanced_observations',
      note:'Cohorts are stably allocated within operation type. This is a descriptive comparison, not proof of causation; inputs, difficulty and time may differ.'
    };
  }).sort((a,b)=>a.stepType.localeCompare(b.stepType));
}