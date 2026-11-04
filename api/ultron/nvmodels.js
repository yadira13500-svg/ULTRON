import { config } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const key = await config.get('NVIDIA_API_KEY');
  if (!key) return res.json({ error: 'no key' });
  const tools = [{ type: 'function', function: { name: 'addTask', description: 'Add a task', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } }];
  const variants = [
    { label: 'plain600', extra: {}, max: 600 },
    { label: 'nothink', extra: { chat_template_kwargs: { enable_thinking: false } }, max: 600 }
  ];
  const out = [];
  for (const v of variants) {
    const t0 = Date.now();
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'nvidia/nemotron-3.5-lightning-30b-a3b', messages: [{ role: 'system', content: 'You are ULTRON. Reply in one short sentence.' }, { role: 'user', content: 'Hello Ultron, are you online?' }], tools, tool_choice: 'auto', temperature: 0.5, max_tokens: v.max, ...v.extra })
      });
      const t = await r.text();
      out.push({ label: v.label, status: r.status, ms: Date.now() - t0, raw: t.slice(0, 900) });
    } catch (e) { out.push({ label: v.label, error: String(e.message || e).slice(0, 150) }); }
  }
  return res.json({ out });
}