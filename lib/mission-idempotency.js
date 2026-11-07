// Immutable identity checks for replaying mission-owned writes.
// Mutable lifecycle fields (for example task status or a measured skill outcome)
// are intentionally excluded so a retry never rolls back later owner changes.
export function matchesTaskReplay(existing, expected) {
  return !!existing && existing.kind === 'task' && existing.title === expected.title && existing.body === expected.body;
}

export function matchesKnowledgeReplay(existing, expected) {
  return !!existing && existing.topic === expected.topic && existing.summary === expected.summary &&
    existing.source_url === expected.sourceUrl && existing.source_name === expected.sourceName;
}

export function matchesSkillApplicationReplay(existing, expected) {
  return !!existing && String(existing.skill_id) === String(expected.skillId) &&
    String(existing.run_id) === String(expected.runId) && existing.task_description === expected.task &&
    existing.metric_label === expected.metric && existing.metric_direction === expected.direction &&
    Number(existing.baseline_value) === expected.baseline && existing.baseline_evidence === expected.baselineEvidence;
}