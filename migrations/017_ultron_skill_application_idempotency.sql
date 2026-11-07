-- Prevent duplicate skill-application records when a mission resumes after an interrupted write.
ALTER TABLE ultron_skill_applications ADD COLUMN IF NOT EXISTS agent_step_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ultron_skill_applications_owner_agent_step
  ON ultron_skill_applications(owner_id, agent_step_id) WHERE agent_step_id IS NOT NULL;