import { config } from 'hatchable';
import { evaluateSentinelRequest } from 'lib/sentinel-safety.js';
import { buildSentinelAssessment } from 'lib/sentinel-assessment.js';

export const access = 'admin';
export const methods = ['POST'];

export default async function(req, res) {
  const body = req.body || {};
  if (body.consent !== true) return res.status(400).json({ error: 'Explicit per-image consent is required.' });
  const sourceMode = body.source_mode || 'user_upload';
  const sentinelPolicy = evaluateSentinelRequest({ sourceType: body.source_type || 'uploaded_image', sourceMode, operation: 'analyze_image', consent: body.consent === true, sourceAuthorization: sourceMode === 'user_upload' || body.source_authorization === true });
  if (!sentinelPolicy.allowed) return res.status(400).json({ error: sentinelPolicy.reason, policy_code: sentinelPolicy.code });
  const image = typeof body.image === 'string' ? body.image : '';
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 5500000) return res.status(400).json({ error: 'Provide one JPEG, PNG or WebP image under 4 MB.' });
  const key = await config.get('NVIDIA_API_KEY');
  if (!key) return res.status(412).json({ error: 'NVIDIA_API_KEY is not configured in this project.' });
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'meta/llama-3.2-90b-vision-instruct', messages: [{ role: 'system', content: 'You are ULTRON visual awareness. Describe only visible evidence, distinguish observation from inference, and state uncertainty. Do not identify people. Never claim a person or situation is dangerous from ambiguous evidence. If a credible immediate hazard is visible, calmly name the specific observable concern, ask whether the user feels safe and can move to safety, and advise calling 911 in the United States (or the local emergency number) if there is immediate danger. Do not promise threat detection. You cannot contact emergency services.' }, { role: 'user', content: [{ type: 'text', text: 'Describe the visible surroundings and any clearly observable safety concerns. Be calm, precise and avoid speculation.' }, { type: 'image_url', image_url: { url: image } }] }], temperature: 0.2, max_tokens: 700, stream: false }) });
    if (!response.ok) return res.status(502).json({ error: 'NVIDIA vision request failed (' + response.status + '). ' + (await response.text()).slice(0, 180) });
    const data = await response.json();
    const description = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!description) return res.status(502).json({ error: 'NVIDIA returned no visual description.' });
    const assessment = buildSentinelAssessment({ observation: description, sourceType: body.source_type || 'uploaded_image', sourceMode, sourceLabel: body.source_label || 'User-approved single image', capturedAt: body.captured_at || '' });
    return res.json({ reply: description, assessment, provider: 'NVIDIA Llama 3.2 90B Vision', review_required: true, device_control: false, identity_recognition: false, targeting: false, trial_notice: 'NVIDIA trial terms may permit recording of submitted inputs and outputs.' });
  } catch (error) { return res.status(502).json({ error: 'Vision provider unavailable: ' + String(error && error.message || error).slice(0, 180) }); }
}