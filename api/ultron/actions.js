import { api, db } from 'hatchable';
import { Buffer } from 'node:buffer';

export const access = 'admin';
export const methods = ['GET', 'PUT'];

export default async function (req, res) {
  const owner = String(req.member.id);
  if (req.method === 'GET') {
    const { rows } = await db.query("SELECT id, action_type, title, payload, status, result, created_at FROM ultron_actions WHERE owner_id = $1 AND status IN ('pending','failed') ORDER BY created_at DESC LIMIT 50", [owner]);
    return res.json({ actions: rows });
  }
  const { id, decision } = req.body || {};
  if (!id || !['approve','reject'].includes(decision)) return res.status(400).json({ error: 'An action id and approve/reject decision are required.' });
  const found = await db.query("UPDATE ultron_actions SET status = 'processing', updated_at = now() WHERE id = $1 AND owner_id = $2 AND status = 'pending' RETURNING id, action_type, title, payload", [id, owner]);
  if (!found.rows.length) return res.status(409).json({ error: 'This request is no longer pending.' });
  const action = found.rows[0];
  if (decision === 'reject') {
    await db.query("UPDATE ultron_actions SET status = 'rejected', result = 'Rejected by owner', updated_at = now() WHERE id = $1 AND owner_id = $2", [id, owner]);
    return res.json({ ok: true, status: 'rejected' });
  }
  try {
    let result;
    if (action.action_type === 'calendar_event') {
      const p = action.payload;
      const r = await api.google_calendar.post('/calendar/v3/calendars/primary/events', { body: { summary: p.title, description: p.description || '', start: { dateTime: p.start, timeZone: p.timezone }, end: { dateTime: p.end, timeZone: p.timezone } } });
      result = { id: r.body?.id, htmlLink: r.body?.htmlLink, status: r.status };
    } else if (action.action_type === 'email_draft') {
      const p = action.payload;
      const raw = 'To: ' + p.to + '\r\nSubject: ' + p.subject.replace(/[\r\n]/g, ' ') + '\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n' + p.body;
      const encoded = Buffer.from(raw, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
      const r = await api.gmail_compose.post('/gmail/v1/users/me/drafts', { body: { message: { raw: encoded } } });
      result = { id: r.body?.id, message: 'Draft created in Gmail. It was not sent.' };
    } else {
      throw new Error('Unsupported action type.');
    }
    await db.query("UPDATE ultron_actions SET status = 'approved', result = $3, updated_at = now() WHERE id = $1 AND owner_id = $2", [id, owner, JSON.stringify(result)]);
    return res.json({ ok: true, status: 'approved', result });
  } catch (e) {
    await db.query("UPDATE ultron_actions SET status = 'pending', result = $3, updated_at = now() WHERE id = $1 AND owner_id = $2", [id, owner, String(e?.message || e).slice(0,500)]);
    if (e?.code === 'SetupRequired' || /not connected|setup_required/i.test(String(e?.message || ''))) return res.status(412).json({ error: 'Connect the required Google service in the Hatchable project Setup page, then approve this request again.' });
    return res.status(502).json({ error: 'The approved action could not be completed: ' + String(e?.message || e).slice(0,220) });
  }
}