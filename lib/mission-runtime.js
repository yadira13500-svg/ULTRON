export const MAX_SPECIALIST_CONCURRENCY = 3;

export function specialistRoleForStep(type) {
  if (['research_search','retrieve_source','verify_url'].includes(type)) return 'researcher';
  if (type === 'assess_claim') return 'analyst';
  if (['save_learning','create_task','skill_apply'].includes(type)) return 'executor';
  return 'coordinator';
}

export function specialistCapabilitiesForRole(role) {
  const map={
    coordinator:['mission_decomposition','dependency_management','budget_enforcement'],
    researcher:['public_web_search','public_https_source_capture','source_provenance'],
    analyst:['evidence_comparison','contradiction_screening','calculations'],
    executor:['owner_scoped_task_write','owner_scoped_knowledge_write','skill_application_write'],
    verifier:['independent_readback','acceptance_checking','defect_challenge']
  };
  return map[role]||[];
}

export function dependenciesSatisfied(dependsOn, prerequisiteRows) {
  const deps = Array.isArray(dependsOn) ? dependsOn : [];
  const rows = Array.isArray(prerequisiteRows) ? prerequisiteRows : [];
  return rows.length === deps.length && rows.every(row => row.status === 'completed' && deps.includes(row.position));
}

export function classifyStepFailure(message, attempt) {
  const text = String(message || '');
  const transient = /\\b(408|425|429|500|502|503|504)\\b|timeout|temporarily unavailable|network|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(text);
  return { transient, retry: transient && Number(attempt || 1) < 3, terminal: !transient || Number(attempt || 1) >= 3 };
}

export async function runParallel(items, worker, limit = MAX_SPECIALIST_CONCURRENCY) {
  const input = Array.isArray(items) ? items : [];
  const results = new Array(input.length);
  let cursor = 0;
  const count = Math.max(1, Math.min(input.length || 1, Number.isInteger(limit) ? limit : MAX_SPECIALIST_CONCURRENCY));
  await Promise.all(Array.from({length:count}, async () => {
    while (true) {
      const index = cursor++;
      if (index >= input.length) return;
      results[index] = await worker(input[index], index);
    }
  }));
  return results;
}