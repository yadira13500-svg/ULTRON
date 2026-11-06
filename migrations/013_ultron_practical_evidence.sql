ALTER TABLE ultron_skill_assessments
ADD COLUMN IF NOT EXISTS practical_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;