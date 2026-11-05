CREATE TABLE IF NOT EXISTS ultron_preferences (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id TEXT NOT NULL, category TEXT NOT NULL,
 preference TEXT NOT NULL, confidence NUMERIC NOT NULL DEFAULT 0.5, source TEXT NOT NULL DEFAULT 'user',
 confirmed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ultron_preferences_owner ON ultron_preferences(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS ultron_graph_nodes (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id TEXT NOT NULL, label TEXT NOT NULL,
 node_type TEXT NOT NULL DEFAULT 'topic', description TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(owner_id,label,node_type)
);
CREATE TABLE IF NOT EXISTS ultron_graph_edges (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id TEXT NOT NULL, from_id UUID NOT NULL,
 to_id UUID NOT NULL, relation TEXT NOT NULL, evidence TEXT NOT NULL DEFAULT '',
 source_url TEXT NOT NULL DEFAULT '', confidence NUMERIC NOT NULL DEFAULT 0.5,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(owner_id,from_id,to_id,relation)
);
CREATE TABLE IF NOT EXISTS ultron_research_plans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id TEXT NOT NULL, topic TEXT NOT NULL,
 frequency TEXT NOT NULL DEFAULT 'weekly', boundary TEXT NOT NULL DEFAULT '',
 enabled BOOLEAN NOT NULL DEFAULT false, last_run_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ultron_research_plans_due ON ultron_research_plans(enabled,frequency,owner_id);
CREATE TABLE IF NOT EXISTS ultron_feedback (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id TEXT NOT NULL, question TEXT NOT NULL,
 response_excerpt TEXT NOT NULL DEFAULT '', rating TEXT NOT NULL, correction TEXT NOT NULL DEFAULT '',
 proposed_improvement TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'proposed',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ultron_skill_modules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), owner_id TEXT NOT NULL, domain TEXT NOT NULL,
 title TEXT NOT NULL, objective TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL DEFAULT '',
 source_name TEXT NOT NULL DEFAULT '', lesson TEXT NOT NULL DEFAULT '', test_json JSONB NOT NULL DEFAULT '[]'::jsonb,
 status TEXT NOT NULL DEFAULT 'draft', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);