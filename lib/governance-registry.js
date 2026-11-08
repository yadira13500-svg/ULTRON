export const CAPABILITY_STATUSES = Object.freeze([
  'not_implemented',
  'implemented_but_untested',
  'partially_functional',
  'verified_under_defined_test_conditions',
  'verified_in_real_world_operation',
  'failed',
  'degraded'
]);

export const IMPLEMENTATION_STATUSES = Object.freeze(['not_implemented','implemented']);

export const VERIFICATION_METHODS = Object.freeze([
  'static_code_inspection','unit','integration','live_api','database',
  'browser','physical_device','external_provider','production_acceptance'
]);

export const VERIFICATION_OUTCOMES = Object.freeze([
  'passed','failed','partial','unavailable','inconclusive'
]);

const OPERATIONAL_METHODS = new Set([
  'integration','live_api','database','browser','physical_device',
  'external_provider','production_acceptance'
]);

const VERIFIED = new Set([
  'verified_under_defined_test_conditions',
  'verified_in_real_world_operation'
]);

function sanitizeEvidenceValue(value, depth=0) {
  if(depth>6) return '[MAX_DEPTH]';
  if(value===null||typeof value==='boolean'||typeof value==='number') return value;
  if(typeof value==='string') return /bearer\s+[a-z0-9._-]+|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]/i.test(value)?'[REDACTED]':value.slice(0,4000);
  if(Array.isArray(value)) return value.slice(0,100).map(item=>sanitizeEvidenceValue(item,depth+1));
  if(typeof value==='object') {
    const out={};
    for(const [key,item] of Object.entries(value).slice(0,100)) {
      if(/authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|cookie|credential/i.test(key)) out[key]='[REDACTED]';
      else out[String(key).slice(0,120)]=sanitizeEvidenceValue(item,depth+1);
    }
    return out;
  }
  return String(value).slice(0,500);
}

export const BASELINE_CAPABILITIES = Object.freeze([
  {key:'conversation_orchestration',name:'Conversation orchestration',subsystem:'chat',description:'Routes owner conversations through configured AI, local reasoning and supported tools.',implementation:'implemented',limitations:['Actual response quality depends on the selected model and available integrations.','Local model inference has not been verified on the owner iPhone.']},
  {key:'mission_planning_execution',name:'Mission planning and execution',subsystem:'agent',description:'Plans and executes durable multi-step missions with dependencies and execution records.',implementation:'implemented',limitations:['Production reliability is not established by in-process regression tests alone.']},
  {key:'specialist_delegation',name:'Specialist delegation',subsystem:'specialists',description:'Creates researcher, analyst, executor and verifier task records for mission steps.',implementation:'implemented',limitations:['Role separation does not imply independently trained models.']},
  {key:'verifier_challenge_workflow',name:'Verifier challenge workflow',subsystem:'specialists',description:'Challenges execution outputs using separately recorded verifier tasks and evidence contracts.',implementation:'implemented',limitations:['The verifier task uses the existing model architecture; separate task records do not prove an independent model or factual truth.']},
  {key:'mission_recovery',name:'Mission recovery and replanning',subsystem:'recovery',description:'Records recovery decisions, retry contracts and bounded adaptive replanning.',implementation:'implemented',limitations:['Recovery effectiveness must be assessed against real terminal outcomes.']},
  {key:'web_research',name:'Web research and source retrieval',subsystem:'research',description:'Discovers and retrieves public sources for research missions.',implementation:'implemented',limitations:['Provider rate limits and source availability can interrupt research.']},
  {key:'memory_retrieval',name:'Persistent memory retrieval',subsystem:'memory',description:'Stores and retrieves owner-scoped memory and knowledge records.',implementation:'implemented',limitations:['Only one explicit memory record was present at the Phase 1 audit; retrieval quality needs broader testing.']},
  {key:'knowledge_storage',name:'Knowledge storage',subsystem:'knowledge',description:'Persists structured knowledge and source metadata.',implementation:'implemented',limitations:['Stored knowledge is not automatically guaranteed to be current or true.']},
  {key:'learning_evaluation',name:'Learning and strategy evaluation',subsystem:'learning',description:'Tracks lessons, experiments and measured strategy outcomes.',implementation:'implemented',limitations:['This does not retrain model weights.']},
  {key:'browser_local_inference',name:'Browser-local neural inference',subsystem:'local_brain',description:'Loads a quantized SmolLM2 model through WebGPU in a browser worker.',implementation:'implemented',limitations:['Physical iPhone WebGPU loading and inference have not been verified.','The model is starter-scale and is not a high-capability general reasoning model.']},
  {key:'local_neural_benchmark',name:'Local neural benchmark',subsystem:'local_brain',description:'Runs five fixed known-answer cases across three specialist roles.',implementation:'implemented',limitations:['Five cases and approximate scoring do not establish broad intelligence.','Actual owner-device benchmark execution remains unverified.']},
  {key:'voice_stt_tts',name:'Voice speech recognition and synthesis',subsystem:'voice',description:'Provides configured speech-to-text and text-to-speech endpoints.',implementation:'implemented',limitations:['Endpoint configuration does not establish physical microphone, transcription or playback success on iPhone.']},
  {key:'camera_vision',name:'Camera vision analysis',subsystem:'vision',description:'Supports owner-approved image capture and image analysis workflows.',implementation:'implemented',limitations:['Continuous surveillance is not implemented or verified.']},
  {key:'sensor_import',name:'Authorized sensor observation import',subsystem:'sensors',description:'Accepts structured owner-authorized sensor observations.',implementation:'implemented',limitations:['No live camera, drone or aircraft device connection is active.']},
  {key:'nvidia_model_inference',name:'NVIDIA model inference',subsystem:'providers',description:'Contains NVIDIA model catalog and inference adapter integration.',implementation:'implemented',limitations:['Successful NVIDIA inference has not been verified; no paid inference test was performed.']},
  {key:'scheduled_jobs',name:'Scheduled background jobs',subsystem:'jobs',description:'Runs scheduled research, mission runner, daily brief and self-test jobs.',implementation:'implemented',limitations:['Scheduler cadence and task completion do not establish uninterrupted service.']},
  {key:'live_device_control',name:'Live drone and aircraft device control',subsystem:'device_control',description:'Direct live command and control of drones or aircraft.',implementation:'not_implemented',limitations:['No live device connection or control implementation was verified.']},
  {key:'governance_registry',name:'Engineering capability governance registry',subsystem:'governance',description:'Persistent evidence-backed capability status and verification history.',implementation:'implemented',limitations:['Initial registry foundation; incident and defect linkage are later milestones.']},
  {key:'verification_engine',name:'Trusted backend verification engine',subsystem:'governance',description:'Executes allowlisted backend tests and records tamper-evident execution attestations.',implementation:'implemented',limitations:['Milestone 2 draft only; signing secret, deployed execution and isolated PostgreSQL challenge tests are not yet verified.']}
]);

export function validateCapabilityInput(input = {}) {
  const key=String(input.key||'').trim().toLowerCase();
  const name=String(input.name||'').trim();
  const description=String(input.description||'').trim();
  const subsystem=String(input.subsystem||'').trim();
  const implementation=String(input.implementation_status||'implemented');
  const limitations=Array.isArray(input.known_limitations)?input.known_limitations.map(x=>String(x).trim()).filter(Boolean).slice(0,30):[];
  if(!/^[a-z][a-z0-9_]{2,79}$/.test(key)) return {ok:false,error:'Capability key must use 3–80 lowercase letters, numbers or underscores.'};
  if(!name||name.length>160||!description||description.length>2000||!subsystem||subsystem.length>80) return {ok:false,error:'Name, description and subsystem are required and must be within their length limits.'};
  if(!IMPLEMENTATION_STATUSES.includes(implementation)) return {ok:false,error:'Unsupported implementation status.'};
  return {ok:true,value:{key,name,description,subsystem,implementation_status:implementation,status:implementation==='not_implemented'?'not_implemented':'implemented_but_untested',known_limitations:limitations}};
}

export function validateVerificationInput(input = {}) {
  const value={
    test_name:String(input.test_name||'').trim(),
    test_reason:String(input.test_reason||'').trim(),
    test_environment:String(input.test_environment||'').trim(),
    verification_method:String(input.verification_method||''),
    test_source:String(input.test_source||'').trim(),
    execution_result:sanitizeEvidenceValue(input.execution_result),
    outcome:String(input.outcome||''),
    semantic_checks_passed:input.semantic_checks_passed===true,
    independent:input.independent===true,
    limitations:Array.isArray(input.limitations)?input.limitations.map(x=>String(x).trim()).filter(Boolean).slice(0,30):[],
    software_version:String(input.software_version||'').trim(),
    evidence_refs:Array.isArray(input.evidence_refs)?input.evidence_refs.map(x=>String(x).trim()).filter(Boolean).slice(0,30):[],
    executed_at:input.executed_at
  };
  if(!value.test_name||value.test_name.length>180||!value.test_reason||value.test_reason.length>1000) return {ok:false,error:'Test name and reason are required and length-limited.'};
  if(!value.test_environment||value.test_environment.length>100||!value.test_source||value.test_source.length>500) return {ok:false,error:'Test environment and source are required.'};
  if(!VERIFICATION_METHODS.includes(value.verification_method)) return {ok:false,error:'Unsupported verification method.'};
  if(!VERIFICATION_OUTCOMES.includes(value.outcome)) return {ok:false,error:'Unsupported verification outcome.'};
  if(!value.execution_result||typeof value.execution_result!=='object'||Array.isArray(value.execution_result)) return {ok:false,error:'Actual execution result must be a structured object.'};
  if(JSON.stringify(value.execution_result).length>24000) return {ok:false,error:'Execution evidence exceeds the 24 KB storage limit.'};
  if(!value.software_version||value.software_version.length>80) return {ok:false,error:'Software version is required.'};
  if(!value.executed_at||!Number.isFinite(Date.parse(value.executed_at))) return {ok:false,error:'A valid execution timestamp is required.'};
  if(value.evidence_refs.some(x=>x.length>1000||/bearer\s|[?&](?:token|key|secret|password)=/i.test(x))) return {ok:false,error:'Evidence references must be no longer than 1,000 characters and must not contain credentials.'};
  if(/bearer\s|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]/i.test(value.test_source)) return {ok:false,error:'Test source must not contain credentials.'};
  return {ok:true,value};
}

export function decideCapabilityStatus(currentStatus, verification) {
  if(!CAPABILITY_STATUSES.includes(currentStatus)) return {status:null,reason:'Unknown current capability status.',promoted:false};
  if(verification.attestation_verified!==true || !['backend_test_runner','independent_ci','device_acceptance'].includes(verification.execution_origin))
    return {status:currentStatus,reason:'Evidence was submitted but not executed and attested by a trusted verification runner; status is unchanged.',promoted:false};
  if(currentStatus==='not_implemented') return {status:currentStatus,reason:'An unimplemented capability cannot be classified as operationally failed, partial or verified.',promoted:false};
  if(verification.outcome==='failed') {
    const status=VERIFIED.has(currentStatus)?'degraded':'failed';
    return {status,reason:'A capability-specific verification failed; previously verified capability is marked degraded.',promoted:false};
  }
  if(verification.outcome==='partial') return {status:'partially_functional',reason:'Verification found partial functionality.',promoted:false};
  if(verification.outcome!=='passed') return {status:currentStatus,reason:'Inconclusive or unavailable evidence cannot change capability status.',promoted:false};
  const enoughEvidence=verification.independent===true
    && verification.semantic_checks_passed===true
    && verification.evidence_refs?.length>0
    && Boolean(String(verification.test_source||'').trim());
  if(!enoughEvidence) return {status:currentStatus,reason:'Passing result lacks independent semantic checks, traceable evidence and a test source.',promoted:false};
  if(!OPERATIONAL_METHODS.has(verification.verification_method)) return {status:currentStatus,reason:'Static inspection and unit tests cannot establish operational capability.',promoted:false};
  if(verification.verification_method==='production_acceptance'&&String(verification.test_environment).toLowerCase()==='production')
    return {status:'verified_in_real_world_operation',reason:'Production acceptance evidence passed with independent semantic checks and traceable evidence.',promoted:true};
  return {status:'verified_under_defined_test_conditions',reason:'Operational verification passed under the recorded test conditions.',promoted:true};
}

export function runGovernancePolicySelfTests() {
  const base={outcome:'passed',independent:true,semantic_checks_passed:true,attestation_verified:true,execution_origin:'backend_test_runner',evidence_refs:['evidence://test/1'],test_source:'independent-runner',verification_method:'integration',test_environment:'staging'};
  const cases=[
    ['owner-submitted passing report cannot promote',decideCapabilityStatus('implemented_but_untested',{...base,attestation_verified:false,execution_origin:'owner_submitted'}).status==='implemented_but_untested'],
    ['owner-submitted failure cannot demote',decideCapabilityStatus('verified_under_defined_test_conditions',{...base,outcome:'failed',attestation_verified:false,execution_origin:'owner_submitted'}).status==='verified_under_defined_test_conditions'],
    ['unimplemented capability cannot be promoted',decideCapabilityStatus('not_implemented',base).status==='not_implemented'],
    ['owner origin cannot self-attest',decideCapabilityStatus('implemented_but_untested',{...base,execution_origin:'owner_submitted'}).status==='implemented_but_untested'],
    ['unit tests cannot promote',decideCapabilityStatus('implemented_but_untested',{...base,verification_method:'unit'}).status==='implemented_but_untested'],
    ['HTTP-only evidence cannot promote',decideCapabilityStatus('implemented_but_untested',{...base,semantic_checks_passed:false}).status==='implemented_but_untested'],
    ['missing evidence cannot promote',decideCapabilityStatus('implemented_but_untested',{...base,evidence_refs:[]}).status==='implemented_but_untested'],
    ['non-independent evidence cannot promote',decideCapabilityStatus('implemented_but_untested',{...base,independent:false}).status==='implemented_but_untested'],
    ['integration evidence can verify defined conditions',decideCapabilityStatus('implemented_but_untested',base).status==='verified_under_defined_test_conditions'],
    ['production requires production acceptance',decideCapabilityStatus('implemented_but_untested',{...base,verification_method:'production_acceptance',test_environment:'staging'}).status==='verified_under_defined_test_conditions'],
    ['production acceptance can establish real-world status',decideCapabilityStatus('implemented_but_untested',{...base,verification_method:'production_acceptance',test_environment:'production'}).status==='verified_in_real_world_operation'],
    ['failed previously verified capability degrades',decideCapabilityStatus('verified_under_defined_test_conditions',{...base,outcome:'failed'}).status==='degraded'],
    ['failed unverified capability fails',decideCapabilityStatus('implemented_but_untested',{...base,outcome:'failed'}).status==='failed'],
    ['unavailable evidence preserves status',decideCapabilityStatus('verified_under_defined_test_conditions',{...base,outcome:'unavailable'}).status==='verified_under_defined_test_conditions'],
    ['partial result stays partial',decideCapabilityStatus('implemented_but_untested',{...base,outcome:'partial'}).status==='partially_functional']
  ];
  const validSubmission=validateVerificationInput({test_name:'redaction fixture',test_reason:'Check evidence sanitization',test_environment:'test',verification_method:'unit',test_source:'lib/governance-registry-self-test.js',execution_result:{authorization:'Bearer secret-value',message:'safe',details:'api_key=hidden'},outcome:'passed',software_version:'draft',executed_at:'2026-11-08T12:00:00Z',evidence_refs:['evidence://fixture/1']});
  cases.push(['sensitive evidence fields are redacted',validSubmission.ok&&validSubmission.value.execution_result.authorization==='[REDACTED]'&&validSubmission.value.execution_result.details==='[REDACTED]']);
  const credentialRef=validateVerificationInput({test_name:'credential ref',test_reason:'Reject secret-bearing evidence URL',test_environment:'test',verification_method:'unit',test_source:'test.js',execution_result:{ok:true},outcome:'passed',software_version:'draft',executed_at:'2026-11-08T12:00:00Z',evidence_refs:['https://example.test/log?token=secret']});
  cases.push(['credential-bearing evidence references are rejected',credentialRef.ok===false]);
  return {total:cases.length,passed:cases.filter(x=>x[1]).length,failed:cases.filter(x=>!x[1]).map(x=>x[0]),cases:cases.map(([name,ok])=>({name,ok}))};
}