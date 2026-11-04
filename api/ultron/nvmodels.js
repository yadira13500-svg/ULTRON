import { config } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const key = await config.get('NVIDIA_API_KEY');
  if (!key) return res.json({ error: 'no key' });
  const r = await fetch('https://integrate.api.nvidia.com/v1/models', { headers: { Authorization: 'Bearer ' + key } });
  const t = await r.text();
  let ids = [];
  try { ids = (JSON.parse(t).data || []).map(m => m.id); } catch {}
  return res.json({ status: r.status, count: ids.length, ids: ids.filter(i => /nemotron|llama|kimi|qwen|gpt-oss|mistral|deepseek|glm|minimax/i.test(i)).slice(0, 120), raw: ids.length ? undefined : t.slice(0, 300) });
}