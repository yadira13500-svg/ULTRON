CREATE TABLE IF NOT EXISTS ultron_lesson_experiments (
  owner_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT false,
  min_per_cohort INTEGER NOT NULL DEFAULT 5 CHECK (min_per_cohort BETWEEN 3 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);