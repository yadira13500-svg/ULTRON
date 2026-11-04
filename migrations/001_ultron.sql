CREATE TABLE IF NOT EXISTS ultron_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('task','goal','journal','lesson','reminder')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','archived')),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ultron_items_owner_created ON ultron_items(owner_id, created_at DESC);