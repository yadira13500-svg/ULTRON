CREATE TABLE IF NOT EXISTS ultron_skill_assessments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id TEXT NOT NULL,
 skill_id UUID NOT NULL REFERENCES ultron_skill_modules(id) ON DELETE CASCADE,
 answers JSONB NOT NULL DEFAULT '[]'::jsonb,
 score NUMERIC,
 practical_pass BOOLEAN,
 reviewer_notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'submitted_ungraded',
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ultron_skill_assessments_owner_skill ON ultron_skill_assessments(owner_id,skill_id,submitted_at DESC);