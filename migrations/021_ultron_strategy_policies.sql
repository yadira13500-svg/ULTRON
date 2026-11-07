CREATE TABLE IF NOT EXISTS ultron_strategy_policies (
  owner_id TEXT NOT NULL,
  step_type TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, step_type)
);
CREATE INDEX IF NOT EXISTS ultron_strategy_policies_lesson_idx
  ON ultron_strategy_policies(owner_id, lesson_id);