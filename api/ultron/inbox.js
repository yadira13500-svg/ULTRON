import { api } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  try {
    const list = await api.gmail_read.get('/gmail/v1/users/me/messages', { query: { maxResults: 10, q: 'newer_than:14d' } });
    const ids = (list.body?.messages || []).slice(0, 8);
    const messages = await Promise.all(ids.map(async item => {
      const r = await api.gmail_read.get('/gmail/v1/users/me/messages/' + encodeURIComponent(item.id), { query: { format: 'metadata', metadataHeaders: ['Subject','From','Date'] } });
      const headers = r.body?.payload?.headers || [];
      const get = name => headers.find(h => String(h.name).toLowerCase() === name.toLowerCase())?.value || '';
      return { id: item.id, threadId: item.threadId, subject: get('Subject') || '(No subject)', from: get('From'), date: get('Date'), snippet: r.body?.snippet || '' };
    }));
    return res.json({ messages });
  } catch (e) {
    if (e?.code === 'SetupRequired') return res.status(412).json({ error: 'Connect Gmail read access in the Hatchable project Setup page.' });
    return res.status(502).json({ error: 'Could not read Gmail: ' + String(e?.message || e).slice(0,180) });
  }
}