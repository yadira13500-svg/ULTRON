-- Durable, append-only specialist revision history. Existing missions and specialist task records remain intact.
CREATE TABLE IF NOT EXISTS ultron_specialist_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  revision_no integer NOT NULL CHECK (revision_no BETWEEN 1 AND 2),
  specialist_role text NOT NULL,
  revision_instruction text NOT NULL,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  prior_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  prior_verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  revised_output jsonb NOT NULL DEFAULT '{}'::jsonb,
  revised_verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','accepted','rejected')),
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(owner_id, step_id, revision_no)
);
CREATE INDEX IF NOT EXISTS ultron_specialist_revisions_run
  ON ultron_specialist_revisions(owner_id, run_id, step_id, revision_no);