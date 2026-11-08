// ULTRON's API-free local reasoning layer.
// This is explicit, bounded symbolic/evidence reasoning, not a generative language model.
const text = value => String(value == null ? '' : value);
const hostOf = value => { try { return new URL(value).hostname.toLowerCase().replace(/^www\\./,''); } catch { return ''; } };
const validHttps = value => { try { const u=new URL(value); return u.protocol==='https:' && !!u.hostname; } catch { return false; } };

function researchReview(result) {
  const rows=Array.isArray(result?.results)?result.results:(result&&typeof result==='object'&&(result.url||result.title)?[result]:[]);
  const leads=rows.map(row=>({
    title:text(row?.title).trim(),
    url:text(row?.url).trim(),
    host:hostOf(row?.url),
    hasCapturedPassage:!!text(row?.article_text||row?.excerpt||row?.snippet||row?.description).trim(),
    hasFullText:!!text(row?.article_text||row?.full_text).trim(),
    date:text(row?.published_at||row?.date||'unknown')
  })).filter(x=>x.title&&validHttps(x.url));
  const hosts=[...new Set(leads.map(x=>x.host).filter(Boolean))];
  const missingPassage=leads.filter(x=>!x.hasCapturedPassage).length;
  return {
    role:'researcher',
    verdict:leads.length?'leads_found':'no_usable_leads',
    leadCount:leads.length,
    distinctHosts:hosts.length,
    leads,
    limitations:[
      ...(missingPassage?['Some leads have no captured passage; titles and URLs alone do not establish the underlying claims.']:[]),
      ...(!leads.length?['No title-plus-HTTPS source lead was available to inspect.']:[]),
      'Host diversity is not proof of editorial or source independence.',
      'Search discovery is not equivalent to reading and evaluating the primary source.'
    ],
    factualAccuracyCertified:false
  };
}
function parseArithmetic(value) {
  const s=text(value).replace(/,/g,'').trim();
  if(!s||s.length>120)return null;
  const tokens=s.match(/\d+(?:\.\d+)?|[()+*/×÷-]/g)||[];
  if(tokens.join('')!==s.replace(/\s+/g,'').replace(/x/gi,'*'))return null;
  let i=0;
  const factor=()=>{
    if(tokens[i]==='-'){i++;return -factor();}
    if(tokens[i]==='+'){i++;return factor();}
    if(tokens[i]==='('){i++;const n=expression();if(tokens[i]!==')')throw new Error('parenthesis');i++;return n;}
    const token=tokens[i++];if(!token||!/^\d+(?:\.\d+)?$/.test(token))throw new Error('number');
    const n=Number(token);if(!Number.isFinite(n))throw new Error('finite');return n;
  };
  const term=()=>{let n=factor();while(['*','/','×','÷'].includes(tokens[i])){const op=tokens[i++],b=factor();if((op==='/'||op==='÷')&&b===0)throw new Error('division_by_zero');n=(op==='*'||op==='×')?n*b:n/b;}return n;};
  const expression=()=>{let n=term();while(tokens[i]==='+'||tokens[i]==='-'){const op=tokens[i++],b=term();n=op==='+'?n+b:n-b;}return n;};
  try{const answer=expression();if(i!==tokens.length||!Number.isFinite(answer))return null;return {expression:s,answer:String(Number(answer.toPrecision(12)))};}catch{return null;}
}
function analystReview(task, evidence) {
  const result=evidence?.operationResult||{};
  const supplied=evidence?.reports||result?.reports||task?.reports||[];
  const values=supplied.map(x=>x&&typeof x==='object'?x.value:x).filter(x=>x!==null&&x!==undefined).map(text);
  const distinct=[...new Set(values)];
  const calculation=parseArithmetic(task?.expression||task?.input?.expression||evidence?.calculation||result?.calculation);
  const expected=text(task?.expectedAnswer||task?.input?.expectedAnswer||evidence?.expectedAnswer||result?.expectedAnswer);
  const arithmeticMatches=!!calculation&&(!expected||Number(expected)===Number(calculation.answer));
  const deep=result?.deepAnalysis||{};
  const perSource=Array.isArray(deep.perSource)?deep.perSource:[];
  const claimEvidenceReview={
    status:text(deep.status||result?.assessmentStatus||'not_assessed'),
    confidenceBand:deep.confidenceBand||null,
    supportingSourceCount:Number(deep.supportingSourceCount||0),
    contradictingSourceCount:Number(deep.contradictingSourceCount||0),
    independentSupportGroups:Number(deep.independentSupportGroups||0),
    sourceReviews:perSource.map(x=>({url:text(x.url),stance:text(x.stance),coverage:Number(x.coverage||0),freshness:x.freshness?.state||'unknown',provenanceScore:Number(x.provenance?.score||0)})),
    reasons:Array.isArray(deep.reasons)?deep.reasons.map(text):[],
    independenceLimit:text(deep.independence?.note||'Source independence was not assessed.')
  };
  return {
    role:'analyst',
    claimEvidenceReview,
    arithmetic:calculation?{...calculation,expected:expected||null,consistent:arithmeticMatches}:null,
    contradictions:distinct.length>1?{detected:true,values:distinct,unresolved:true}: {detected:false,values:distinct},
    assumptions:[],
    unresolvedQuestions:distinct.length>1?['What definitions, time periods, or measurement scopes explain the differing values?']:[],
    confidence:'bounded_to_explicit_inputs',
    factualAccuracyCertified:false
  };
}
function verifierReview(evidence) {
  const checks=Array.isArray(evidence?.deterministicVerification?.checks)?evidence.deterministicVerification.checks:[];
  const failed=checks.filter(x=>x?.ok!==true).map(x=>({name:text(x?.name),evidence:text(x?.evidence)}));
  const result=evidence?.operationResult||{};
  const titleOnly=Array.isArray(result?.results)&&result.results.some(x=>!text(x?.article_text||x?.excerpt||x?.snippet||x?.description).trim());
  const passed=checks.length>0&&failed.length===0;
  return {
    role:'verifier',
    verdict:passed?'operational_checks_passed':checks.length?'operational_checks_failed':'not_enough_verification_checks',
    checksReviewed:checks.length,
    failedChecks:failed,
    challenge:[
      ...(titleOnly?['At least one research lead lacks a captured passage; do not infer factual support from its title.']:[]),
      ...(!checks.length?['No independent deterministic checks were supplied.']:[]),
      'Passing operation checks does not certify factual truth.'
    ],
    factualTruthCertified:false,
    operationalChecksPassed:passed
  };
}
export function runLocalSpecialistReasoning(role, task={}, evidence={}) {
  const started=Date.now();
  let output;
  if(role==='researcher') output=researchReview(evidence?.operationResult||evidence);
  else if(role==='analyst') output=analystReview(task,evidence);
  else if(role==='verifier') output=verifierReview(evidence);
  else return {status:'unsupported',attempted:false,engine:'ultron_local_symbolic_v1',reason:'No local reasoning contract exists for this role.'};
  return {status:'completed',attempted:true,provider:'local',engine:'ultron_local_symbolic_v1',latencyMs:Date.now()-started,output};
}
export function localReasoningSelfTest() {
  const researcher=runLocalSpecialistReasoning('researcher',{}, {operationResult:{results:[{title:'A study title',url:'https://example.org/study'}]}});
  const analyst=runLocalSpecialistReasoning('analyst',{expression:'17 * 19',expectedAnswer:'323',reports:[12,15]},{operationResult:{assessmentStatus:'insufficient_evidence',deepAnalysis:{status:'insufficient_evidence',confidenceBand:'low',supportingSourceCount:0,perSource:[{url:'https://example.org/a',stance:'related_unclear',coverage:0.5,freshness:{state:'undated'},provenance:{score:0.4}}],reasons:['No independently supported conclusion.']}}});
  const verifier=runLocalSpecialistReasoning('verifier',{}, {operationResult:{results:[{title:'Treatment works',url:'https://example.org/paper'}]},deterministicVerification:{checks:[{name:'source_exists',ok:true}]}});
  const precedence=runLocalSpecialistReasoning('analyst',{expression:'2 + 3 * 4',expectedAnswer:'14'},{});
  const parentheses=runLocalSpecialistReasoning('analyst',{expression:'(2 + 3) * 4',expectedAnswer:'20'},{});
  const divideZero=runLocalSpecialistReasoning('analyst',{expression:'8 / 0'},{});
  const invalidResearch=runLocalSpecialistReasoning('researcher',{}, {operationResult:{results:[{title:'Insecure source',url:'http://example.org/a'},{title:'No URL'}]}});
  const singleCapturedSource=runLocalSpecialistReasoning('researcher',{}, {operationResult:{title:'Captured official reference',url:'https://example.org/reference',excerpt:'The API defines a stable interface for the platform.',httpStatus:200}});
  const failedVerifier=runLocalSpecialistReasoning('verifier',{}, {deterministicVerification:{checks:[{name:'source_integrity',ok:false,evidence:'hash mismatch'}]}});
  const emptyVerifier=runLocalSpecialistReasoning('verifier',{}, {deterministicVerification:{checks:[]}});
  const r=researcher.output,a=analyst.output,v=verifier.output;
  const checks=[
    {name:'researcher_does_not_promote_title_only_lead',ok:r.leadCount===1&&r.leads[0].hasCapturedPassage===false&&r.factualAccuracyCertified===false},
    {name:'analyst_solves_known_arithmetic',ok:a.arithmetic?.answer==='323'&&a.arithmetic.consistent===true},
    {name:'analyst_flags_conflicting_values',ok:a.contradictions.detected===true&&a.contradictions.unresolved===true},
    {name:'analyst_reports_claim_evidence_limits',ok:a.claimEvidenceReview?.status==='insufficient_evidence'&&a.claimEvidenceReview?.confidenceBand==='low'&&a.claimEvidenceReview?.sourceReviews?.[0]?.freshness==='undated'},
    {name:'verifier_preserves_truth_boundary',ok:v.operationalChecksPassed===true&&v.factualTruthCertified===false&&v.challenge.some(x=>x.includes('title'))},
    {name:'arithmetic_operator_precedence',ok:precedence.output.arithmetic?.answer==='14'&&precedence.output.arithmetic.consistent===true},
    {name:'arithmetic_parentheses',ok:parentheses.output.arithmetic?.answer==='20'&&parentheses.output.arithmetic.consistent===true},
    {name:'arithmetic_rejects_division_by_zero',ok:divideZero.output.arithmetic===null},
    {name:'researcher_rejects_non_https_and_incomplete_leads',ok:invalidResearch.output.leadCount===0&&invalidResearch.output.verdict==='no_usable_leads'},
    {name:'researcher_reviews_single_captured_source_object',ok:singleCapturedSource.output.leadCount===1&&singleCapturedSource.output.leads[0].hasCapturedPassage===true&&singleCapturedSource.output.factualAccuracyCertified===false},
    {name:'verifier_fails_on_failed_check',ok:failedVerifier.output.operationalChecksPassed===false&&failedVerifier.output.failedChecks.length===1},
    {name:'verifier_does_not_pass_empty_checklist',ok:emptyVerifier.output.verdict==='not_enough_verification_checks'&&emptyVerifier.output.operationalChecksPassed===false}
  ];
  const simple=checks.filter(x=>['researcher_does_not_promote_title_only_lead','analyst_solves_known_arithmetic','analyst_flags_conflicting_values'].includes(x.name));
  const challenge=checks.filter(x=>!simple.includes(x));
  const passed=checks.filter(x=>x.ok).length;
  return {name:'api_free_local_specialist_reasoning',ok:passed===checks.length,semantic:passed===checks.length,engine:'ultron_local_symbolic_v1',score:{passed,total:checks.length,accuracy:checks.length?Number((passed/checks.length).toFixed(4)):0,simple:{passed:simple.filter(x=>x.ok).length,total:simple.length},challenge:{passed:challenge.filter(x=>x.ok).length,total:challenge.length}},checks,note:'Deterministic known-answer software benchmark only. It measures these explicit contracts, not general language intelligence or neural reasoning.'};
}