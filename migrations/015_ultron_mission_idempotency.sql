-- Make mission-owned side effects idempotent across retries and expired-lease recovery.
ALTER TABLE ultron_items ADD COLUMN IF NOT EXISTS agent_step_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ultron_items_owner_agent_step
  ON ultron_items(owner_id, agent_step_id) WHERE agent_step_id IS NOT NULL;

ALTER TABLE ultron_knowledge ADD COLUMN IF NOT EXISTS agent_step_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ultron_knowledge_owner_agent_step
  ON ultron_knowledge(owner_id, agent_step_id) WHERE agent_step_id IS NOT NULL;