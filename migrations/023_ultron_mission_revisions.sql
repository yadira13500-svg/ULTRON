ALTER TABLE ultron_agent_runs
  ADD COLUMN IF NOT EXISTS plan_version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS ultron_mission_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  run_id UUID NOT NULL,
  revision_no INTEGER NOT NULL,
  base_plan_version INTEGER NOT NULL,
  candidate_plan JSONB NOT NULL,
  affected_positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  preserved_positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  verifier JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('needs_owner_input','ready_for_owner_approval','approved','rejected','superseded')),
  rationale JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE(owner_id,run_id,revision_no)
);
CREATE INDEX IF NOT EXISTS ultron_mission_revisions_run
  ON ultron_mission_revisions(owner_id,run_id,revision_no DESC);