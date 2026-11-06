CREATE TABLE IF NOT EXISTS ultron_graph_suggestions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id TEXT NOT NULL,
 from_id UUID NOT NULL REFERENCES ultron_graph_nodes(id) ON DELETE CASCADE,
 to_id UUID NOT NULL REFERENCES ultron_graph_nodes(id) ON DELETE CASCADE,
 relation TEXT NOT NULL,
 rationale TEXT NOT NULL DEFAULT '',
 evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
 source_quality NUMERIC NOT NULL DEFAULT 0,
 evidence_strength NUMERIC NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'pending',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_at TIMESTAMPTZ,
 UNIQUE(owner_id,from_id,to_id,relation)
);
CREATE INDEX IF NOT EXISTS ultron_graph_suggestions_review
 ON ultron_graph_suggestions(owner_id,status,created_at DESC);