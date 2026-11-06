CREATE TABLE IF NOT EXISTS ultron_agent_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  lesson_key TEXT NOT NULL,
  lesson TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence NUMERIC NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate','approved','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  UNIQUE(owner_id, lesson_key)
);
CREATE INDEX IF NOT EXISTS ultron_agent_lessons_owner_status ON ultron_agent_lessons(owner_id, status, created_at DESC);