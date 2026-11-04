import { config } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const key = await config.get('NVIDIA_API_KEY');
  if (!key) return res.json({ error: 'no key' });
  const models = ['nvidia/nemotron-3-super-120b-a12b', 'nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-nano-3-30b-a3b', 'openai/gpt-oss-20b', 'moonshotai/kimi-k2.6', 'nvidia/llama-3.1-nemotron-70b-instruct'];
  const tools = [{ type: 'function', function: { name: 'addTask', description: 'Add a task', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } }];
  const out = [];
  for (const model of models) {
    const t0 = Date.now();
    try {
      const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: 'You are ULTRON. Reply in one short sentence.' }, { role: 'user', content: 'Hello Ultron, are you online?' }], tools, tool_choice: 'auto', temperature: 0.5, max_tokens: 200 })
      });
      const t = await r.text();
      let reply = null; try { const j = JSON.parse(t); reply = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; } catch {}
      out.push({ model, status: r.status, ms: Date.now() - t0, reply, raw: r.ok ? undefined : t.slice(0, 200) });
    } catch (e) { out.push({ model, error: String(e.message || e).slice(0, 150), ms: Date.now() - t0 }); }
  }
  return res.json({ out });
}