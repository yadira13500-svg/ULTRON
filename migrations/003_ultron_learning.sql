CREATE TABLE IF NOT EXISTS ultron_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_url TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT '',
  published_at TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ultron_knowledge_owner_created ON ultron_knowledge(owner_id, created_at DESC);