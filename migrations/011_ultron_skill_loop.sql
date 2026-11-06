ALTER TABLE ultron_skill_modules
 ADD COLUMN IF NOT EXISTS concepts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS objectives_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS weak_concepts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS practice_tasks_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ultron_skill_assessments
 ADD COLUMN IF NOT EXISTS concept_results JSONB NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS weak_concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
 ADD COLUMN IF NOT EXISTS practice_tasks JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS ultron_skill_applications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id TEXT NOT NULL,
 skill_id UUID NOT NULL REFERENCES ultron_skill_modules(id) ON DELETE CASCADE,
 run_id UUID REFERENCES ultron_agent_runs(id) ON DELETE SET NULL,
 task_description TEXT NOT NULL,
 metric_label TEXT NOT NULL,
 metric_direction TEXT NOT NULL DEFAULT 'higher_is_better',
 baseline_value NUMERIC NOT NULL,
 outcome_value NUMERIC,
 outcome_note TEXT NOT NULL DEFAULT '',
 improvement_value NUMERIC,
 improvement_percent NUMERIC,
 status TEXT NOT NULL DEFAULT 'awaiting_outcome',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 measured_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ultron_skill_applications_owner_skill ON ultron_skill_applications(owner_id,skill_id,created_at DESC);