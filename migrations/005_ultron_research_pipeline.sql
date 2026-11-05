ALTER TABLE ultron_knowledge
 ADD COLUMN IF NOT EXISTS last_checked_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS source_status TEXT NOT NULL DEFAULT 'unchecked',
 ADD COLUMN IF NOT EXISTS refresh_count INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS superseded_by UUID;
CREATE INDEX IF NOT EXISTS ultron_knowledge_refresh_due
 ON ultron_knowledge(owner_id, created_at) WHERE source_url <> '';
ALTER TABLE ultron_skill_modules
 ADD COLUMN IF NOT EXISTS content_excerpt TEXT NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ,
 ADD COLUMN IF NOT EXISTS last_error TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ultron_skills_pending
 ON ultron_skill_modules(owner_id, status, created_at);