import { api } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

async function probe(fn) {
  try { await fn(); return { connected: true }; }
  catch (e) {
    if (e?.code === 'SetupRequired' || /not connected|setup_required/i.test(String(e?.message || ''))) return { connected: false, state: 'not_connected' };
    return { connected: false, state: 'needs_attention', message: String(e?.message || 'Connection check failed.').slice(0,180) };
  }
}

export default async function (req, res) {
  const [calendar, gmail, gmailCompose] = await Promise.all([
    probe(() => api.google_calendar.get('/calendar/v3/users/me/calendarList', { query: { maxResults: 1 } })),
    probe(() => api.gmail_read.get('/gmail/v1/users/me/profile')),
    probe(() => api.gmail_compose.get('/gmail/v1/users/me/drafts', { query: { maxResults: 1 } }))
  ]);
  return res.json({ calendar, gmail, gmail_compose: gmailCompose });
}