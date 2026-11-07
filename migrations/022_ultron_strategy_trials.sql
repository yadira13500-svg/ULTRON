ALTER TABLE ultron_strategy_policies
  ADD COLUMN IF NOT EXISTS policy_version UUID NOT NULL DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS ultron_strategy_trials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  policy_version UUID NOT NULL,
  lesson_id TEXT NOT NULL,
  step_type TEXT NOT NULL,
  run_id UUID NOT NULL,
  step_id UUID NOT NULL,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('operationally_verified','retryable_failure','failed','verifier_rejected')),
  verifier_passed BOOLEAN NOT NULL DEFAULT false,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, step_id, attempt, outcome)
);
CREATE INDEX IF NOT EXISTS ultron_strategy_trials_owner_policy
  ON ultron_strategy_trials(owner_id, policy_version, observed_at DESC);
CREATE INDEX IF NOT EXISTS ultron_strategy_trials_owner_lesson
  ON ultron_strategy_trials(owner_id, lesson_id, step_type, observed_at DESC);