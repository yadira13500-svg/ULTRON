CREATE TABLE IF NOT EXISTS ultron_evidence_repairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  source_run_id UUID NOT NULL,
  proposal_no INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_owner_approval'
    CHECK (status IN ('pending_owner_approval','approved','rejected','superseded')),
  proposal JSONB NOT NULL,
  created_run_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE(owner_id,source_run_id,proposal_no)
);
CREATE INDEX IF NOT EXISTS ultron_evidence_repairs_owner
  ON ultron_evidence_repairs(owner_id,source_run_id,created_at DESC);