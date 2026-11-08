// ULTRON's API-free local reasoning layer.
// This is explicit, bounded symbolic/evidence reasoning, not a generative language model.
const text = value => String(value == null ? '' : value);
const hostOf = value => { try { return new URL(value).hostname.toLowerCase().replace(/^www\\./,''); } catch { return ''; } };
const validHttps = value => { try { const u=new URL(value); return u.protocol==='https:' && !!u.hostname; } catch { return false; } };

function researchReview(result) {
  const rows=Array.isArray(result?.results)?result.results:[];
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
  const m=s.match(/^(-?\d+(?:\.\d+)?)\s*([+*x×÷\/-])\s*(-?\d+(?:\.\d+)?)$/i);
  if(!m)return null;
  const a=Number(m[1]),b=Number(m[3]),op=m[2];
  if(!Number.isFinite(a)||!Number.isFinite(b))return null;
  if((op==='/'||op==='÷')&&b===0)return null;
  const answer=op==='+'?a+b:op==='-'?a-b:(op==='/'||op==='÷')?a/b:a*b;
  return Number.isFinite(answer)?{expression:s,answer:String(Number(answer.toPrecision(12)))}:null;
}
function analystReview(task, evidence) {
  const result=evidence?.operationResult||{};
  const supplied=evidence?.reports||result?.reports||task?.reports||[];
  const values=supplied.map(x=>x&&typeof x==='object'?x.value:x).filter(x=>x!==null&&x!==undefined).map(text);
  const distinct=[...new Set(values)];
  const calculation=parseArithmetic(task?.expression||task?.input?.expression||evidence?.calculation||result?.calculation);
  const expected=text(task?.expectedAnswer||task?.input?.expectedAnswer||evidence?.expectedAnswer||result?.expectedAnswer);
  const arithmeticMatches=!!calculation&&(!expected||Number(expected)===Number(calculation.answer));
  return {
    role:'analyst',
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
  const analyst=runLocalSpecialistReasoning('analyst',{expression:'17 * 19',expectedAnswer:'323',reports:[12,15]},{});
  const verifier=runLocalSpecialistReasoning('verifier',{}, {operationResult:{results:[{title:'Treatment works',url:'https://example.org/paper'}]},deterministicVerification:{checks:[{name:'source_exists',ok:true}]}});
  const r=researcher.output,a=analyst.output,v=verifier.output;
  const checks=[
    {name:'researcher_does_not_promote_title_only_lead',ok:r.leadCount===1&&r.leads[0].hasCapturedPassage===false&&r.factualAccuracyCertified===false},
    {name:'analyst_solves_known_arithmetic',ok:a.arithmetic?.answer==='323'&&a.arithmetic.consistent===true},
    {name:'analyst_flags_conflicting_values',ok:a.contradictions.detected===true&&a.contradictions.unresolved===true},
    {name:'verifier_preserves_truth_boundary',ok:v.operationalChecksPassed===true&&v.factualTruthCertified===false&&v.challenge.some(x=>x.includes('title'))}
  ];
  return {name:'api_free_local_specialist_reasoning',ok:checks.every(x=>x.ok),semantic:checks.every(x=>x.ok),engine:'ultron_local_symbolic_v1',checks,note:'Tests bounded local reasoning only; this is not a neural language model or a general intelligence benchmark.'};
}