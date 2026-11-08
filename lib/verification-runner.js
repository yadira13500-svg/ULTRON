import { VERIFICATION_TESTS } from 'lib/verification-tests.js';
import { sha256Hex, signAttestation, verifyAttestation, isAttestationCurrent } from 'lib/attestation-crypto.js';

export const VERIFICATION_RUNNER_VERSION='ultron-verification-runner/1';
export const SOFTWARE_VERSION='v308';
export const ATTESTATION_TTL_MS=24*60*60*1000;
const MAX_OUTPUT_CHARS=24000;

export function attestationPayload(record) {
  return {
    schema:'ultron-verification-attestation-v1',
    executionId:record.execution_id,
    verificationId:record.verification_id||record.id,
    attestationId:record.attestation_id,
    nonce:record.nonce,
    idempotencyKey:record.idempotency_key,
    ownerId:record.owner_id,
    capabilityId:record.capability_id,
    testId:record.test_id,
    testCategory:record.test_category,
    softwareVersion:record.software_version,
    buildFingerprint:record.build_fingerprint,
    runnerVersion:record.runner_version,
    environment:record.test_environment,
    startedAt:record.started_at,
    completedAt:record.completed_at,
    outcome:record.outcome,
    exitStatus:record.exit_status,
    executionOrigin:record.execution_origin,
    evidenceSha256:record.evidence_sha256,
    evidenceRefs:record.evidence_refs||[],
    limitations:record.limitations||[],
    testSource:record.test_source,
    verificationMethod:record.verification_method,
    testReason:record.test_reason,
    semanticChecksPassed:record.semantic_checks_passed===true,
    independent:record.independent===true,
    expiresAt:record.expires_at
  };
}

export async function verifyPersistedAttestation(record,secret,now=Date.now()) {
  const digestValid=await sha256Hex(record?.output_text||'')===record?.evidence_sha256;
  const signatureValid=await verifyAttestation(attestationPayload(record),record?.signature,secret);
  const current=isAttestationCurrent(record,now);
  return {valid:digestValid&&signatureValid&&current,digestValid,signatureValid,current};
}

export async function runVerificationEngineSelfTests() {
  const result=await VERIFICATION_TESTS.attestation_security_challenge_v1.execute();
  const details=JSON.parse(result.output);
  return {total:details.total,passed:details.passed,failed:details.failed,checks:details.checks,keyScope:'test_only_fixture_not_production_signing_key'};
}

function trimOutput(value) {
  const output=typeof value==='string'?value:JSON.stringify(value??'');
  return output.length>MAX_OUTPUT_CHARS?output.slice(0,MAX_OUTPUT_CHARS)+'\n[TRUNCATED]':output;
}

export async function executeAuthorizedTest({testId,ownerId,capabilityId,requestId,environment='production',signingKey,now=Date.now()}) {
  const test=VERIFICATION_TESTS[testId];
  if(!test) return {ok:false,httpStatus:400,error:'Test ID is not in the backend allowlist.'};
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(requestId||'')))
    return {ok:false,httpStatus:400,error:'A UUID idempotency key is required.'};
  if(!ownerId||!capabilityId) return {ok:false,httpStatus:400,error:'Owner and registered capability are required.'};

  const executionId=crypto.randomUUID();
  const verificationId=crypto.randomUUID();
  const attestationId=crypto.randomUUID();
  const nonce=crypto.randomUUID();
  const startedAt=new Date(now).toISOString();
  let execution;
  if(typeof test.execute!=='function') {
    execution={outcome:'unavailable',exitStatus:125,semantic:false,output:'Allowlisted test handler is unavailable and was not executed.'};
  } else {
    try {
      execution=await test.execute();
    } catch(error) {
      execution={outcome:'inconclusive',exitStatus:2,semantic:false,output:'Test execution threw before a determinate result was produced.',details:{error:String(error?.message||error).slice(0,500)}};
    }
  }
  const completedAt=new Date(Date.now()).toISOString();
  let outcome=['passed','failed','partial','unavailable','inconclusive'].includes(execution?.outcome)?execution.outcome:'inconclusive';
  let exitStatus=Number.isInteger(execution?.exitStatus)?execution.exitStatus:(outcome==='passed'?0:2);
  if(outcome==='passed'&&exitStatus!==0) outcome='inconclusive';
  if(outcome==='failed'&&exitStatus===0) exitStatus=1;
  if(['partial','unavailable','inconclusive'].includes(outcome)&&exitStatus===0) exitStatus=outcome==='unavailable'?125:2;
  const outputText=trimOutput(execution?.output||execution?.details||outcome);
  const evidenceSha256=await sha256Hex(outputText);
  const buildFingerprint=await sha256Hex({
    release:SOFTWARE_VERSION,runner:VERIFICATION_RUNNER_VERSION,
    testId:test.id,testSource:test.source,category:test.category
  });
  const expiresAt=new Date(Date.now()+ATTESTATION_TTL_MS).toISOString();
  const record={
    execution_id:executionId,verification_id:verificationId,attestation_id:attestationId,
    nonce,idempotency_key:requestId,owner_id:String(ownerId),capability_id:String(capabilityId),
    test_id:test.id,test_category:test.category,test_source:test.source,
    verification_method:test.method,test_reason:test.reason,
    semantic_checks_passed:execution?.semantic===true,independent:test.independent===true,
    software_version:SOFTWARE_VERSION,build_fingerprint:buildFingerprint,
    runner_version:VERIFICATION_RUNNER_VERSION,test_environment:environment,
    started_at:startedAt,completed_at:completedAt,outcome,exit_status:exitStatus,
    execution_origin:'backend_test_runner',
    evidence_refs:[`evidence://ultron/verification/${executionId}`],
    limitations:[],
    evidence_sha256:evidenceSha256,expires_at:expiresAt
  };
  let signature=null,attestationVerified=false,signingError=null;
  if(typeof signingKey==='string'&&signingKey.length>=32) {
    try {
      signature=await signAttestation(attestationPayload(record),signingKey);
      attestationVerified=await verifyAttestation(attestationPayload(record),signature,signingKey);
      if(!attestationVerified) signingError='signature_self_check_failed';
    } catch { signingError='signing_unavailable'; }
  } else signingError='signing_key_not_configured';

  return {
    ok:true,record,test,
    execution:{...execution,outcome,exitStatus,output:outputText},
    signature,attestationVerified,signingError,
    semanticChecksPassed:record.semantic_checks_passed,
    independent:record.independent
  };
}