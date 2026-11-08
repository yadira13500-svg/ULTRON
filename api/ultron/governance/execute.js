import { db } from 'hatchable';
import { executeAuthorizedTest, attestationPayload, verifyPersistedAttestation } from 'lib/verification-runner.js';
import { verifyAttestation } from 'lib/attestation-crypto.js';

export const access = 'admin';
export const methods = ['POST'];

export default async function(req,res) {
  const owner=String(req.member?.id||'');
  const body=req.body||{};
  const testId=String(body.test_id||'');
  const requestId=String(body.request_id||'');
  if(!owner) return res.status(401).json({error:'Owner identity is required.'});
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
    return res.status(400).json({error:'A unique UUID request_id is required.'});
  const unexpectedFields=Object.keys(body).filter(key=>!['test_id','request_id'].includes(key));
  if(unexpectedFields.length)
    return res.status(400).json({error:'Client-supplied results, provenance, evidence and attestations are forbidden. Submit only an allowlisted test_id and unique request_id.'});
  const testNames={
    governance_policy_challenge_v1:'governance_registry',
    attestation_security_challenge_v1:'verification_engine'
  };
  const capabilityKey=testNames[testId];
  if(!capabilityKey) return res.status(400).json({error:'Test ID is not in the backend allowlist.'});
  let capability;
  try {
    capability=(await db.query(
      'SELECT * FROM ultron_capabilities WHERE owner_id=$1 AND capability_key=$2',
      [owner,capabilityKey]
    )).rows[0];
  } catch {
    return res.status(503).json({outcome:'unavailable',reason:'Capability registry migration is not installed.'});
  }
  if(!capability) return res.status(404).json({error:'Register the capability before running its verification test.'});

  let replay;
  try {
    replay=(await db.query(
      'SELECT id FROM ultron_verifications WHERE owner_id=$1 AND idempotency_key=$2',
      [owner,requestId]
    )).rows[0];
  } catch {
    return res.status(503).json({outcome:'unavailable',reason:'Attestation schema is not installed.'});
  }
  if(replay) return res.status(409).json({error:'Duplicate request or replay rejected. The original execution remains the sole record.'});

  const execution=await executeAuthorizedTest({
    testId,ownerId:owner,capabilityId:capability.id,requestId,environment:'production',
    signingKey:process.env.ULTRON_VERIFICATION_SIGNING_KEY
  });
  if(!execution.ok) return res.status(execution.httpStatus||400).json({error:execution.error});

  const r=execution.record;
  const signedPayload=attestationPayload(r);
  const signatureValid=execution.attestationVerified&&execution.signature
    ? await verifyAttestation(signedPayload,execution.signature,process.env.ULTRON_VERIFICATION_SIGNING_KEY)
    : false;
  const attested=signatureValid===true;
  const evidenceRefs=r.evidence_refs;
  const executionResult={
    execution_id:r.execution_id,
    test_id:r.test_id,
    test_category:r.test_category,
    outcome:r.outcome,
    exit_status:r.exit_status,
    evidence_sha256:r.evidence_sha256,
    attestation_id:attested?r.attestation_id:null,
    signing_status:attested?'signed':'unattested',
    signing_error:execution.signingError,
    output:execution.execution.output,
    };
  const row={
    id:r.verification_id,
    owner_id:owner,
    capability_id:capability.id,
    test_name:r.test_id,
    test_reason:execution.test.reason,
    test_environment:r.test_environment,
    verification_method:execution.test.method,
    test_source:execution.test.source,
    execution_result:executionResult,
    outcome:r.outcome,
    semantic_checks_passed:execution.semanticChecksPassed,
    independent:execution.independent,
    execution_origin:r.execution_origin,
    attestation_verified:attested,
    limitations:attested?r.limitations:['This run was executed by the backend but could not be cryptographically attested because the signing secret is not configured or signature validation failed.'],
    software_version:r.software_version,
    evidence_refs:evidenceRefs,
    executed_at:r.completed_at,
    test_id:r.test_id,
    test_category:r.test_category,
    execution_id:r.execution_id,
    started_at:r.started_at,
    completed_at:r.completed_at,
    exit_status:r.exit_status,
    output_text:execution.execution.output,
    evidence_sha256:r.evidence_sha256,
    attestation_id:attested?r.attestation_id:null,
    nonce:r.nonce,
    idempotency_key:r.idempotency_key,
    signature_algorithm:attested?'HMAC-SHA-256':null,
    signature:attested?execution.signature:null,
    expires_at:attested?r.expires_at:null,
    build_fingerprint:r.build_fingerprint,
    runner_version:r.runner_version
  };

  // These allowlisted suites are unit-level and explicitly not independent, so they cannot promote.
  // Failed, unavailable and inconclusive outcomes are still recorded as immutable attempts.
  const insertSql=`INSERT INTO ultron_verifications(
    id,owner_id,capability_id,test_name,test_reason,test_environment,verification_method,
    test_source,execution_result,outcome,semantic_checks_passed,independent,execution_origin,
    attestation_verified,limitations,software_version,evidence_refs,executed_at,
    test_id,test_category,execution_id,started_at,completed_at,exit_status,output_text,
    evidence_sha256,attestation_id,nonce,idempotency_key,signature_algorithm,signature,
    expires_at,build_fingerprint,runner_version
  ) VALUES(
    $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16,$17::jsonb,$18,
    $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
  )`;
  const params=[
    row.id,row.owner_id,row.capability_id,row.test_name,row.test_reason,row.test_environment,row.verification_method,
    row.test_source,JSON.stringify(row.execution_result),row.outcome,row.semantic_checks_passed,row.independent,
    row.execution_origin,row.attestation_verified,JSON.stringify(row.limitations),row.software_version,
    JSON.stringify(row.evidence_refs),row.executed_at,row.test_id,row.test_category,row.execution_id,
    row.started_at,row.completed_at,row.exit_status,row.output_text,row.evidence_sha256,row.attestation_id,
    row.nonce,row.idempotency_key,row.signature_algorithm,row.signature,row.expires_at,row.build_fingerprint,row.runner_version
  ];
  try {
    await db.transaction([
      {sql:insertSql,params},
      {sql:`UPDATE ultron_capabilities
        SET latest_verification_attempt_id=$3,verification_method=$4,last_test_source=$5,
            last_test_result=$6::jsonb,evidence_refs=$7::jsonb,updated_at=now()
        WHERE id=$1 AND owner_id=$2`,
       params:[capability.id,owner,row.id,row.verification_method,row.test_source,JSON.stringify(row.execution_result),JSON.stringify(row.evidence_refs)]}
    ]);
  } catch(error) {
    const message=String(error?.message||error);
    if(/unique|duplicate/i.test(message)) return res.status(409).json({error:'Duplicate request or replay rejected. No second attestation was created.'});
    return res.status(503).json({outcome:'unavailable',reason:'Execution completed but the evidence transaction failed; no verification record was committed.'});
  }
  const persisted=(await db.query('SELECT * FROM ultron_verifications WHERE id=$1 AND owner_id=$2',[row.id,owner])).rows[0];
  if(!persisted) return res.status(500).json({error:'Verification persistence could not be confirmed.'});
  const persistedAttestation=attested
    ? await verifyPersistedAttestation(persisted,process.env.ULTRON_VERIFICATION_SIGNING_KEY)
    : {valid:false,digestValid:false,signatureValid:false,current:false};
  if(attested&&!persistedAttestation.valid) return res.status(500).json({
    ok:false,error:'Persisted attestation failed its post-write integrity check.',
    verification:persisted,attested:false,persistedAttestation,
    capabilityStatusUnchanged:true
  });
  return res.status(201).json({
    ok:true,
    verification:persisted,
    capabilityStatusUnchanged:true,
    attested:attested&&persistedAttestation.valid,
    persistedAttestation,
    note:attested
      ? 'Backend test executed; its signature, evidence digest and expiry were verified again after persistence. This unit-level non-independent test does not promote capability status.'
      : 'Backend test executed and recorded as unattested. Capability status was not changed. Configure ULTRON_VERIFICATION_SIGNING_KEY before issuing trusted attestations.'
  });
}