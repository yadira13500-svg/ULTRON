CREATE TABLE IF NOT EXISTS ultron_settings (
  owner_id TEXT PRIMARY KEY,
  ai_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  memory_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  daily_brief_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  daily_ai_brief BOOLEAN NOT NULL DEFAULT FALSE,
  daily_brief_hour INTEGER NOT NULL DEFAULT 8 CHECK (daily_brief_hour BETWEEN 0 AND 23),
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ultron_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  conversation_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ultron_messages_thread ON ultron_messages(owner_id, conversation_id, created_at DESC);
CREATE TABLE IF NOT EXISTS ultron_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  content TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ultron_memories_owner ON ultron_memories(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS ultron_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('calendar_event','email_draft')),
  title TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','approved','rejected','failed')),
  result TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ultron_actions_owner ON ultron_actions(owner_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS ultron_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  brief_date DATE NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(owner_id, brief_date)
);
CREATE INDEX IF NOT EXISTS ultron_briefs_owner_date ON ultron_briefs(owner_id, brief_date DESC);