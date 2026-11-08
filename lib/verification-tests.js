import { runGovernancePolicySelfTests } from 'lib/governance-registry.js';
import { sha256Hex, signAttestation, verifyAttestation, isAttestationCurrent } from 'lib/attestation-crypto.js';

export const VERIFICATION_TESTS = Object.freeze({
  governance_policy_challenge_v1: Object.freeze({
    id:'governance_policy_challenge_v1',
    capabilityKey:'governance_registry',
    category:'governance',
    method:'unit',
    reason:'Challenge capability status policy against forged, weak, incomplete and failed evidence.',
    source:'lib/governance-registry.js::runGovernancePolicySelfTests',
    independent:false,
    async execute() {
      const report=runGovernancePolicySelfTests();
      const passed=report.failed.length===0&&report.passed===report.total;
      return {outcome:passed?'passed':'failed',exitStatus:passed?0:1,semantic:passed,output:JSON.stringify(report),details:report};
    }
  }),
  attestation_security_challenge_v1: Object.freeze({
    id:'attestation_security_challenge_v1',
    capabilityKey:'verification_engine',
    category:'security',
    method:'unit',
    reason:'Challenge HMAC integrity, output digest binding, wrong-key rejection, malformed signatures and expiry checks.',
    source:'lib/attestation-crypto.js::signAttestation,verifyAttestation,isAttestationCurrent',
    independent:false,
    async execute() {
      const secret='ultron-test-only-signing-key-never-use-in-production-2026';
      const payload={schema:'ultron-verification-attestation-v1',executionId:'fixture-run',outcome:'passed',exitStatus:0,evidenceSha256:await sha256Hex('known output'),expiresAt:'2099-01-01T00:00:00.000Z'};
      const signature=await signAttestation(payload,secret);
      const checks=[
        {name:'valid signed payload verifies',ok:await verifyAttestation(payload,signature,secret)},
        {name:'modified outcome is rejected',ok:!(await verifyAttestation({...payload,outcome:'failed'},signature,secret))},
        {name:'modified evidence digest is rejected',ok:!(await verifyAttestation({...payload,evidenceSha256:await sha256Hex('changed output')},signature,secret))},
        {name:'wrong signing key is rejected',ok:!(await verifyAttestation(payload,signature,secret+'-wrong'))},
        {name:'missing signing key fails closed',ok:!(await verifyAttestation(payload,signature,''))},
        {name:'malformed signature is rejected',ok:!(await verifyAttestation(payload,'not-a-signature',secret))},
        {name:'expired attestation is rejected',ok:!isAttestationCurrent({completed_at:'2000-01-01T00:00:00.000Z',expires_at:'2001-01-01T00:00:00.000Z'})},
        {name:'current attestation remains valid',ok:isAttestationCurrent({completed_at:new Date().toISOString(),expires_at:'2099-01-01T00:00:00.000Z'})}
      ];
      const passed=checks.every(x=>x.ok);
      return {outcome:passed?'passed':'failed',exitStatus:passed?0:1,semantic:passed,output:JSON.stringify({total:checks.length,passed:checks.filter(x=>x.ok).length,failed:checks.filter(x=>!x.ok).map(x=>x.name),checks}),details:{checks}};
    }
  })
});

export function listVerificationTests() {
  return Object.values(VERIFICATION_TESTS).map(test=>({
    id:test.id,capabilityKey:test.capabilityKey,category:test.category,
    method:test.method,independent:test.independent,source:test.source
  }));
}