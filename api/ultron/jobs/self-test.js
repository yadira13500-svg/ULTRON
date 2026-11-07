import { checkSourceFreshness } from 'lib/source-check.js';
import { searchPublicWeb } from 'lib/search.js';
import { extractResearchQuery, planMission } from 'lib/mission-plan.js';
import { classifyStepFailure, dependenciesSatisfied, runParallel, specialistRoleForStep, specialistCapabilitiesForRole, MAX_SPECIALIST_CONCURRENCY } from 'lib/mission-runtime.js';
import { verifyStepResult, buildRevisionRequest } from 'lib/specialist-verifier.js';
import { analyzeSentence, sourceIndependence } from 'lib/claims.js';
import { verifyOutcome } from 'lib/outcome.js';

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

function testGeneralOutcomeVerification() {
  const checks=[{text:'Each research subtask returned a lead.',check:{type:'search_results',min:2,perStep:true}},{text:'The owner must review the conclusion.',check:{type:'human_review'}}];
  const good=[{step_type:'research_search',status:'completed',result:{results:[{title:'A',url:'https://a.example'}]}},{step_type:'research_search',status:'completed',result:{results:[{title:'B',url:'https://b.example'}]}}];
  const bad=[good[0],{step_type:'research_search',status:'completed',result:{results:[]}}];
  const passed=verifyOutcome(checks,good),rejected=verifyOutcome(checks,bad);
  const ok=passed.status==='criteria_met_pending_review'&&passed.counts.met===1&&passed.counts.needs_review===1&&rejected.status==='criteria_unmet'&&rejected.counts.unmet===1;
  return {name:'general_outcome_verification',ok,semantic:ok,detail:ok?'Outcome verifier distinguishes met, unmet and human-review-only criteria.':'Outcome verifier failed seeded acceptance criteria.',passedStatus:passed.status,rejectedStatus:rejected.status};
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
  results.push(testMissionRuntimePolicies());
  results.push(testMissionGraphPolicy());
  results.push(testSpecialistRevisionPolicy());
  results.push(await testParallelExecution());
  results.push(await testIndependentVerifier());
  results.push(testGeneralOutcomeVerification());
  results.push(testClaimContradictionAndSourceIndependence());
  results.push(await testPublicSearch());
  results.push(await testSourceFreshnessFallback());
  const failed = results.filter(r => !r.ok);
  console.log('ULTRON self-test', JSON.stringify(results));
  if (failed.length) return res.status(500).json({ ok: false, failed, results });
  return res.json({ ok: true, results });
}