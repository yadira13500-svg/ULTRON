import { config } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function(req, res) {
  const key = await config.get('NVIDIA_API_KEY');
  if (!key) return res.status(412).json({
    ok: false,
    provider: 'nvidia',
    state: 'not_configured',
    error: 'The existing NVIDIA_API_KEY is not configured.'
  });

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' }
    });
    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch {}
    if (!response.ok) {
      const state = response.status === 401 || response.status === 403 ? 'invalid_or_unauthorized' :
        response.status === 429 ? 'rate_limited' : 'provider_error';
      return res.status(502).json({
        ok: false, provider: 'nvidia', state, upstream_status: response.status,
        error: String(payload?.detail || payload?.message || raw || 'NVIDIA model catalog request failed').slice(0, 300)
      });
    }
    const models = (payload?.data || []).filter(x => x && typeof x.id === 'string').map(x => ({
      id: x.id,
      object: x.object || 'model',
      owned_by: x.owned_by || null
    }));
    return res.json({
      ok: true,
      provider: 'nvidia',
      state: 'connected_catalog_verified',
      base_url: 'https://integrate.api.nvidia.com/v1',
      models_endpoint: 'GET /v1/models',
      chat_endpoint: 'POST /v1/chat/completions',
      model_count: models.length,
      models,
      billing_note: 'Catalog visibility does not establish free access, trial eligibility, or remaining credits. Check NVIDIA account terms before using metered inference.',
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    return res.status(502).json({
      ok: false, provider: 'nvidia', state: 'network_error',
      error: String(error?.message || error).slice(0, 240)
    });
  }
}