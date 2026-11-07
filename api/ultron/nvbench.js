import { config } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

const URL_ = 'https://integrate.api.nvidia.com/v1/chat/completions';
const PROMPTS = {
  ping: 'Reply with exactly: online',
  health: 'I am a 34 year old with a headache for three days and light bothers me. Answer like a brilliant doctor friend in under 150 words: likely causes, what to do now, and the exact red flags that mean go to an emergency room.',
  legal: 'My landlord in Kenya wants me out in 7 days without a court order. Answer like a sharp lawyer friend in under 170 words: is it legal, which Kenyan law applies, and the practical next steps.',
  eng: 'Design a simple, robust way to back up a small company file server over a slow 4 Mbps link. Answer like a principal engineer in under 150 words with concrete numbers and risks.'
};

async function once(key, model, prompt, max, ms, thinking) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const body = { model, messages: [{ role: 'system', content: 'You are ULTRON, a brilliant, concise assistant.' }, { role: 'user', content: prompt }], temperature: 0.5, max_tokens: max };
    if (thinking === false) body.chat_template_kwargs = { enable_thinking: false };
    const r = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const t = await r.text();
    let reply = null; try { const j = JSON.parse(t); reply = j.choices?.[0]?.message?.content || null; } catch {}
    return { model, status: r.status, ms: Date.now() - t0, ok: r.ok && !!(reply && reply.trim()), reply: reply ? reply.slice(0, 1200) : undefined, err: r.ok ? undefined : t.slice(0, 140) };
  } catch (e) {
    return { model, status: 0, ms: Date.now() - t0, ok: false, err: String(e.name === 'AbortError' ? 'timeout ' + ms + 'ms' : e.message || e).slice(0, 120) };
  } finally { clearTimeout(timer); }
}

export default async function (req, res) {
  const key = await config.get('NVIDIA_API_KEY');
  if (!key) return res.status(412).json({ error: 'no key' });
  const q = req.query || {};
  if (q.model) {
    const p = PROMPTS[q.p] || PROMPTS.ping;
    return res.json(await once(key, String(q.model), p, Number(q.max) || 600, 45000, q.think === '1' ? undefined : false));
  }
  const r = await fetch('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: 'Bearer ' + key } });
  const j = await r.json().catch(() => ({}));
  const ids = (j.data || []).map(m => m.id);
  const want = ids.filter(i => /nemotron|llama-4|llama-3\.[13]-(405|70)|kimi|gpt-oss|qwen3|mistral-(large|medium)|deepseek|glm|minimax|gemma-3|phi-4/i.test(i) && !/embed|rerank|vision|vl\b|guard|safety|reward|parse|retriev|clip|nano-.*-vl|translate|asr|tts|riva/i.test(i)).slice(0, 40);
  const out = await Promise.all(want.map(m => once(key, m, PROMPTS.ping, 40, 25000, false)));
  return res.json({ total_catalog: ids.length, tested: want.length, working: out.filter(o => o.ok).sort((a, b) => a.ms - b.ms).map(o => ({ model: o.model, ms: o.ms })), failed: out.filter(o => !o.ok).map(o => ({ model: o.model, status: o.status, err: o.err })) });
}