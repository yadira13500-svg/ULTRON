import { db } from 'hatchable';
import {
  BASELINE_CAPABILITIES,
  validateCapabilityInput,
  validateVerificationInput,
  decideCapabilityStatus
} from 'lib/governance-registry.js';
import { verifyPersistedAttestation } from 'lib/verification-runner.js';

export const access = 'admin';
export const methods = ['GET','POST'];

export default async function(req,res) {
  const owner=String(req.member.id);
  if(req.method==='GET') {
    const key=String(req.query?.key||'').trim();
    if(key) {
      const capability=(await db.query(
        'SELECT * FROM ultron_capabilities WHERE owner_id=$1 AND capability_key=$2',
        [owner,key]
      )).rows[0];
      if(!capability) return res.status(404).json({error:'Capability not found.'});
      const [verifications,history]=await Promise.all([
        db.query('SELECT * FROM ultron_verifications WHERE owner_id=$1 AND capability_id=$2 ORDER BY executed_at DESC LIMIT 100',[owner,capability.id]),
        db.query('SELECT * FROM ultron_capability_status_history WHERE owner_id=$1 AND capability_id=$2 ORDER BY created_at DESC LIMIT 100',[owner,capability.id])
      ]);
      const verifiedRecords=await Promise.all(verifications.rows.map(async record=>({
        ...record,
        attestationIntegrity:record.attestation_verified===true
          ? await verifyPersistedAttestation(record,process.env.ULTRON_VERIFICATION_SIGNING_KEY)
          : {valid:false,digestValid:false,signatureValid:false,current:false,reason:'unattested'}
      })));
      return res.json({capability,verifications:verifiedRecords,history:history.rows});
    }
    const rows=(await db.query(
      'SELECT * FROM ultron_capabilities WHERE owner_id=$1 ORDER BY subsystem,name',
      [owner]
    )).rows;
    return res.json({capabilities:rows,count:rows.length,registryInitialized:rows.length>0});
  }

  const body=req.body||{};
  if(body.action==='bootstrap_baseline') {
    const inserted=[];
    for(const item of BASELINE_CAPABILITIES) {
      const implementation=item.implementation;
      const status=implementation==='not_implemented'?'not_implemented':'implemented_but_untested';
      const result=await db.query(
        `INSERT INTO ultron_capabilities(owner_id,capability_key,name,description,subsystem,implementation_status,status,status_reason,known_limitations)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
         ON CONFLICT(owner_id,capability_key) DO NOTHING
         RETURNING id,capability_key`,
        [owner,item.key,item.name,item.description,item.subsystem,implementation,status,
         'Initial catalog entry based on source inventory. No capability-specific verification evidence is attached.',
         JSON.stringify(item.limitations)]
      );
      if(result.rows[0]) inserted.push(result.rows[0]);
    }
    const rows=(await db.query('SELECT * FROM ultron_capabilities WHERE owner_id=$1 ORDER BY subsystem,name',[owner])).rows;
    return res.status(200).json({ok:true,insertedCount:inserted.length,inserted,capabilities:rows,count:rows.length,note:'Baseline entries are unverified inventory records, not claims of working functionality.'});
  }

  if(body.action==='register') {
    const checked=validateCapabilityInput(body.capability||{});
    if(!checked.ok) return res.status(400).json({error:checked.error});
    const c=checked.value;
    const result=await db.query(
      `INSERT INTO ultron_capabilities(owner_id,capability_key,name,description,subsystem,implementation_status,status,status_reason,known_limitations)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT(owner_id,capability_key) DO NOTHING
       RETURNING *`,
      [owner,c.key,c.name,c.description,c.subsystem,c.implementation_status,c.status,
       'New capability registered without verification evidence.',JSON.stringify(c.known_limitations)]
    );
    if(!result.rows[0]) return res.status(409).json({error:'Capability key already exists. Existing capability was not overwritten.'});
    return res.status(201).json({capability:result.rows[0]});
  }

  if(body.action==='update_implementation') {
    const capabilityId=String(body.capability_id||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capabilityId))
      return res.status(400).json({error:'A valid capability ID is required.'});
    const current=(await db.query('SELECT * FROM ultron_capabilities WHERE id=$1 AND owner_id=$2',[capabilityId,owner])).rows[0];
    if(!current) return res.status(404).json({error:'Capability not found.'});
    if(current.implementation_status==='implemented') return res.status(409).json({error:'Capability is already registered as implemented.'});
    const updated=(await db.query(
      `UPDATE ultron_capabilities SET implementation_status='implemented',status='implemented_but_untested',
       status_reason='Implementation was recorded. No operational verification evidence is attached.',
       updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *`,
      [capabilityId,owner]
    )).rows[0];
    return res.json({capability:updated,note:'Implementation status changed; operational verification remains untested.'});
  }

  if(body.action==='verify') {
    const capabilityId=String(body.capability_id||'');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(capabilityId))
      return res.status(400).json({error:'A valid capability ID is required.'});
    const capability=(await db.query('SELECT * FROM ultron_capabilities WHERE id=$1 AND owner_id=$2',[capabilityId,owner])).rows[0];
    if(!capability) return res.status(404).json({error:'Capability not found.'});
    const checked=validateVerificationInput(body.verification||{});
    if(!checked.ok) return res.status(400).json({error:checked.error});
    const v=checked.value;
    // Unimplemented capabilities may have test attempts recorded, but the status policy will not promote them.
    const decision=decideCapabilityStatus(capability.status,v);
    const inserted=(await db.query(
      `INSERT INTO ultron_verifications(
        owner_id,capability_id,test_name,test_reason,test_environment,verification_method,
        test_source,execution_result,outcome,semantic_checks_passed,independent,execution_origin,attestation_verified,
        limitations,software_version,evidence_refs,executed_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,'owner_submitted',false,$12::jsonb,$13,$14::jsonb,$15)
       RETURNING *`,
      [owner,capabilityId,v.test_name,v.test_reason,v.test_environment,v.verification_method,
       v.test_source,JSON.stringify(v.execution_result),v.outcome,v.semantic_checks_passed,v.independent,
       JSON.stringify(v.limitations),v.software_version,JSON.stringify(v.evidence_refs),v.executed_at]
    )).rows[0];

    const shouldUpdate=decision.status!==capability.status;
    let updated=capability;
    if(shouldUpdate) {
      updated=(await db.query(
        `UPDATE ultron_capabilities SET status=$3,status_reason=$4,last_verification_id=$5,
          latest_verification_attempt_id=$5,
          last_verified_at=CASE WHEN $6 THEN $7 ELSE last_verified_at END,
          verification_method=$8,last_test_source=$9,last_test_result=$10::jsonb,
          evidence_refs=$11::jsonb,updated_at=now()
         WHERE id=$1 AND owner_id=$2 RETURNING *`,
        [capabilityId,owner,decision.status,decision.reason,inserted.id,
         v.outcome==='passed'&&decision.promoted,v.executed_at,v.verification_method,
         v.test_source,JSON.stringify(v.execution_result),JSON.stringify(v.evidence_refs)]
      )).rows[0];
    } else {
      await db.query(
        `UPDATE ultron_capabilities SET latest_verification_attempt_id=$3,verification_method=$4,
          last_test_source=$5,last_test_result=$6::jsonb,evidence_refs=$7::jsonb,updated_at=now()
         WHERE id=$1 AND owner_id=$2`,
        [capabilityId,owner,inserted.id,v.verification_method,v.test_source,
         JSON.stringify(v.execution_result),JSON.stringify(v.evidence_refs)]
      );
      updated=(await db.query('SELECT * FROM ultron_capabilities WHERE id=$1 AND owner_id=$2',[capabilityId,owner])).rows[0];
    }
    return res.status(201).json({
      verification:inserted,
      capability:updated,
      statusDecision:{status:decision.status,reason:decision.reason,promoted:decision.promoted},
      note:'The verification record is append-only. Owner-submitted reports are not trusted execution attestations and cannot promote or demote capability status. Trusted backend or independent runner execution is required.'
    });
  }

  return res.status(400).json({error:'Supported actions are bootstrap_baseline, register, update_implementation and verify.'});
}