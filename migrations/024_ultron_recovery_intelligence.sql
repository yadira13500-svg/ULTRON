CREATE TABLE IF NOT EXISTS ultron_recovery_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  run_id UUID NOT NULL,
  revision_id UUID NOT NULL,
  event_key TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('proposed','owner_input','approved','rejected','superseded','terminal_completed','terminal_failed')),
  strategy_type TEXT NOT NULL DEFAULT 'unknown',
  failed_step_type TEXT NOT NULL DEFAULT 'unknown',
  failure_category TEXT NOT NULL DEFAULT 'unknown',
  owner_modified_inputs BOOLEAN NOT NULL DEFAULT false,
  plan_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id,event_key)
);
CREATE INDEX IF NOT EXISTS ultron_recovery_observations_owner_time
  ON ultron_recovery_observations(owner_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS ultron_recovery_observations_revision
  ON ultron_recovery_observations(owner_id,revision_id,event_type);