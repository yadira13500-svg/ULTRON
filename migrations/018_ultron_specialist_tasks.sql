-- Durable specialist delegation ledger: one execution task and one separate verifier task per mission step.
CREATE TABLE IF NOT EXISTS ultron_specialist_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id text NOT NULL,
  run_id uuid NOT NULL,
  step_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('execution','verification')),
  specialist_role text NOT NULL CHECK (specialist_role IN ('coordinator','researcher','analyst','executor','verifier')),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(owner_id, step_id, phase)
);
CREATE INDEX IF NOT EXISTS ultron_specialist_tasks_run_status
  ON ultron_specialist_tasks(owner_id, run_id, status, phase);
CREATE INDEX IF NOT EXISTS ultron_specialist_tasks_lease
  ON ultron_specialist_tasks(status, lease_until) WHERE status = 'running';