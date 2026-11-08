-- ULTRON governance milestone 1: capability registry and append-only verification evidence.
-- Additive only. Existing application records and tables are untouched.

CREATE TABLE IF NOT EXISTS ultron_capabilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  capability_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  subsystem TEXT NOT NULL,
  implementation_status TEXT NOT NULL DEFAULT 'implemented'
    CHECK (implementation_status IN ('not_implemented','implemented')),
  status TEXT NOT NULL DEFAULT 'implemented_but_untested'
    CHECK (status IN (
      'not_implemented',
      'implemented_but_untested',
      'partially_functional',
      'verified_under_defined_test_conditions',
      'verified_in_real_world_operation',
      'failed',
      'degraded'
    )),
  status_reason TEXT NOT NULL DEFAULT 'No capability-specific verification evidence has been recorded.',
  last_verification_id UUID,
  latest_verification_attempt_id UUID,
  last_verified_at TIMESTAMPTZ,
  verification_method TEXT,
  last_test_source TEXT,
  last_test_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  known_limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, capability_key),
  UNIQUE(owner_id, id),
  CHECK ((implementation_status='not_implemented' AND status='not_implemented')
      OR (implementation_status='implemented' AND status<>'not_implemented'))
);

CREATE TABLE IF NOT EXISTS ultron_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  capability_id UUID NOT NULL,
  test_name TEXT NOT NULL,
  test_reason TEXT NOT NULL,
  test_environment TEXT NOT NULL,
  verification_method TEXT NOT NULL
    CHECK (verification_method IN (
      'static_code_inspection','unit','integration','live_api','database',
      'browser','physical_device','external_provider','production_acceptance'
    )),
  test_source TEXT NOT NULL,
  execution_result JSONB NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('passed','failed','partial','unavailable','inconclusive')),
  semantic_checks_passed BOOLEAN NOT NULL DEFAULT false,
  independent BOOLEAN NOT NULL DEFAULT false,
  execution_origin TEXT NOT NULL DEFAULT 'owner_submitted'
    CHECK (execution_origin IN ('owner_submitted','backend_test_runner','independent_ci','device_acceptance')),
  attestation_verified BOOLEAN NOT NULL DEFAULT false,
  limitations JSONB NOT NULL DEFAULT '[]'::jsonb,
  software_version TEXT NOT NULL,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  executed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id,id),
  FOREIGN KEY(owner_id,capability_id) REFERENCES ultron_capabilities(owner_id,id) ON DELETE RESTRICT,
  CHECK (jsonb_typeof(limitations)='array'),
  CHECK (jsonb_typeof(evidence_refs)='array')
);

CREATE INDEX IF NOT EXISTS ultron_capabilities_owner_status
  ON ultron_capabilities(owner_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS ultron_verifications_capability_time
  ON ultron_verifications(owner_id,capability_id,executed_at DESC);
CREATE INDEX IF NOT EXISTS ultron_verifications_outcome_time
  ON ultron_verifications(owner_id,outcome,executed_at DESC);

CREATE TABLE IF NOT EXISTS ultron_capability_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  capability_id UUID NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  verification_id UUID,
  evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_type TEXT NOT NULL DEFAULT 'system',
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY(owner_id,capability_id) REFERENCES ultron_capabilities(owner_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(owner_id,verification_id) REFERENCES ultron_verifications(owner_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ultron_capability_history_capability_time
  ON ultron_capability_status_history(owner_id,capability_id,created_at DESC);

-- Verification and status-history evidence is append-only; corrections must be new records.
CREATE OR REPLACE FUNCTION ultron_reject_governance_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Governance verification and status-history records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS ultron_verifications_append_only ON ultron_verifications;
CREATE TRIGGER ultron_verifications_append_only
  BEFORE UPDATE OR DELETE ON ultron_verifications
  FOR EACH ROW EXECUTE FUNCTION ultron_reject_governance_evidence_mutation();

DROP TRIGGER IF EXISTS ultron_capability_history_append_only ON ultron_capability_status_history;
CREATE TRIGGER ultron_capability_history_append_only
  BEFORE UPDATE OR DELETE ON ultron_capability_status_history
  FOR EACH ROW EXECUTE FUNCTION ultron_reject_governance_evidence_mutation();

-- Database-level guard: verified states require a linked, passed, independent,
-- semantically checked verification with evidence references. A 200 response
-- or source-code inspection alone cannot satisfy this contract.
CREATE OR REPLACE FUNCTION ultron_guard_capability_verification()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v RECORD;
BEGIN
  IF NEW.status IN ('verified_under_defined_test_conditions','verified_in_real_world_operation') THEN
    IF NEW.last_verification_id IS NULL THEN
      RAISE EXCEPTION 'Verified capability status requires a linked verification record';
    END IF;
    SELECT * INTO v FROM ultron_verifications
      WHERE id=NEW.last_verification_id
        AND owner_id=NEW.owner_id
        AND capability_id=NEW.id;
    IF NOT FOUND OR v.outcome<>'passed' OR v.independent IS NOT TRUE
       OR v.attestation_verified IS NOT TRUE
       OR v.execution_origin NOT IN ('backend_test_runner','independent_ci','device_acceptance')
       OR v.semantic_checks_passed IS NOT TRUE
       OR jsonb_typeof(v.evidence_refs)<>'array'
       OR jsonb_array_length(v.evidence_refs)<1
       OR length(trim(v.test_source))=0 THEN
      RAISE EXCEPTION 'Verification evidence does not meet the capability promotion policy';
    END IF;
    IF NEW.status='verified_under_defined_test_conditions'
       AND v.verification_method NOT IN ('integration','live_api','database','browser','physical_device','external_provider','production_acceptance') THEN
      RAISE EXCEPTION 'Verification method is not sufficient for operational verification';
    END IF;
    IF NEW.status='verified_in_real_world_operation'
       AND (v.verification_method<>'production_acceptance' OR lower(v.test_environment)<>'production') THEN
      RAISE EXCEPTION 'Real-world verification requires production acceptance evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ultron_capability_verification_guard ON ultron_capabilities;
CREATE TRIGGER ultron_capability_verification_guard
  BEFORE INSERT OR UPDATE OF status,last_verification_id
  ON ultron_capabilities
  FOR EACH ROW EXECUTE FUNCTION ultron_guard_capability_verification();

-- Automatically preserve every initial status and subsequent status transition.
CREATE OR REPLACE FUNCTION ultron_record_capability_status()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO ultron_capability_status_history(
      owner_id,capability_id,from_status,to_status,reason,verification_id,evidence_snapshot
    ) VALUES (
      NEW.owner_id,NEW.id,NULL,NEW.status,NEW.status_reason,NEW.last_verification_id,
      jsonb_build_object('implementation_status',NEW.implementation_status,'evidence_refs',NEW.evidence_refs)
    );
  ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO ultron_capability_status_history(
      owner_id,capability_id,from_status,to_status,reason,verification_id,evidence_snapshot
    ) VALUES (
      NEW.owner_id,NEW.id,OLD.status,NEW.status,NEW.status_reason,NEW.last_verification_id,
      jsonb_build_object('implementation_status',NEW.implementation_status,'evidence_refs',NEW.evidence_refs)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ultron_capability_status_history_trigger ON ultron_capabilities;
CREATE TRIGGER ultron_capability_status_history_trigger
  AFTER INSERT OR UPDATE OF status
  ON ultron_capabilities
  FOR EACH ROW EXECUTE FUNCTION ultron_record_capability_status();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ultron_capabilities_last_verification_fk') THEN
    ALTER TABLE ultron_capabilities ADD CONSTRAINT ultron_capabilities_last_verification_fk
      FOREIGN KEY(owner_id,last_verification_id) REFERENCES ultron_verifications(owner_id,id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ultron_capabilities_latest_attempt_fk') THEN
    ALTER TABLE ultron_capabilities ADD CONSTRAINT ultron_capabilities_latest_attempt_fk
      FOREIGN KEY(owner_id,latest_verification_attempt_id) REFERENCES ultron_verifications(owner_id,id) ON DELETE RESTRICT;
  END IF;
END $$;