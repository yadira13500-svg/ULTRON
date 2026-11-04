import { api } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const now = new Date();
  const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  try {
    const r = await api.google_calendar.get('/calendar/v3/calendars/primary/events', { query: { timeMin: now.toISOString(), timeMax: end.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 30 } });
    const events = (r.body?.items || []).map(e => ({ id: e.id, title: e.summary || 'Untitled event', start: e.start?.dateTime || e.start?.date || '', end: e.end?.dateTime || e.end?.date || '', link: e.htmlLink || '' }));
    return res.json({ events });
  } catch (e) {
    if (e?.code === 'SetupRequired') return res.status(412).json({ error: 'Connect Google Calendar in the Hatchable project Setup page.' });
    return res.status(502).json({ error: 'Could not read Google Calendar: ' + String(e?.message || e).slice(0,180) });
  }
}