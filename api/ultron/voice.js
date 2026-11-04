import { ai, db, config } from 'hatchable';

export const access = 'admin';
export const methods = ['GET', 'POST'];

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PROMPT = 'ULTRON, hey Ultron, remind me to, add a task, prepare my day, research, read my tasks, read the news.';

function bytesToBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (i + 1 === bytes.length) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (i + 2 === bytes.length) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function responseBytes(r) {
  if (typeof r.arrayBuffer === 'function') return new Uint8Array(await r.arrayBuffer());
  if (typeof r.bytes === 'function') return new Uint8Array(await r.bytes());
  if (r.buffer) return new Uint8Array(r.buffer);
  throw new Error('Provider audio response could not be read.');
}

function classify(e) {
  const msg = String(e?.message || e || '');
  if (e?.error_code === 'ai_spend_limit_reached' || /spend.limit/i.test(msg)) {
    return { status: 429, code: 'ai_spend_limit_reached', error: 'The project AI spend limit has been reached for today.' };
  }
  if (/412|setup_required|No openai key|not configured|fixed request schema|not allowed on our key|insufficient_quota|no credits|incorrect api key|invalid_api_key|\b401\b|\b402\b|\b429\b/i.test(msg)) {
    return { status: 412, code: 'ai_setup_required', error: 'The voice key has no credits or is invalid, so ULTRON is using free device voice instead. For free hearing, add GROQ_API_KEY in Hatchable Setup.' };
  }
  return { status: 502, code: 'voice_provider_error', error: 'Voice provider error: ' + msg.slice(0, 200) };
}

async function getSettings(owner) {
  await db.query('INSERT INTO ultron_settings (owner_id) VALUES ($1) ON CONFLICT (owner_id) DO NOTHING', [owner]);
  return (await db.query('SELECT ai_enabled FROM ultron_settings WHERE owner_id = $1', [owner])).rows[0];
}

async function keys() {
  const groq = await config.get('GROQ_API_KEY');
  const openai = (await config.get('USE_OPENAI_VOICE')) === 'true' ? await config.get('OPENAI_API_KEY') : null;
  return { groq: groq || null, openai: openai || null };
}

async function transcribeDirect(provider, key, audioB64, mime, ext) {
  const fd = new FormData();
  fd.append('file', new Blob([base64ToBytes(audioB64)], { type: mime.split(';')[0] }), 'speech.' + ext);
  fd.append('model', provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1');
  fd.append('language', 'en');
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  fd.append('prompt', PROMPT);
  const url = provider === 'groq' ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
  const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd });
  if (!r.ok) throw new Error(provider + ' transcription ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const data = await r.json();
  return String(data.text || '').trim();
}

export default async function (req, res) {
  const owner = String(req.member.id);
  const settings = await getSettings(owner);
  const k = await keys();

  if (req.method === 'GET') {
    if (!settings.ai_enabled) return res.json({ stt: false, tts: false, reason: 'ai_disabled' });
    if (k.groq || k.openai) {
      return res.json({ stt: true, tts: !!k.openai, reason: 'ok', stt_provider: k.groq ? 'groq' : 'openai' });
    }
    try {
      return res.json({ stt: false, tts: false, reason: 'free_mode' });
      const r = await ai.fetch({ provider: 'openai', path: '/v1/models', method: 'GET', purpose: 'ultron-voice-check' });
      if (r && r.ok) return res.json({ stt: true, tts: true, reason: 'ok', stt_provider: 'platform' });
      return res.json({ stt: false, tts: false, reason: 'ai_setup_required' });
    } catch (e) {
      const c = classify(e);
      return res.json({ stt: false, tts: false, reason: c.code });
    }
  }

  if (!settings.ai_enabled) {
    return res.status(423).json({ error: 'Enable the AI brain in ULTRON controls to use premium voice.', code: 'ai_disabled' });
  }

  const body = req.body || {};

  if (body.action === 'transcribe') {
    const audioB64 = typeof body.audioB64 === 'string' ? body.audioB64 : '';
    if (!audioB64 || audioB64.length > 9_000_000) return res.status(400).json({ error: 'Audio missing or too large.' });
    const mime = String(body.mimeType || 'audio/webm').toLowerCase();
    const ext = /mp4|m4a|aac/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : /mpeg|mp3/.test(mime) ? 'mp3' : 'webm';
    try {
      if (k.groq || k.openai) {
        let text = null, lastE = null;
        for (const [p, key] of [['groq', k.groq], ['openai', k.openai]]) {
          if (!key) continue;
          try { text = await transcribeDirect(p, key, audioB64, mime, ext); break; } catch (e) { lastE = e; }
        }
        if (text === null) throw lastE;
        return res.json({ text });
      }
      const r = await ai.fetch({
        provider: 'openai',
        path: '/v1/audio/transcriptions',
        fields: { model: 'whisper-1', response_format: 'json', language: 'en', temperature: '0', prompt: PROMPT },
        files: [{ name: 'file', filename: 'speech.' + ext, contentType: mime.split(';')[0], data: audioB64 }],
        purpose: 'ultron-transcribe',
        timeoutMs: 60000
      });
      if (!r.ok) {
        const detail = typeof r.text === 'function' ? (await r.text()).slice(0, 200) : '';
        const c = classify(detail || ('status ' + r.status));
        return res.status(c.status).json({ error: c.error, code: c.code });
      }
      const data = await r.json();
      return res.json({ text: String(data.text || '').trim() });
    } catch (e) {
      const c = classify(e);
      return res.status(c.status).json({ error: c.error, code: c.code });
    }
  }

  if (body.action === 'speak') {
    const text = String(body.text || '').trim().slice(0, 1500);
    if (!text) return res.status(400).json({ error: 'Nothing to speak.' });
    try {
      const payload = { model: 'tts-1', voice: 'onyx', input: text, response_format: 'mp3', speed: 0.96 };
      let r;
      if (k.openai) {
        r = await fetch('https://api.openai.com/v1/audio/speech', { method: 'POST', headers: { Authorization: 'Bearer ' + k.openai, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      } else if (k.groq) {
        return res.status(412).json({ error: 'Premium spoken replies need an OpenAI key; the device voice is used instead.', code: 'ai_setup_required' });
      } else {
        r = await ai.fetch({ provider: 'openai', path: '/v1/audio/speech', body: payload, purpose: 'ultron-speak', timeoutMs: 60000 });
      }
      if (!r.ok) {
        const detail = typeof r.text === 'function' ? (await r.text()).slice(0, 200) : '';
        const c = classify(detail || ('status ' + r.status));
        return res.status(c.status).json({ error: c.error, code: c.code });
      }
      const bytes = await responseBytes(r);
      return res.json({ audioB64: bytesToBase64(bytes), mime: 'audio/mpeg' });
    } catch (e) {
      const c = classify(e);
      return res.status(c.status).json({ error: c.error, code: c.code });
    }
  }

  return res.status(400).json({ error: 'Unknown voice action.' });
}