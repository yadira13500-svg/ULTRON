import { config } from 'hatchable';
import { buildSpecialistReasoningMessages } from 'lib/specialist-context.js';

const ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const truthy = value => value === true || String(value || '').trim().toLowerCase() === 'true';

export async function runSpecialistReasoningSession(role, task, evidence = {}, options = {}) {
  const enabled = truthy(await config.get('ULTRON_SPECIALIST_INFERENCE_ENABLED'));
  if (!enabled) return { status: 'disabled', attempted: false, reason: 'Specialist inference is disabled; no provider request was made.' };
  const key = await config.get('NVIDIA_API_KEY');
  const model = String(await config.get('ULTRON_SPECIALIST_MODEL') || '').trim();
  if (!key) return { status: 'blocked', attempted: false, reason: 'NVIDIA_API_KEY is not configured.' };
  if (!model) return { status: 'blocked', attempted: false, reason: 'Set ULTRON_SPECIALIST_MODEL explicitly after confirming its billing terms.' };

  const messages = buildSpecialistReasoningMessages(role, task, evidence);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const started = Date.now();
  try {
    const response = await (options.fetchImpl || fetch)(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1400, stream: false })
    });
    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    if (!response.ok) return { status: 'provider_error', attempted: true, provider: 'nvidia', model, httpStatus: response.status, latencyMs: Date.now() - started, reason: String(payload?.detail || payload?.error?.message || payload?.message || 'Provider request failed').slice(0, 300) };
    const content = String(payload?.choices?.[0]?.message?.content || '').trim();
    if (!content) return { status: 'invalid_response', attempted: true, provider: 'nvidia', model, latencyMs: Date.now() - started, reason: 'The model returned no assistant content.' };
    let parsed = null;
    try { parsed = JSON.parse(content.replace(/^\u0060\u0060\u0060(?:json)?\s*/i, '').replace(/\s*\u0060\u0060\u0060$/, '')); } catch {}
    return { status: 'completed', attempted: true, provider: 'nvidia', model, latencyMs: Date.now() - started, output: parsed || { raw: content.slice(0, 10000) }, usage: payload?.usage || null, finishReason: payload?.choices?.[0]?.finish_reason || null };
  } catch (error) {
    return { status: 'request_error', attempted: true, provider: 'nvidia', model, latencyMs: Date.now() - started, reason: String(error?.message || error).slice(0, 240) };
  } finally {
    clearTimeout(timer);
  }
}

const BENCHMARK_CASES = [
  { id: 'known-answer-arithmetic', role: 'analyst', task: 'Evaluate the claim: 17 × 19 = 323.', expected: { answer: '323', arithmeticCorrect: true }, evidence: { calculation: '17 * 19' } },
  { id: 'known-answer-source-limits', role: 'verifier', task: 'A source title says a treatment works, but no article text or study is available. Can this establish efficacy?', expected: { conclusion: 'insufficient_evidence', factualTruthCertified: false }, evidence: { source: { title: 'Treatment works', excerpt: null } } },
  { id: 'known-answer-contradiction', role: 'analyst', task: 'Two supplied reports give different totals: 12 and 15. Are they consistent?', expected: { contradictionDetected: true, unresolved: true }, evidence: { reports: [{ value: 12 }, { value: 15 }] } }
];

export function specialistBenchmarkCases() {
  return BENCHMARK_CASES.map(item => JSON.parse(JSON.stringify(item)));
}

export function scoreSpecialistBenchmark(caseId, output) {
  const item = BENCHMARK_CASES.find(x => x.id === caseId);
  if (!item || !output || typeof output !== 'object') return { caseId, passed: false, reason: 'Unknown case or invalid model output.' };
  const checks = Object.entries(item.expected).map(([key, expected]) => ({ key, expected, actual: output[key], passed: output[key] === expected }));
  return { caseId, passed: checks.every(x => x.passed), checks, scoredFields: checks.length, note: 'Exact rubric scoring only; this small fixture set is not a broad intelligence benchmark.' };
}