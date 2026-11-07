import { checkSourceFreshness } from 'lib/source-check.js';
import { searchPublicWeb } from 'lib/search.js';
import { extractResearchQuery, planMission } from 'lib/mission-plan.js';
import { evaluateMissionPlanner } from 'lib/mission-plan-evaluation.js';
import { classifyStepFailure, dependenciesSatisfied, runParallel, specialistRoleForStep, specialistCapabilitiesForRole, shouldRecoverRunningStep, isMissionActive, MAX_SPECIALIST_CONCURRENCY } from 'lib/mission-runtime.js';
import { verifyStepResult, buildRevisionRequest, verifyClaimPassageAnchors } from 'lib/specialist-verifier.js';
import { validateMissionGraph, buildMissionCoordinationReport } from 'lib/mission-coordinator.js';
import { buildMissionIntelligence } from 'lib/mission-intelligence.js';
import { buildEvidenceRepairProposal, verifyEvidenceRepairProposal, buildRepairedClaimAssessmentPlan } from 'lib/evidence-repair.js';
import { buildAdaptiveReplan, verifyAdaptiveReplan } from 'lib/mission-replanning.js';
import { summarizeRecoveryEvidence, recoveryStrategyForRevision, recoveryFailureCategory } from 'lib/recovery-evaluation.js';
import { analyzeSentence, analyzeClaimEvidence, stanceOf, sourceIndependence, evaluateExplicitCalculation } from 'lib/claims.js';
import { buildDocumentContext } from 'lib/document-context.js';
import { verifyOutcome } from 'lib/outcome.js';
import { sentinelSafetySelfTest } from 'lib/sentinel-safety.js';
import { sentinelAssessmentSelfTest } from 'lib/sentinel-assessment.js';
import { sensorAssessmentSelfTest } from 'lib/sensor-intelligence.js';
import { matchesTaskReplay, matchesKnowledgeReplay, matchesSkillApplicationReplay } from 'lib/mission-idempotency.js';
import { decideRecoveryAction, recoveryEventKey } from 'lib/recovery-controller.js';
import { createLessonObservationEvents, summarizeLessonEffectiveness, assignLessonExperiment, createExperimentObservationEvent, summarizeLessonExperiment, recommendLessonStrategies, applyApprovedStrategyPolicy, summarizeStrategyTrialOutcomes } from 'lib/learning-evaluation.js';

export const access = 'scheduler';
export const methods = ['POST'];

// Daily self-test of the free services ULTRON depends on. Failures show up as function errors in the logs.
const CHECKS = {
  weather: 'https://api.open-meteo.com/v1/forecast?latitude=-1.29&longitude=36.82&current=temperature_2m',
  wikipedia: 'https://en.wikipedia.org/api/rest_v1/page/summary/Nairobi',
  currency: 'https://open.er-api.com/v6/latest/USD',
  news: 'https://news.google.com/rss?hl=en-KE&gl=KE&ceid=KE:en',
  };

async function probe(name, url) {
  const t0 = Date.now();
  let timer;
  try {
    const ctl = new AbortController();
    timer = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'ULTRON-selftest/1.0', 'Accept': 'application/json,application/rss+xml,application/xml,text/html' } });
    const contentType = String(r.headers.get('content-type') || '').toLowerCase();
    const body = await r.text();
    clearTimeout(timer);
    if (!r.ok) return { name, ok: false, status: r.status, ms: Date.now() - t0, contentType, error: 'HTTP request failed.' };
    let semantic = false, detail = '';
    try {
      if (name === 'weather') { const d=JSON.parse(body); semantic=Number.isFinite(d?.current?.temperature_2m); detail=semantic?'Current temperature field present.':'Missing current.temperature_2m.'; }
      else if (name === 'wikipedia') { const d=JSON.parse(body); semantic=typeof d?.title==='string'&&typeof d?.extract==='string'&&d.extract.length>20; detail=semantic?'Article title and readable extract present.':'Missing article title or readable extract.'; }
      else if (name === 'currency') { const d=JSON.parse(body); semantic=d?.result==='success'&&typeof d?.rates?.EUR==='number'&&typeof d?.time_last_update_unix==='number'; detail=semantic?'Successful exchange-rate payload with EUR rate and update timestamp.':'Exchange-rate payload is incomplete or unsuccessful.'; }
      else if (name === 'news') { semantic=/<item[\s>]/i.test(body)&&/<title[\s>]/i.test(body); detail=semantic?'RSS feed contains item and title elements.':'RSS feed has no recognizable item/title elements.'; }
      else if (name === 'search') { semantic=/class=["']result__a["']/i.test(body)&&body.length>1000; detail=semantic?'Search response contains result links.':'Search response contains no recognizable result links.'; }
    } catch { detail='Response could not be parsed or did not match the expected service schema.'; }
    return { name, ok: semantic, status: r.status, ms: Date.now() - t0, contentType, semantic, detail, bytes: body.length };
  } catch (e) {
    if (timer) clearTimeout(timer);
    return { name, ok: false, status: 0, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) };
  }
}

function testCrashWindowReplayContracts() {
  const task={title:'Prepare report',body:'Use the approved source set.',kind:'task',status:'closed'};
  const taskExpected={title:'Prepare report',body:'Use the approved source set.'};
  const knowledge={topic:'Reliability',summary:'Original verified note',source_url:'https://example.org/a',source_name:'Example',source_status:'stale'};
  const knowledgeExpected={topic:'Reliability',summary:'Original verified note',sourceUrl:'https://example.org/a',sourceName:'Example'};
  const skill={skill_id:'skill-1',run_id:'run-1',task_description:'Practice the method',metric_label:'Accuracy',metric_direction:'higher_is_better',baseline_value:0.6,baseline_evidence:'Measured across ten attempts',status:'measured'};
  const skillExpected={skillId:'skill-1',runId:'run-1',task:'Practice the method',metric:'Accuracy',direction:'higher_is_better',baseline:0.6,baselineEvidence:'Measured across ten attempts'};
  const taskReplay=matchesTaskReplay(task,taskExpected);
  const taskConflict=!matchesTaskReplay({...task,body:'Changed body'},taskExpected);
  const knowledgeReplay=matchesKnowledgeReplay(knowledge,knowledgeExpected);
  const knowledgeConflict=!matchesKnowledgeReplay({...knowledge,source_name:'Different publisher'},knowledgeExpected);
  const skillReplay=matchesSkillApplicationReplay(skill,skillExpected);
  const skillConflict=!matchesSkillApplicationReplay({...skill,baseline_evidence:'Changed measurement'},skillExpected);
  const statusPreserved=task.status==='closed'&&knowledge.source_status==='stale'&&skill.status==='measured';
  const ok=taskReplay&&taskConflict&&knowledgeReplay&&knowledgeConflict&&skillReplay&&skillConflict&&statusPreserved;
  return {name:'crash_window_idempotent_replay_contracts',ok,semantic:ok,detail:ok?'Exact replays reuse the original task, knowledge and skill-application identities; changed immutable inputs are rejected; later lifecycle states are preserved.':'A replay contract accepted changed content or failed to preserve a later lifecycle state.',taskReplay,taskConflictRejected:taskConflict,knowledgeReplay,knowledgeConflictRejected:knowledgeConflict,skillReplay,skillConflictRejected:skillConflict,lifecycleStatePreserved:statusPreserved};
}

function testMissionPlanningRegression() {
  const objective='Research and compare current approaches to autonomous multi-agent mission coordination, including reliability risks and evaluation methods.';
  const query=extractResearchQuery(objective);
  const plan=planMission(objective);
  const queryClean=!/^and\\s+/i.test(query)&&/current approaches to autonomous multi-agent mission coordination/i.test(query);
  const planClean=plan.steps.length>0&&plan.steps.every(step=>step.type==='research_search'&&/current approaches to autonomous multi-agent mission coordination/i.test(step.input.query));
  const result={name:'mission_planning_natural_language',ok:queryClean&&planClean,semantic:queryClean&&planClean,detail:queryClean&&planClean?'Compound research instruction is normalized into the actual research topic.':'Planner retained conjunction/action words or produced an incorrect research query.',query,stepCount:plan.steps.length,plannerMode:plan.planner?.mode};
  return result;
}

async function testPublicSearch() {
  const t0=Date.now();
  try {
    let data=await searchPublicWeb('Nairobi Kenya city official information');
    let results=(data.results||[]).filter(x=>x&&x.title&&/^https:\/\//i.test(String(x.url||'')));
    let relevant=results.some(x=>(String(x.title)+' '+String(x.url)).toLowerCase().includes('nairobi'));
    if(!relevant) {
      const response=await fetch('https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=Nairobi%20Kenya%20city&format=json&utf8=1&srlimit=5',{timeout_ms:7000,headers:{'Accept':'application/json','User-Agent':'ULTRON-selftest/1.0'}});
      if(response.ok){const payload=await response.json();const fallback=(payload.query?.search||[]).map(x=>({title:x.title,url:'https://en.wikipedia.org/?curid='+x.pageid}));if(fallback.length){data={source:'Wikipedia public-index fallback'};results=fallback;relevant=fallback.some(x=>String(x.title).toLowerCase().includes('nairobi'));}}
    }
    return {name:'search',ok:results.length>0&&relevant,status:200,ms:Date.now()-t0,semantic:results.length>0&&relevant,detail:relevant?'Public search returned a Nairobi-relevant result; Wikipedia is used only when general search is temporarily unavailable.':'No relevant result was returned by general search or the independent public-index fallback.',source:data.source,resultCount:results.length,example:results[0]?.url||''};
  } catch(e) {
    return {name:'search',ok:false,status:0,ms:Date.now()-t0,semantic:false,error:String(e?.message||e).slice(0,160)};
  }
}

function testAdaptiveMissionReplanning() {
  const steps=[
    {position:1,step_type:'research_search',title:'Completed research',input:{query:'baseline'},depends_on:[],status:'completed',result:{independentVerification:{passed:true}}},
    {position:2,step_type:'research_search',title:'Failed research',input:{query:'narrow topic'},depends_on:[1],status:'failed',error:'No useful results'},
    {position:3,step_type:'verify_url',title:'Dependent source check',input:{url:'https://example.org/source'},depends_on:[2],status:'pending'},
    {position:4,step_type:'research_search',title:'Independent completed branch',input:{query:'separate'},depends_on:[],status:'completed',result:{independentVerification:{passed:true}}}
  ];
  const proposal=buildAdaptiveReplan(steps);
  const manual=buildAdaptiveReplan([{position:1,step_type:'retrieve_source',title:'Fetch source',input:{url:'https://example.org/a'},depends_on:[],status:'failed',error:'HTTP 403'}]);
  const tampered=proposal.plan.map(x=>({...x}));
  tampered[0]={...tampered[0],input:{query:'tampered completed work'}};
  const tamperCheck=verifyAdaptiveReplan(steps,tampered,proposal.preservedPositions,proposal.resetPositions);
  const ok=proposal.valid&&proposal.readyForOwnerApproval&&proposal.resetPositions.join(',')==='2,3'&&proposal.preservedPositions.join(',')==='1,4'&&proposal.revised.length===1&&proposal.plan[1].input.query!=='narrow topic'&&proposal.verifier.passed&&!manual.readyForOwnerApproval&&manual.manualInputRequired.length===1&&tamperCheck.passed===false&&proposal.verifier.factualAccuracyVerified===false;
  return {name:'adaptive_mission_replanning_and_preservation',ok,semantic:ok,detail:ok?'A failed research branch receives a bounded revised query; only that branch and pending dependents reset; completed work is preserved; source URL substitutions require owner input; tampered completed work is rejected.':'Adaptive replanning changed completed work, missed dependent tasks or bypassed owner input.',resetPositions:proposal.resetPositions,preservedPositions:proposal.preservedPositions,manualInputRequired:manual.manualInputRequired,tamperedCompletedRejected:!tamperCheck.passed};
}

function testRecoveryIntelligence() {
  const events=[];
  for(let i=0;i<5;i++){
    const id='revision-'+i;
    events.push({revision_id:id,event_type:'proposed',strategy_type:'broadened_research_query',failure_category:'insufficient_results'});
    events.push({revision_id:id,event_type:'approved',strategy_type:'broadened_research_query'});
    if(i<4)events.push({revision_id:id,event_type:'terminal_completed',strategy_type:'broadened_research_query',metadata:{operationallyVerified:true,retryCount:i===1?1:0}});
    else events.push({revision_id:id,event_type:'terminal_failed',strategy_type:'broadened_research_query',metadata:{operationallyVerified:false,retryCount:2}});
  }
  events.push({revision_id:'pending-only',event_type:'proposed',strategy_type:'owner_corrected_inputs'});
  events.push({revision_id:'pending-only',event_type:'approved',strategy_type:'owner_corrected_inputs'});
  events.push({revision_id:'rejected-only',event_type:'proposed',strategy_type:'owner_corrected_inputs'});
  events.push({revision_id:'rejected-only',event_type:'rejected',strategy_type:'owner_corrected_inputs'});
  const summaries=summarizeRecoveryEvidence(events,5),measured=summaries.find(x=>x.strategyType==='broadened_research_query'),pending=summaries.find(x=>x.strategyType==='owner_corrected_inputs');
  const strategy=recoveryStrategyForRevision({id:'x',rationale:{ownerProvidedInputs:[{position:1}],revised:[]}})==='owner_corrected_inputs';
  const category=recoveryFailureCategory('Source retrieval failed: HTTP 403')==='access_denied';
  const ok=measured?.observations===5&&measured.completed===4&&measured.failed===1&&measured.verified===4&&measured.retries===3&&measured.recommendation==='promising_review'&&measured.automaticSelection===false&&measured.causalEffectEstablished===false&&pending?.observations===0&&strategy&&category;
  return {name:'recovery_intelligence_terminal_outcomes_and_human_control',ok,semantic:ok,detail:ok?'Only approved revisions with terminal outcomes contribute; pending and rejected proposals do not inflate success; retries are measured; five-outcome recommendations remain advisory and non-causal.':'Recovery evidence counted an ineligible revision or violated the owner-approval boundary.',measured:measured?{observations:measured.observations,verified:measured.verified,retries:measured.retries,recommendation:measured.recommendation}:null,pendingObservations:pending?.observations??null};
}

function testMissionIntelligenceAdjudication() {
 const sources=[
  {position:0,step_type:'research_search',status:'completed',result:{results:[{url:'https://gamma.example/overview',title:'Discovered overview'}]}},
  {position:1,step_type:'retrieve_source',status:'completed',result:{retrieved:true,url:'https://alpha.example/report',canonicalUrl:'https://alpha.example/report',publisher:'Alpha Research',title:'Report A',publicationDate:{iso:new Date().toISOString()},excerpt:'The project reached 42 units in the measured period.',retrievedAt:new Date().toISOString()}},
  {position:2,step_type:'retrieve_source',status:'completed',result:{retrieved:true,url:'https://beta.example/report',canonicalUrl:'https://beta.example/report',publisher:'Beta Institute',title:'Report B',publicationDate:{iso:new Date().toISOString()},excerpt:'Independent analysis found the project reached 42 units in the measured period.',retrievedAt:new Date().toISOString()}}
 ];
 const claim={position:3,step_type:'assess_claim',status:'completed',title:'Assess reported total',input:{claim:'The project reached 42 units.'},result:{claim:'The project reached 42 units.',allSources:[{url:sources[0].result.url,publisher:'Alpha Research'},{url:sources[1].result.url,publisher:'Beta Institute'}],deepAnalysis:{status:'evidence_candidates_found',supportingSourceCount:2,contradictingSourceCount:0,independentSupportGroups:2,perSource:[{stance:'supports_candidate'},{stance:'supports_candidate'}],reasons:[]},contradictionCandidates:[]}};
 const good=buildMissionIntelligence([...sources,claim],{status:'criteria_met',counts:{unmet:0,needs_review:0}},[]);
 const conflictClaim={...claim,result:{...claim.result,deepAnalysis:{...claim.result.deepAnalysis,status:'conflicting_evidence',contradictingSourceCount:1,perSource:[{stance:'supports_candidate'},{stance:'contradicts_candidate'}]},contradictionCandidates:[{source:sources[1].result.url,excerpt:'The measured result was not 42 units.'}]}};
 const conflict=buildMissionIntelligence([...sources,conflictClaim],{status:'criteria_met',counts:{unmet:0,needs_review:0}},[]);
 const challenged=buildMissionIntelligence([...sources,claim],null,[{phase:'verification',status:'failed',specialist_role:'verifier',verification:{passed:false,challenge:['Evidence is incomplete.']}}]);
 const ok=good.evidence.capturedSources===2&&good.evidence.discoveredSources===1&&good.evidence.independentPublisherGroups===2&&good.factualAssessment.claimsNeedingMoreEvidence===0&&good.factualAssessment.verifiedTruth===false&&conflict.decisionReadiness==='evidence_conflicts_need_review'&&conflict.factualAssessment.conflictSignals===1&&challenged.decisionReadiness==='specialist_verification_incomplete'&&good.evidence.undatedSources===0;
 return {name:'mission_intelligence_evidence_adjudication_and_review_boundaries',ok,semantic:ok,detail:ok?'Mission intelligence distinguishes two independent supporting publishers from unresolved contradiction signals, detects verifier challenges, and never labels factual truth as verified.':'Evidence grouping, conflict readiness, freshness metadata or factual-review boundary regressed.',good:{sources:good.evidence.capturedSources,publisherGroups:good.evidence.independentPublisherGroups,decision:good.decisionReadiness},conflict:{decision:conflict.decisionReadiness,signals:conflict.factualAssessment.conflictSignals},verifierChallenge:challenged.decisionReadiness};
}

function testMissionCoordinationReview() {
  const graph=[{position:1,step_type:'research_search',depends_on:[],status:'completed',result:{results:[{url:'https://alpha.example/a'},{url:'https://beta.example/b'}],independentVerification:{passed:true}}},{position:2,step_type:'assess_claim',depends_on:[1],status:'completed',result:{deepAnalysis:{contradictions:[{reason:'Sources disagree on the reported total.',url:'https://beta.example/b'}]},independentVerification:{passed:true}}}];
  const valid=validateMissionGraph(graph),invalid=validateMissionGraph([{position:1,depends_on:[2]},{position:2,depends_on:[]}]);
  const report=buildMissionCoordinationReport(graph,{status:'criteria_met_pending_review',counts:{unmet:0,needs_review:1}});
  const failedReport=buildMissionCoordinationReport([{position:1,step_type:'retrieve_source',depends_on:[],status:'failed',result:{}}]);
  const ok=valid.valid&&!invalid.valid&&valid.edgeCount===1&&report.execution.allIndependentChecksPassed&&report.specialistAllocation.researcher===1&&report.specialistAllocation.analyst===1&&report.evidence.uniqueSourceUrls===2&&report.evidence.distinctSourceHosts===2&&report.evidence.contradictionCandidates===1&&report.coordinatorDecision==='owner_review_required'&&failedReport.coordinatorDecision==='mission_failed_recovery_required'&&report.factualAccuracyVerified===false;
  return {name:'mission_graph_coordination_and_conflict_reconciliation',ok,semantic:ok,detail:ok?'Coordinator validates dependency graphs, reconciles specialist roles and evidence provenance, surfaces contradiction candidates, and preserves human-review boundaries.':'Mission coordination graph, role, provenance or contradiction review regressed.',graphValid:valid.valid,invalidGraphRejected:!invalid.valid,decision:report.coordinatorDecision,evidence:report.evidence};
}

function testMissionRuntimePolicies() {
  const depsBlocked=!dependenciesSatisfied([1,2],[{position:1,status:'completed'},{position:2,status:'pending'}]);
  const depsReady=dependenciesSatisfied([1,2],[{position:1,status:'completed'},{position:2,status:'completed'}]);
  const retry=classifyStepFailure('HTTP 503 temporarily unavailable',1);
  const exhausted=classifyStepFailure('HTTP 503 temporarily unavailable',3);
  const statusOnly=classifyStepFailure('HTTP 503',1);
  const permanent=classifyStepFailure('HTTP 404',1);
  const roles=specialistRoleForStep('research_search')==='researcher'&&specialistRoleForStep('assess_claim')==='analyst'&&specialistRoleForStep('create_task')==='executor';
  const ok=depsBlocked&&depsReady&&retry.retry&&exhausted.terminal&&statusOnly.retry&&!permanent.transient&&!permanent.retry&&roles&&MAX_SPECIALIST_CONCURRENCY===3;
  return {name:'mission_runtime_dependency_retry_and_roles',ok,semantic:ok,detail:ok?'Dependency gating, status-only transient retry, permanent-failure handling and role routing passed.':'A dependency, retry, permanent-failure or specialist-role policy regressed.',statusOnlyRetry:statusOnly.retry,permanentFailureNotRetried:!permanent.retry,maxParallel:MAX_SPECIALIST_CONCURRENCY};
}

function testAdaptiveLearningMeasurement() {
  const lesson={id:'lesson-fixture-1',lesson:'Use an alternate accessible source after a 403.',confidence:0.8};
  const events=[
    ...createLessonObservationEvents([lesson],'started',1,'retrieve_source'),
    ...createLessonObservationEvents([lesson],'operationally_verified',1,'retrieve_source'),
    ...createLessonObservationEvents([lesson],'retryable_failure',2,'retrieve_source'),
    ...createLessonObservationEvents([lesson],'operationally_verified',3,'retrieve_source'),
    ...createLessonObservationEvents([lesson],'failed',4,'retrieve_source'),
    ...createLessonObservationEvents([lesson],'verifier_rejected',5,'retrieve_source')
  ];
  const summary=summarizeLessonEffectiveness(events,5)[0];
  const small=summarizeLessonEffectiveness(events.slice(0,4),5)[0];
  const ok=summary?.attempts===5&&summary.operationallyVerified===2&&summary.unsuccessfulAttempts===3&&summary.evidenceLevel==='descriptive_only'&&summary.operationalSuccessRate===0.4&&summary.causalEffectEstablished===false&&summary.autoPromotionAllowed===false&&small?.evidenceLevel==='insufficient_evidence'&&small?.recommendation==='collect_more_observations';
  return {name:'adaptive_learning_outcome_measurement',ok,semantic:ok,detail:ok?'Only terminal observations are counted; verifier-passed and failed attempts remain distinct; small samples are marked insufficient; descriptive patterns never establish causation or auto-promote lessons.':'Adaptive learning measurement overstated its evidence or miscounted outcomes.',summary,smallSampleLevel:small?.evidenceLevel};
}

function testLessonExperimentAllocation() {
  const lesson={id:'lesson-exp-1',lesson:'Use an alternative source after a retrieval failure.',confidence:0.8};
  const disabled=assignLessonExperiment({enabled:false,runId:'r1',stepId:'s1',stepType:'verify_url',lessons:[lesson]});
  const writeBlocked=assignLessonExperiment({enabled:true,runId:'r1',stepId:'s2',stepType:'create_task',lessons:[lesson]});
  const first=assignLessonExperiment({enabled:true,runId:'r1',stepId:'s3',stepType:'verify_url',lessons:[lesson]});
  const same=assignLessonExperiment({enabled:true,runId:'r1',stepId:'s3',stepType:'verify_url',lessons:[lesson]});
  const counts={treatment:0,control:0};
  for(let i=0;i<100;i++)counts[assignLessonExperiment({enabled:true,runId:'r1',stepId:'step-'+i,stepType:'verify_url',lessons:[lesson]}).cohort]++;
  const balanced=counts.treatment>=35&&counts.treatment<=65&&counts.control>=35&&counts.control<=65;
  const ok=!disabled.enabled&&!writeBlocked.eligible&&first.cohort===same.cohort&&first.eligible&&balanced&&['treatment','control'].includes(first.cohort);
  return {name:'lesson_experiment_opt_in_allocation',ok,semantic:ok,detail:ok?'Experiment is off by default, stable per step, splits eligible read-only operation IDs across both cohorts, and excludes write operations.':'Experiment allocation violated opt-in, stability or operation-scope rules.',disabledOff:!disabled.enabled,writeOperationExcluded:!writeBlocked.eligible,stableAssignment:first.cohort===same.cohort,balancedAllocation:balanced,treatmentAllocation:counts.treatment,controlAllocation:counts.control};
}

function testLessonExperimentMeasurement() {
  const assignment={enabled:true,eligible:true,experimentId:'approved_lesson_stratified_v1',stepType:'verify_url'};
  const events=[];
  for(let i=0;i<5;i++){
    events.push(createExperimentObservationEvent({...assignment,cohort:'treatment'},i===2?'retryable_failure':'operationally_verified',i+1,i!==2,undefined,i===0?1:0));
    events.push(createExperimentObservationEvent({...assignment,cohort:'control'},i===1||i===3?'failed':'operationally_verified',i+1,i!==1&&i!==3));
  }
  const summary=summarizeLessonExperiment(events,5)[0];
  const small=summarizeLessonExperiment(events.slice(0,8),5)[0];
  const ok=summary?.treatment.attempts===5&&summary.control.attempts===5&&summary.treatment.verified===4&&summary.treatment.verifierRejections===1&&summary.control.verified===3&&summary.evidenceLevel==='descriptive_comparison'&&summary.differencePercentagePoints===20&&summary.causalEffectEstablished===false&&small?.evidenceLevel==='insufficient_evidence';
  return {name:'lesson_experiment_cohort_measurement',ok,semantic:ok,detail:ok?'Treatment and control remain separate; only verifier-passed completions count; both cohorts need the configured minimum; comparison is explicitly non-causal.':'Experiment cohort metrics were miscounted or overstated.',summary,smallSampleLevel:small?.evidenceLevel};
}

function testAdaptiveStrategyRecommendations() {
  const lessons=[
    {id:'promising',lesson:'Promising strategy',status:'approved',evidence:{stepType:'verify_url'}},
    {id:'weak',lesson:'Weak strategy',status:'approved',evidence:{stepType:'verify_url'}},
    {id:'mixed',lesson:'Mixed strategy',status:'approved',evidence:{stepType:'verify_url'}},
    {id:'small',lesson:'Small sample',status:'approved',evidence:{stepType:'verify_url'}}
  ];
  const events=[];
  for(let i=0;i<5;i++){
    events.push({lessonId:'promising',stepType:'verify_url',outcome:i===4?'retryable_failure':'operationally_verified',verifierPassed:i!==4});
    events.push({lessonId:'weak',stepType:'verify_url',outcome:i===0?'operationally_verified':'verifier_rejected',verifierPassed:i===0});
    events.push({lessonId:'mixed',stepType:'verify_url',outcome:i<3?'operationally_verified':'failed',verifierPassed:i<3});
  }
  events.push({lessonId:'small',stepType:'verify_url',outcome:'operationally_verified',verifierPassed:true});
  const recs=recommendLessonStrategies(lessons,events,5);
  const byId=Object.fromEntries(recs.map(x=>[x.lessonId,x]));
  const selected=applyApprovedStrategyPolicy(lessons,{enabled:true,stepType:'verify_url',lessonId:'promising'});
  const crossType=applyApprovedStrategyPolicy(lessons,{enabled:true,stepType:'research_search',lessonId:'promising'});
  const unchanged=applyApprovedStrategyPolicy(lessons,{enabled:false,stepType:'verify_url',lessonId:'promising'});
  const policySafe=selected.length===1&&selected[0].id==='promising'&&crossType.length===0&&unchanged.length===lessons.length;
  const ok=byId.promising?.recommendation==='retain_for_human_review'&&byId.weak?.recommendation==='investigate_before_reuse'&&byId.mixed?.recommendation==='mixed_results_review'&&byId.small?.recommendation==='collect_more_evidence'&&recs.every(x=>x.automaticSelection===false&&x.automaticPromotion===false)&&byId.weak.verifierRejections===4&&policySafe;
  return {name:'adaptive_strategy_recommendations',ok,semantic:ok,detail:ok?'Evidence thresholds distinguish promising, weak, mixed and insufficient strategies; verifier rejections count against a lesson; only an explicitly approved, same-step-type strategy is selected; disabled or cross-type policies cannot alter execution.':'Strategy recommendation thresholds or human-approval boundaries regressed.',policySafe,recommendations:recs.map(x=>({lessonId:x.lessonId,recommendation:x.recommendation,observations:x.observations,verified:x.verified,verifierRejections:x.verifierRejections}))};
}

function testStrategyTrialTracking() {
  const baseline=Array.from({length:6},(_,i)=>({outcome:i<5?'operationally_verified':'failed',verifierPassed:i<5}));
  const trials=Array.from({length:5},(_,i)=>({outcome:i===0?'operationally_verified':i===1?'retryable_failure':i===2?'verifier_rejected':'failed',verifier_passed:i===0}));
  const measured=summarizeStrategyTrialOutcomes(trials,baseline,5);
  const small=summarizeStrategyTrialOutcomes(trials.slice(0,4),baseline,5);
  const ok=measured.observations===5&&measured.verified===1&&measured.retries===1&&measured.verifierRejections===1&&measured.failures===2&&measured.baselineObservations===6&&measured.baselineOperationalSuccessRate===0.833&&measured.operationalSuccessRate===0.2&&measured.regressionFlag===true&&measured.differencePercentagePoints===-63.3&&measured.automaticDeactivation===false&&measured.causalEffectEstablished===false&&small.regressionFlag===false&&small.reviewStatus==='collecting_evidence';
  return {name:'strategy_trial_tracking_and_regression_guard',ok,semantic:ok,detail:ok?'Trial outcomes count verifier passes, retries, failures and rejections; baseline comparison is descriptive; regression is flagged only after five observations and never disables a policy.':'Strategy trial thresholds, descriptive comparison or human-control guard regressed.',measured,smallSampleStatus:small.reviewStatus};
}

function testCancellationGuards() {
  const active=isMissionActive('running');
  const queued=isMissionActive('queued');
  const cancelled=isMissionActive('cancelled');
  const completed=isMissionActive('completed');
  const ok=active&&!queued&&!cancelled&&!completed;
  return {name:'cancellation_guards',ok,semantic:ok,detail:ok?'Only running missions may proceed; queued, cancelled and completed missions are blocked.':'Mission status guard allowed a non-running mission to continue.',runningAllowed:active,queuedBlocked:!queued,cancelledBlocked:!cancelled,completedBlocked:!completed};
}

function testMissionGraphPolicy() {
  const graph=[{position:1,depends_on:[]},{position:2,depends_on:[]},{position:3,depends_on:[1,2]}];
  const valid=graph.every((node,i)=>node.position===i+1&&new Set(node.depends_on).size===node.depends_on.length&&node.depends_on.every(dep=>Number.isInteger(dep)&&dep>0&&dep<node.position));
  const independent=graph.filter(node=>node.depends_on.length===0).length;
  const blocked=!dependenciesSatisfied(graph[2].depends_on,[{position:1,status:'completed'},{position:2,status:'pending'}]);
  const ready=dependenciesSatisfied(graph[2].depends_on,[{position:1,status:'completed'},{position:2,status:'completed'}]);
  const coordinator=specialistCapabilitiesForRole('coordinator');
  const ok=valid&&independent===2&&blocked&&ready&&coordinator.includes('mission_decomposition')&&coordinator.includes('dependency_management');
  return {name:'mission_graph_and_coordinator_policy',ok,semantic:ok,detail:ok?'Acyclic earlier-step dependencies, independent branch readiness and coordinator capability boundaries passed.':'Mission graph validation or coordinator capability policy regressed.',nodeCount:graph.length,independentBranches:independent};
}

function testSpecialistRevisionPolicy() {
  const step={step_type:'research_search',input:{query:'battery recycling market trends'}};
  const rejected={checks:[{name:'search_leads_have_titles_and_https_urls',ok:false,evidence:'0 valid HTTPS leads of 0 returned'}]};
  const revision=buildRevisionRequest(step,{results:[]},rejected,1);
  const capped=buildRevisionRequest({...step,input:{query:'x'.repeat(300)}},{results:[]},rejected,1);
  const exhausted=buildRevisionRequest(step,{results:[]},rejected,2);
  const unsupported=buildRevisionRequest({...step,step_type:'create_task'},{results:[]},rejected,1);
  const ok=!!revision&&revision.input.query.length<=300&&revision.input.query!==step.input.query&&revision.mode==='bounded_deterministic_query_revision'&&!capped&&!exhausted&&!unsupported;
  return {name:'specialist_revision_budget_and_scope',ok,semantic:ok,detail:ok?'Rejected research receives one bounded, auditable query revision; unsupported write operations and exhausted budgets are not revised.':'Specialist revision policy exceeded its scope or budget.',revisionAvailable:!!revision,queryLength:revision?.input.query.length||0,secondRevisionBlocked:!exhausted,writeOperationBlocked:!unsupported};
}

function testRecoveryControllerDecisions() {
  const completed=decideRecoveryAction({step:{status:'completed'}});
  const active=decideRecoveryAction({step:{status:'running'},activeLease:true});
  const blocked=decideRecoveryAction({step:{status:'pending'},dependenciesReady:false});
  const resume=decideRecoveryAction({step:{status:'running'}});
  const retry=decideRecoveryAction({step:{status:'running',error:'HTTP 503'},attempts:1});
  const replan=decideRecoveryAction({step:{status:'running',error:'HTTP 404'},attempts:1});
  const exhausted=decideRecoveryAction({step:{status:'running',error:'timeout'},attempts:3});
  const external=decideRecoveryAction({step:{status:'pending',step_type:'publish_content'}});
  const keys=new Set([recoveryEventKey('r','s','resume',1),recoveryEventKey('r','s','resume',1)]);
  const ok=completed.action==='preserve'&&active.action==='wait'&&blocked.action==='wait'&&resume.action==='resume'&&retry.action==='retry'&&replan.action==='replan'&&exhausted.action==='human_approval'&&external.action==='human_approval'&&keys.size===1;
  return {name:'recovery_controller_decision_matrix',ok,semantic:ok,detail:ok?'Recovery controller preserves completed work, waits on active leases/dependencies, resumes safe work, retries bounded transient failures, replans permanent failures and requires approval for external effects or exhausted retries.':'Recovery controller selected an unsafe or incorrect action.',actions:{completed:completed.action,activeLease:active.action,blockedDependencies:blocked.action,resume:resume.action,transientFailure:retry.action,permanentFailure:replan.action,retryBudgetExhausted:exhausted.action,externalSideEffect:external.action},eventKeyDeduplicated:keys.size===1};
}

function testSpecialistLeaseBoundaryRecovery() {
  const now=Date.now();
  const recent=new Date(now-8*60*1000).toISOString();
  const stale=new Date(now-11*60*1000).toISOString();
  const expiredLease=shouldRecoverRunningStep({status:'running',started_at:recent,has_pending_execution_task:true},now);
  const activeLease=shouldRecoverRunningStep({status:'running',started_at:recent,has_pending_execution_task:false,has_active_execution_task:true},now);
  const pendingVerifier=shouldRecoverRunningStep({status:'running',started_at:recent,has_pending_execution_task:false,has_active_execution_task:true,has_pending_specialist_task:true},now);
  const staleStep=shouldRecoverRunningStep({status:'running',started_at:stale,has_pending_execution_task:false,has_active_execution_task:false},now);
  const completed=shouldRecoverRunningStep({status:'completed',started_at:stale,has_pending_execution_task:true},now);
  const ok=expiredLease&&!activeLease&&!pendingVerifier&&staleStep&&!completed;
  return {name:'specialist_lease_boundary_recovery',ok,semantic:ok,detail:ok?'Only an expired or stale execution is requeued; a live execution lease protects its step even when verification is pending; completed steps never reopen.':'Lease-boundary recovery policy regressed.',expiredExecutionRecoversStep:expiredLease,activeExecutionPreservesStep:!activeLease,pendingVerifierDoesNotStealActiveStep:!pendingVerifier,staleStepRecovers:staleStep,completedStepPreserved:!completed};
}

async function testParallelExecution() {
  let active=0,maxActive=0;
  const results=await runParallel([1,2,3,4,5],async value=>{active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return value*2;},MAX_SPECIALIST_CONCURRENCY);
  const ok=results.join(',')==='2,4,6,8,10'&&maxActive>1&&maxActive<=MAX_SPECIALIST_CONCURRENCY;
  return {name:'parallel_specialist_worker_pool',ok,semantic:ok,detail:ok?'Independent worker tasks overlapped within the configured concurrency ceiling.':'Worker pool failed its ordering or concurrency-bound assertion.',maxActive,limit:MAX_SPECIALIST_CONCURRENCY,completed:results.length};
}

async function testIndependentVerifier() {
  const bad=await verifyStepResult({step_type:'research_search'},{results:[]},null,'test-owner','test-run');
  const good=await verifyStepResult({step_type:'research_search'},{results:[{title:'Official documentation',url:'https://example.org/docs'}]},null,'test-owner','test-run');
  const ok=bad.passed===false&&good.passed===true&&good.role==='verifier'&&good.factualAccuracyVerified===false;
  return {name:'independent_verifier_seeded_defect',ok,semantic:ok,detail:ok?'Verifier rejected empty evidence and accepted a structurally valid lead without claiming factual truth.':'Verifier failed to challenge the seeded empty-result defect.',badRejected:!bad.passed,goodAccepted:good.passed};
}

async function testClaimVerifierSourceIndependence() {
  const passage='The council approved the project after review.';
  const urls=['https://alpha.example/a','https://beta.example/b'];
  const context=buildDocumentContext('The council approved the project.',passage,0,passage.length);
  const reviewFor=count=>({review_status:'pending',assessment_status:'evidence_candidates_found',assessment:{sourceCount:2,independentPublisherCount:count,deepAnalysis:{independence:{independentGroupCount:count},perSource:urls.map((url,index)=>({index,url,claimText:'The council approved the project.',passageId:String(index)+':0:'+passage.length,startOffset:0,endOffset:passage.length,exactQuote:passage,offsetBasis:'captured_source_excerpt_utf16',contextId:String(index)+':ctx:'+context.contextStartOffset+':'+context.contextEndOffset,contextExcerpt:context.contextText,contextStartOffset:context.contextStartOffset,contextEndOffset:context.contextEndOffset,contextOffsetBasis:'captured_source_excerpt_utf16',contextParagraphIndexes:context.contextParagraphIndexes,contextSegments:context.contextSegments,contextVersion:context.contextVersion}))}}});
  const makeDb=count=>({query:async sql=>String(sql).includes('SELECT result FROM ultron_agent_steps')?({rows:urls.map(url=>({result:{url,retrieved:true,excerpt:passage}}))}):({rows:[reviewFor(count)]})});
  const step={id:'fixture-claim-step',step_type:'assess_claim',input:{claim:'The council approved the project.'}};
  const duplicateOrigins=await verifyStepResult(step,{verified:false},makeDb(1),'test-owner','test-run');
  const independentOrigins=await verifyStepResult(step,{verified:false},makeDb(2),'test-owner','test-run');
  const failed=duplicateOrigins.checks.find(x=>x.name==='claim_independent_origins_present');
  const passed=independentOrigins.checks.find(x=>x.name==='claim_independent_origins_present');
  const ok=!duplicateOrigins.passed&&failed?.ok===false&&independentOrigins.passed&&passed?.ok===true;
  return {name:'claim_verifier_independent_citation_sufficiency',ok,semantic:ok,detail:ok?'Two URLs from one origin are rejected as insufficient; two independent origin groups pass the structural sufficiency gate.':'Verifier confused citation count with independent-origin count.',duplicateOriginRejected:!duplicateOrigins.passed,independentOriginAccepted:independentOrigins.passed};
}

function testGeneralOutcomeVerification() {
  const checks=[{text:'Each research subtask returned a lead.',check:{type:'search_results',min:2,perStep:true}},{text:'The owner must review the conclusion.',check:{type:'human_review'}}];
  const good=[{step_type:'research_search',status:'completed',result:{results:[{title:'A',url:'https://a.example'}]}},{step_type:'research_search',status:'completed',result:{results:[{title:'B',url:'https://b.example'}]}}];
  const bad=[good[0],{step_type:'research_search',status:'completed',result:{results:[]}}];
  const passed=verifyOutcome(checks,good),rejected=verifyOutcome(checks,bad);
  const ok=passed.status==='criteria_met_pending_review'&&passed.counts.met===1&&passed.counts.needs_review===1&&rejected.status==='criteria_unmet'&&rejected.counts.unmet===1;
  return {name:'general_outcome_verification',ok,semantic:ok,detail:ok?'Outcome verifier distinguishes met, unmet and human-review-only criteria.':'Outcome verifier failed seeded acceptance criteria.',passedStatus:passed.status,rejectedStatus:rejected.status};
}

function testLabeledClaimEvidenceFixtures() {
  const fixtures=[
    {name:'polarity_conflict',claim:'The city approved the proposal in 2025.',sentence:'The city rejected the proposal in 2025.',expect:a=>a.valenceConflict===true},
    {name:'negation_conflict',claim:'The council did not approve the proposal.',sentence:'The council approved the proposal after review.',expect:a=>a.polarityMismatch===true},
    {name:'numeric_conflict',claim:'The project cost 120 million dollars in 2024.',sentence:'The project cost 150 million dollars in 2024.',expect:a=>a.numberConflict===true&&stanceOf(a)==='contradicts_candidate'},
    {name:'numeric_match',claim:'The project cost 120 million dollars in 2024.',sentence:'The project cost 120 million dollars in 2024.',expect:a=>a.numberMatch===true},
    {name:'direction_conflict',claim:'Revenue increased during 2025.',sentence:'Revenue declined during 2025.',expect:a=>a.directionConflict===true},
    {name:'hedged_claim',claim:'The treatment is effective for the condition.',sentence:'The treatment may be effective for the condition.',expect:a=>a.hedged===true},
    {name:'unrelated_passage',claim:'The council approved a transport project.',sentence:'Marine biology research advanced in deep ocean ecosystems.',expect:a=>stanceOf(a)==='not_addressed'},
    {name:'entity_mismatch',claim:'London approved the proposal in 2025.',sentence:'Paris approved the proposal in 2025.',expect:a=>a.entityCoverage<1&&stanceOf(a)==='not_addressed'},
    {name:'required_date_missing',claim:'The city approved the proposal in 2025.',sentence:'The city approved the proposal after review.',expect:a=>a.dateMatch===false&&a.numberMatch===false&&stanceOf(a)==='related_unclear'},
    {name:'attributed_statement',claim:'The regulator approved the medicine.',sentence:'According to the company, the regulator approved the medicine.',expect:a=>a.materialAtomChecks?.scope?.attributed===true&&stanceOf(a)==='related_unclear'},
    {name:'conditional_statement',claim:'The bridge is safe for public use.',sentence:'If the final inspection passes, the bridge would be safe for public use.',expect:a=>a.materialAtomChecks?.scope?.conditional===true&&stanceOf(a)==='related_unclear'},
    {name:'quoted_statement',claim:'The project is complete.',sentence:'The spokesperson said, “The project is complete.”',expect:a=>a.materialAtomChecks?.scope?.quoted===true&&stanceOf(a)==='related_unclear'},
    {name:'missing_causal_link',claim:'The policy reduced unemployment because of new training.',sentence:'The policy reduced unemployment after new training was introduced.',expect:a=>a.materialAtomChecks?.scope?.causalRelationMissing===true&&stanceOf(a)==='related_unclear'},
    {name:'explicit_causal_passage',claim:'The training reduced unemployment because of improved skills.',sentence:'The training reduced unemployment because workers gained improved skills.',expect:a=>a.materialAtomChecks?.scope?.claimCausal===true&&a.materialAtomChecks?.scope?.passageCausal===true}
  ];
  const evaluated=fixtures.map(f=>{const a=analyzeSentence(f.claim,f.sentence);return {name:f.name,ok:!!f.expect(a),signals:{coverage:a.coverage,entityCoverage:a.entityCoverage,polarityMismatch:a.polarityMismatch,valenceConflict:a.valenceConflict,directionConflict:a.directionConflict,numberConflict:a.numberConflict,numberMatch:a.numberMatch,hedged:a.hedged,stance:stanceOf(a)}};});
  const independent=sourceIndependence([{url:'https://alpha.example/a',publisher:'Alpha',excerpt:'The regional transit authority published a detailed annual budget and service report for public review.'},{url:'https://beta.example/b',publisher:'Beta',excerpt:'Researchers at a separate university released findings about regional transport usage and commuting patterns.'}]);
  const independentOk=independent.independentGroupCount===2;
  const ok=evaluated.every(x=>x.ok)&&independentOk;
  return {name:'labeled_claim_evidence_evaluation',ok,semantic:ok,fixtureCount:evaluated.length,passedFixtures:evaluated.filter(x=>x.ok).length,independentOrigins:independent.independentGroupCount,detail:ok?evaluated.length+' labeled claim fixtures and a distinct-origin positive control passed. These remain heuristic screening tests, not semantic entailment.':'One or more labeled claim signals or independent-origin positive controls failed.',fixtures:evaluated};
}

function testContextAwareClaimScope() {
  const claim='The regulator approved the medicine.';
  const sources=[
    {url:'https://alpha.example/report',host:'alpha.example',title:'Report',publisher:'Alpha',excerpt:'The company spokesperson said this.\nThe regulator approved the medicine.'},
    {url:'https://beta.example/report',host:'beta.example',title:'Report',publisher:'Beta',excerpt:'The government minister stated.\nThe project is complete.'}
  ];
  const attributed=analyzeClaimEvidence(claim,[sources[0]]).perSource[0];
  const unrelated=analyzeClaimEvidence('The project is complete.',[sources[1]]).perSource[0];
  const ok=attributed.stance==='related_unclear'&&attributed.materialAtomChecks.scope.attributed===true&&attributed.materialAtomChecks.scope.contextIncludedPreviousSentence===true&&attributed.contextExcerpt.includes('The company spokesperson said this.')&&unrelated.materialAtomChecks.scope.attributed===true&&unrelated.stance==='related_unclear';
  return {name:'context_aware_attribution_scope',ok,semantic:ok,attributionCarriedAcrossSentence:attributed.materialAtomChecks.scope.attributed,previousSentenceIncluded:attributed.materialAtomChecks.scope.contextIncludedPreviousSentence,exactQuotePreserved:attributed.exactQuote==='The regulator approved the medicine.',detail:ok?'The preceding speaker sentence is included in scope review while the selected evidence quote remains independently anchored.':'Neighboring attribution context was missed or the exact selected quote was not preserved.'};
}

function testDocumentLevelClaimContext() {
  const claim='The committee approved the measure.';
  const multiParagraph='BACKGROUND\nThe agency spokesperson said the committee had reviewed the proposal.\n\nDECISION\nThe committee approved the measure.';
  const context=buildDocumentContext(claim,multiParagraph,multiParagraph.lastIndexOf('The committee approved'),multiParagraph.length);
  const attribution=analyzeClaimEvidence(claim,[{url:'https://alpha.example/decision',host:'alpha.example',excerpt:multiParagraph}]).perSource[0];
  const pronounSource='The council and the review panel considered several options.\n\nIt approved the measure.';
  const pronoun=analyzeClaimEvidence('The committee approved the measure.',[{url:'https://beta.example/decision',host:'beta.example',excerpt:pronounSource}]).perSource[0];
  const defined='DEFINITIONS\n\nCovered Entity means a registered organization that receives public funding.\n\nA Covered Entity must file an annual report.';
  const distantDefinition='DEFINITIONS\n\nCovered Entity means a registered organization that receives public funding.\n\nSCOPE\n\nThis section describes filing duties.\n\nPROCESS\n\nA Covered Entity must file an annual report.';
  const definition=buildDocumentContext('A Covered Entity must file an annual report.',distantDefinition,distantDefinition.lastIndexOf('A Covered Entity'),distantDefinition.length);
  const quoted=buildDocumentContext('The project was completed.', 'The report quotes the director: “He said, ‘The project was completed.’”', 37, 67);
  const longContext=['The council approved the proposal.','BACKGROUND',...Array.from({length:30},(_,i)=>'This paragraph records procedural detail number '+i+'.'),'It completed the review.'].join('\n\n');
  const distantPronoun=buildDocumentContext('It completed the review.',longContext,longContext.lastIndexOf('It completed'),longContext.length);
  const acronymDoc='DEFINITIONS\n\nInternational Monetary Fund (IMF) refers to the global financial institution.\n\nThe IMF issued its annual outlook.';
  const acronymContext=buildDocumentContext('The IMF issued its annual outlook.',acronymDoc,acronymDoc.lastIndexOf('The IMF'),acronymDoc.length);
  const tampered=attribution.contextExcerpt+' altered';
  const source={url:'https://alpha.example/decision',retrieved:true,excerpt:multiParagraph};
  const secondSource={url:'https://other.example/decision',host:'other.example',retrieved:true,excerpt:multiParagraph};
  const twoSourceAssessment=analyzeClaimEvidence(claim,[{url:source.url,host:'alpha.example',excerpt:multiParagraph},secondSource]);
  const anchorReview=verifyClaimPassageAnchors(twoSourceAssessment.perSource,[source,secondSource],2);
  const ok=context.contextParagraphCount>=2&&context.contextText.includes('BACKGROUND')&&attribution.materialAtomChecks.scope.attributionAcrossParagraphs===true&&pronoun.materialAtomChecks.scope.pronounAntecedentAmbiguous===true&&pronoun.stance==='related_unclear'&&definition.scope.definitionContextIncluded===true&&definition.contextSegments.some(s=>s.reason==='defined_term:Covered Entity'&&s.text.includes('Covered Entity means'))&&quoted.scope.quotedMaterial===true&&quoted.scope.nestedQuotationDetected===true&&distantPronoun.contextSegments.some(s=>s.reason==='possible_antecedent')&&acronymContext.contextSegments.some(s=>s.text.includes('International Monetary Fund (IMF)'))&&anchorReview.passed&&tampered!==attribution.contextExcerpt;
  return {name:'document_level_context_pronouns_quotes_and_definitions',ok,semantic:ok,paragraphContextIncluded:context.contextParagraphCount,attributionAcrossParagraphs:attribution.materialAtomChecks.scope.attributionAcrossParagraphs,pronounAmbiguityFlagged:pronoun.materialAtomChecks.scope.pronounAntecedentAmbiguous,pronounReferences:pronoun.materialAtomChecks.scope.pronounReferences,antecedentCandidates:pronoun.materialAtomChecks.scope.antecedentCandidates,definitionParagraphIncluded:definition.scope.definitionContextIncluded,quotedMaterialFlagged:quoted.scope.quotedMaterial,nestedQuotationFlagged:quoted.scope.nestedQuotationDetected,distantAntecedentIncluded:distantPronoun.contextSegments.some(s=>s.reason==='possible_antecedent'),acronymDefinitionIncluded:acronymContext.contextSegments.some(s=>s.text.includes('International Monetary Fund (IMF)')),acronymScope:acronymContext.scope,acronymSegments:acronymContext.contextSegments.map(s=>({reason:s.reason,text:s.text})),contextAnchorReadback:anchorReview.passed,detail:ok?'Paragraph and heading context, cross-paragraph attribution, ambiguous pronouns, quoted material and earlier definitions are surfaced while exact source anchors remain independently checked.':'A document-context fixture or independent context-anchor check failed.'};
}

function testExactClaimPassageAnchors() {
  const claim='The city approved the transit plan in 2025.';
  const sources=[
    {url:'https://alpha.example/report',host:'alpha.example',title:'City report',publisher:'Alpha',excerpt:'The city approved the transit plan in 2025 after public consultation. The council published the final decision.'},
    {url:'https://beta.example/record',host:'beta.example',title:'Council record',publisher:'Beta',excerpt:'The city approved the transit plan in 2025 following a public hearing. The record includes the signed resolution.'}
  ];
  const assessment=analyzeClaimEvidence(claim,sources);
  const captured=sources.map(s=>({...s,retrieved:true}));
  const valid=verifyClaimPassageAnchors(assessment.perSource,captured,2);
  const tampered=assessment.perSource.map((p,i)=>i===0?{...p,exactQuote:p.exactQuote+' forged'}:p);
  const invalid=verifyClaimPassageAnchors(tampered,captured,2);
  const offsetTampered=assessment.perSource.map((p,i)=>i===0?{...p,startOffset:p.startOffset+1}:p);
  const invalidOffset=verifyClaimPassageAnchors(offsetTampered,captured,2);
  const contextTampered=assessment.perSource.map((p,i)=>i===0?{...p,contextExcerpt:p.contextExcerpt+' forged'}:p);
  const invalidContext=verifyClaimPassageAnchors(contextTampered,captured,2);
  const segmentTampered=assessment.perSource.map((p,i)=>i===0?{...p,contextSegments:(p.contextSegments||[]).map((s,j)=>j===0?{...s,text:s.text+' forged'}:s)}:p);
  const invalidSegment=verifyClaimPassageAnchors(segmentTampered,captured,2);
  const ok=valid.passed&&valid.anchoredCount===2&&!invalid.passed&&!invalidOffset.passed&&!invalidContext.passed&&!invalidSegment.passed&&assessment.perSource.every(p=>p.passageId&&p.offsetBasis==='captured_source_excerpt_utf16'&&p.contextId&&p.contextOffsetBasis==='captured_source_excerpt_utf16');
  return {name:'exact_claim_passage_anchors_and_tamper_detection',ok,semantic:ok,anchored:valid.anchoredCount,quoteTamperingRejected:!invalid.passed,offsetTamperingRejected:!invalidOffset.passed,contextTamperingRejected:!invalidContext.passed,segmentTamperingRejected:!invalidSegment.passed,detail:ok?'Exact quote and neighboring context have stable IDs and offsets; quote, offset and context tampering are rejected.':'Exact passage/context anchoring or tamper detection failed.'};
}

function testAutonomousEvidenceRepairPlanning() {
  const steps=[{position:1,step_type:'retrieve_source',result:{retrieved:true,url:'https://alpha.example/report',truncated:true}},{position:2,step_type:'assess_claim',result:{claim:'The project was approved in 2025.',allSources:[{url:'https://alpha.example/report'}]}}];
  const intelligence={evidence:{claims:[{position:2,claim:'The project was approved in 2025.',independentPublisherGroups:1,supportingCandidates:1,contradictingCandidates:1,conflictCount:1,conflicts:[{signal:'Opposite approval status'}]}],groups:[{group:'alpha',urls:['https://alpha.example/report']}]},specialistReview:{failedChecks:[{challenge:['Need independent source']}]}}
  const proposal=buildEvidenceRepairProposal({id:'fixture-run',title:'Fixture mission'},steps,intelligence);
  const verified=verifyEvidenceRepairProposal(proposal);
  const kinds=new Set(proposal.tasks.map(x=>x.input.repairType));
  const bounded=proposal.tasks.every(x=>x.type==='research_search'&&x.input.query.length<=300);
  const noAuto=proposal.requiresOwnerApproval===true&&proposal.automaticExecution===false;
  const claimLinkedRefresh=proposal.tasks.filter(x=>['freshness_refresh','truncated_source_recovery'].includes(x.input.repairType)).every(x=>x.input.claimPosition===2&&x.input.claim==='The project was approved in 2025.');
  const ok=verified.passed&&proposal.tasks.length>=3&&kinds.has('independent_source_gap')&&kinds.has('conflict_investigation')&&kinds.has('freshness_refresh')&&kinds.has('truncated_source_recovery')&&kinds.has('verifier_challenge_resolution')&&bounded&&noAuto&&claimLinkedRefresh;
  return {name:'autonomous_evidence_repair_proposal_safety',ok,semantic:ok,taskCount:proposal.tasks.length,repairTypes:[...kinds],ownerApprovalRequired:noAuto,claimLinkedRefresh,detail:ok?'Weak claims, conflicts, undated/truncated sources and verifier challenges create bounded, claim-linked repair searches; no execution occurs before owner approval.':'Evidence repair planning exceeded its bounded or approval-gated policy.'};
}

function testRepairedClaimCaptureAndAssessmentPlan() {
 const urls=['https://alpha.example/evidence','https://beta.example/primary'];
 const valid=buildRepairedClaimAssessmentPlan({sourceRunId:'original',repairRunId:'repair',claimPosition:3,claim:'The proposal was approved in 2025.',selectedUrls:urls,candidateUrls:urls});
 const duplicateHost=buildRepairedClaimAssessmentPlan({sourceRunId:'original',repairRunId:'repair',claimPosition:3,claim:'The proposal was approved in 2025.',selectedUrls:['https://www.alpha.example/a','https://alpha.example/b'],candidateUrls:['https://www.alpha.example/a','https://alpha.example/b']});
 const invented=buildRepairedClaimAssessmentPlan({sourceRunId:'original',repairRunId:'repair',claimPosition:3,claim:'The proposal was approved in 2025.',selectedUrls:['https://alpha.example/evidence','https://evil.example/not-in-search'],candidateUrls:urls});
 const privateUrl=buildRepairedClaimAssessmentPlan({sourceRunId:'original',repairRunId:'repair',claimPosition:3,claim:'The proposal was approved in 2025.',selectedUrls:['https://10.0.0.1/private','https://beta.example/primary'],candidateUrls:['https://10.0.0.1/private','https://beta.example/primary']});
 const steps=valid.steps,assessment=steps[steps.length-1];
 const ok=valid.valid&&steps.length===3&&steps[0].type==='retrieve_source'&&steps[1].type==='retrieve_source'&&assessment.type==='assess_claim'&&assessment.input.source_urls.length===2&&assessment.depends_on.join(',')==='1,2'&&!valid.factualTruthVerified&&!duplicateHost.valid&&!invented.valid&&!privateUrl.valid;
 return {name:'repaired_claim_capture_and_assessment_plan',ok,semantic:ok,sourceCount:valid.sourceCount,dependencyGate:assessment.depends_on,duplicateHostRejected:!duplicateHost.valid,unselectedUrlRejected:!invented.valid,privateNetworkUrlRejected:!privateUrl.valid,detail:ok?'Only selected completed-search URLs can be captured; private network URLs are rejected; the new claim assessment waits for every capture and remains non-truth-certifying.':'Repaired claim capture/assessment plan violated source-selection or dependency safeguards.'};
}

function testExplicitArithmeticEvaluation() {
  const fixtures=[
    {name:'correct_sum',input:'50 + 60 = 110',status:'evaluated',matches:true},
    {name:'incorrect_sum',input:'50 + 60 = 120',status:'evaluated',matches:false},
    {name:'multiplication',input:'12 * 8 = 96',status:'evaluated',matches:true},
    {name:'percentage',input:'80 * 20% = 16',status:'evaluated',matches:true},
    {name:'decimal_rounding',input:'1 / 3 = 0.333333333',status:'evaluated',matches:true},
    {name:'division_by_zero',input:'10 / 0 = 0',status:'not_evaluated'},
    {name:'ambiguous_prose',input:'The total was 50 plus 60, approximately 110.',status:'not_evaluated'},
    {name:'different_units',input:'5 km + 300 m = 5.3',status:'not_evaluated'}
  ];
  const results=fixtures.map(f=>{const actual=evaluateExplicitCalculation(f.input);return {name:f.name,ok:actual.status===f.status&&(f.matches===undefined||actual.matches===f.matches),actual};});
  const ok=results.every(x=>x.ok);
  return {name:'explicit_arithmetic_verification',ok,semantic:ok,fixtureCount:fixtures.length,passedFixtures:results.filter(x=>x.ok).length,detail:ok?'Standalone arithmetic equalities are evaluated; incorrect results are flagged; ambiguous prose, units and division by zero are left unevaluated.':'An arithmetic fixture did not meet its expected conservative outcome.',fixtures:results};
}

function testClaimContradictionAndSourceIndependence() {
  const contradiction=analyzeSentence('The city approved the proposal in 2025.','The city rejected the proposal in 2025.');
  const sameOrigin=sourceIndependence([{url:'https://news.example.com/a',excerpt:'A sufficiently distinct report about the city budget and public services.'},{url:'https://news.example.com/b',excerpt:'A second sufficiently different article about regional public transportation.'}]);
  const copied=sourceIndependence([{url:'https://one.example/a',excerpt:'The council approved a major public infrastructure project after extensive public consultation.'},{url:'https://two.example/b',excerpt:'The council approved a major public infrastructure project after extensive public consultation.'}]);
  const ok=contradiction.valenceConflict===true&&sameOrigin.independentGroupCount===1&&copied.independentGroupCount===1;
  return {name:'claim_contradiction_and_source_independence',ok,semantic:ok,detail:ok?'Seeded polarity conflict and shared-origin/copied-text signals were detected.':'Claim conflict or source grouping failed.',polarityConflict:contradiction.valenceConflict,sameDomainGroups:sameOrigin.independentGroupCount,copiedTextGroups:copied.independentGroupCount};
}

async function testSourceFreshnessFallback() {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, method: options.method, range: options.headers?.Range || '' });
    if (options.method === 'HEAD') return { status: 405, headers: { get: () => null } };
    return { status: 206, headers: { get: () => null } };
  };
  const result = await checkSourceFreshness('https://docs.example.org/guide', fakeFetch);
  const fallbackUsed = calls.length === 2 && calls[0].method === 'HEAD' &&
    calls[1].method === 'GET' && calls[1].range === 'bytes=0-0';
  const blockedRedirect = await checkSourceFreshness('https://docs.example.org/guide', async () => ({
    status: 302, headers: { get: key => key.toLowerCase() === 'location' ? 'http://127.0.0.1/private' : null }
  }));
  const redirectBlocked = blockedRedirect.status === 'redirected' && blockedRedirect.httpStatus === 302;
  return {
    name: 'source_freshness_fallback',
    ok: fallbackUsed && result.status === 'available' && result.httpStatus === 206 && redirectBlocked,
    semantic: fallbackUsed && result.status === 'available' && redirectBlocked,
    detail: 'HEAD 405 falls back to one-byte ranged GET (206); unsafe redirect target is rejected.',
    calls
  };
}

export default async function (req, res) {
  const results = [];
  for (const [name, url] of Object.entries(CHECKS)) results.push(await probe(name, url));
  results.push(testMissionPlanningRegression());
  results.push({name:'balanced_mission_planner_evaluation',...evaluateMissionPlanner(),semantic:true});
  results.push(testMissionCoordinationReview());
  results.push(testMissionIntelligenceAdjudication());
  results.push(testAutonomousEvidenceRepairPlanning());
  results.push(testRepairedClaimCaptureAndAssessmentPlan());
  results.push(testAdaptiveMissionReplanning());
  results.push(testRecoveryIntelligence());
  results.push(testMissionRuntimePolicies());
  results.push(testSpecialistLeaseBoundaryRecovery());
  results.push(testRecoveryControllerDecisions());
  results.push(testAdaptiveLearningMeasurement());
  results.push(testLessonExperimentAllocation());
  results.push(testLessonExperimentMeasurement());
  results.push(testAdaptiveStrategyRecommendations());
  results.push(testStrategyTrialTracking());
  results.push(testCrashWindowReplayContracts());
  results.push(testCancellationGuards());
  results.push(testMissionGraphPolicy());
  results.push(testSpecialistRevisionPolicy());
  results.push(await testParallelExecution());
  results.push(await testIndependentVerifier());
  results.push(await testClaimVerifierSourceIndependence());
  results.push(testGeneralOutcomeVerification());
  results.push({name:'sentinel_authorized_observation_safety',...sentinelSafetySelfTest(),semantic:true});
  results.push({name:'sentinel_structured_assessment_packet',...sentinelAssessmentSelfTest(),semantic:true});
  results.push({name:'authorised_sensor_aviation_export_assessment',...sensorAssessmentSelfTest(),semantic:true});
  results.push(testLabeledClaimEvidenceFixtures());
  results.push(testContextAwareClaimScope());
  results.push(testDocumentLevelClaimContext());
  results.push(testExactClaimPassageAnchors());
  results.push(testExplicitArithmeticEvaluation());
  results.push(testClaimContradictionAndSourceIndependence());
  results.push(await testPublicSearch());
  results.push(await testSourceFreshnessFallback());
  const externalNames = new Set(['weather','wikipedia','currency','news','search']);
  const deterministicFailed = results.filter(r => !r.ok && !externalNames.has(r.name));
  const externalFailures = results.filter(r => !r.ok && externalNames.has(r.name));
  const status = deterministicFailed.length ? 'failed' : externalFailures.length ? 'degraded_external_sources' : 'healthy';
  console.log('ULTRON self-test summary', JSON.stringify({status,total:results.length,deterministicPassed:results.length-deterministicFailed.length-externalFailures.length,deterministicFailures:deterministicFailed.map(x=>x.name),externalFailures:externalFailures.map(x=>({name:x.name,status:x.status||0}))}));
  if (deterministicFailed.length) return res.status(500).json({ ok: false, status, failed: deterministicFailed, externalFailures, results });
  return res.json({ ok: true, status, externalFailures, results });
}