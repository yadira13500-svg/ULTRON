CREATE TABLE IF NOT EXISTS ultron_recovery_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  run_id UUID NOT NULL,
  step_id UUID,
  event_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('wait','resume','retry','replan','human_approval','preserve')),
  reason TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id,event_key)
);
CREATE INDEX IF NOT EXISTS ultron_recovery_events_run_time
  ON ultron_recovery_events(owner_id,run_id,created_at DESC);