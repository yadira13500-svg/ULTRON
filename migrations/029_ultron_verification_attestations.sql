-- ULTRON Milestone 2: execution provenance and signed verification attestations.
-- Additive, idempotent schema change. Existing verification rows remain untrusted and unchanged.

CREATE TABLE IF NOT EXISTS ultron_verification_policy (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton IS TRUE),
  current_software_version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO ultron_verification_policy(singleton,current_software_version)
VALUES(TRUE,'v308')
ON CONFLICT(singleton) DO NOTHING;

ALTER TABLE ultron_verifications
  ADD COLUMN IF NOT EXISTS test_id TEXT,
  ADD COLUMN IF NOT EXISTS test_category TEXT,
  ADD COLUMN IF NOT EXISTS execution_id UUID,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exit_status INTEGER,
  ADD COLUMN IF NOT EXISTS output_text TEXT,
  ADD COLUMN IF NOT EXISTS evidence_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS attestation_id UUID,
  ADD COLUMN IF NOT EXISTS nonce UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS signature_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS signature TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS build_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS runner_version TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ultron_verifications'::regclass AND conname='ultron_verifications_test_category_check') THEN
    ALTER TABLE ultron_verifications ADD CONSTRAINT ultron_verifications_test_category_check
      CHECK (test_category IS NULL OR test_category IN ('governance','security','regression','integration','database','external','device'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ultron_verifications'::regclass AND conname='ultron_verifications_execution_time_check') THEN
    ALTER TABLE ultron_verifications ADD CONSTRAINT ultron_verifications_execution_time_check
      CHECK (started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ultron_verifications'::regclass AND conname='ultron_verifications_output_size_check') THEN
    ALTER TABLE ultron_verifications ADD CONSTRAINT ultron_verifications_output_size_check
      CHECK (output_text IS NULL OR length(output_text) <= 24000);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ultron_verifications'::regclass AND conname='ultron_verifications_attestation_shape_check') THEN
    ALTER TABLE ultron_verifications ADD CONSTRAINT ultron_verifications_attestation_shape_check
      CHECK (
        attestation_verified IS NOT TRUE OR (
          execution_origin='backend_test_runner'
          AND test_id IS NOT NULL AND length(trim(test_id)) > 0
          AND test_category IS NOT NULL
          AND execution_id IS NOT NULL
          AND started_at IS NOT NULL AND completed_at IS NOT NULL
          AND completed_at >= started_at
          AND exit_status IS NOT NULL
          AND evidence_sha256 ~ '^[0-9a-f]{64}$'
          AND attestation_id IS NOT NULL
          AND nonce IS NOT NULL
          AND idempotency_key IS NOT NULL
          AND signature_algorithm='HMAC-SHA-256'
          AND signature IS NOT NULL AND length(signature) >= 40
          AND expires_at IS NOT NULL AND expires_at > executed_at
          AND build_fingerprint IS NOT NULL AND length(build_fingerprint) >= 16
          AND runner_version IS NOT NULL
        )
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ultron_verifications_execution_id_unique
  ON ultron_verifications(execution_id) WHERE execution_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ultron_verifications_attestation_id_unique
  ON ultron_verifications(attestation_id) WHERE attestation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ultron_verifications_nonce_unique
  ON ultron_verifications(nonce) WHERE nonce IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ultron_verifications_owner_idempotency_unique
  ON ultron_verifications(owner_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Tighten database promotion enforcement. HMAC verification is performed by the
-- backend before status writes; this trigger independently checks required fields,
-- release binding and expiry. Database superusers remain inside the trust boundary.
CREATE OR REPLACE FUNCTION ultron_guard_capability_verification()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v RECORD;
  current_version TEXT;
BEGIN
  IF NEW.status IN ('verified_under_defined_test_conditions','verified_in_real_world_operation') THEN
    SELECT current_software_version INTO current_version
      FROM ultron_verification_policy WHERE singleton IS TRUE;
    IF current_version IS NULL THEN
      RAISE EXCEPTION 'Verification policy release version is not configured';
    END IF;
    IF NEW.last_verification_id IS NULL THEN
      RAISE EXCEPTION 'Verified capability status requires a linked verification record';
    END IF;
    SELECT * INTO v FROM ultron_verifications
      WHERE id=NEW.last_verification_id
        AND owner_id=NEW.owner_id
        AND capability_id=NEW.id;
    IF NOT FOUND OR v.outcome<>'passed' OR v.independent IS NOT TRUE
       OR v.attestation_verified IS NOT TRUE
       OR v.execution_origin<>'backend_test_runner'
       OR v.semantic_checks_passed IS NOT TRUE
       OR jsonb_typeof(v.evidence_refs)<>'array'
       OR jsonb_array_length(v.evidence_refs)<1
       OR length(trim(v.test_source))=0
       OR v.test_id IS NULL OR v.execution_id IS NULL
       OR v.started_at IS NULL OR v.completed_at IS NULL
       OR v.exit_status<>0
       OR v.evidence_sha256 !~ '^[0-9a-f]{64}$'
       OR v.attestation_id IS NULL OR v.nonce IS NULL
       OR v.signature_algorithm<>'HMAC-SHA-256'
       OR v.signature IS NULL OR v.expires_at IS NULL OR v.expires_at<=now()
       OR v.build_fingerprint IS NULL OR v.runner_version IS NULL
       OR v.software_version<>current_version THEN
      RAISE EXCEPTION 'Verification record lacks current, signed backend execution evidence';
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