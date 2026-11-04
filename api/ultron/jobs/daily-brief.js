import { ai, api, db } from 'hatchable';

export const access = 'scheduler';
export const methods = ['POST'];

export default async function (req, res) {
  const owners = (await db.query('SELECT owner_id, ai_enabled, daily_ai_brief, daily_brief_hour, timezone FROM ultron_settings WHERE daily_brief_enabled = true')).rows;
  let created = 0, skipped = 0;
  for (const s of owners) {
    let parts;
    try {
      parts = new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    } catch { skipped++; continue; }
    const val = k => parts.find(p => p.type === k)?.value;
    const hour = Number(val('hour'));
    const date = val('year') + '-' + val('month') + '-' + val('day');
    if (hour !== Number(s.daily_brief_hour)) { skipped++; continue; }
    const exists = await db.query('SELECT id FROM ultron_briefs WHERE owner_id = $1 AND brief_date = $2::date', [s.owner_id, date]);
    if (exists.rows.length) { skipped++; continue; }
    const tasks = (await db.query("SELECT kind, title, due_at FROM ultron_items WHERE owner_id = $1 AND status = 'open' AND kind IN ('task','reminder','goal') ORDER BY due_at NULLS LAST, created_at ASC LIMIT 20", [s.owner_id])).rows;
    const routines = (await db.query("SELECT content FROM ultron_memories WHERE owner_id = $1 AND category = 'routine' ORDER BY updated_at DESC LIMIT 10", [s.owner_id])).rows.map(x => x.content);
    let events = [];
    try {
      const now = new Date(), end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const cal = await api.google_calendar.get('/calendar/v3/calendars/primary/events', { query: { timeMin: now.toISOString(), timeMax: end.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 15 } });
      events = (cal.body?.items || []).map(e => ({ title: e.summary || 'Untitled event', start: e.start?.dateTime || e.start?.date || '' }));
    } catch {}
    let content = 'Good morning. Your ULTRON daily brief for ' + date + '.\n\n' + (events.length ? 'Calendar:\n' + events.map(e => e.start + ' — ' + e.title).join('\n') : 'No connected calendar events were available.') + '\n\n' + (tasks.length ? 'Open priorities:\n' + tasks.map((t,i) => (i+1) + '. ' + t.title + (t.due_at ? ' (due ' + t.due_at + ')' : '')).join('\n') : 'Your task list is clear. Choose one meaningful outcome for today.') + (routines.length ? '\n\nPersonal routines:\n' + routines.map(x => '• ' + x).join('\n') : '') + '\n\nStart with the most important item, protect a focus block, and leave room for breaks.';
    if (s.ai_enabled && s.daily_ai_brief) {
      try {
        const r = await ai.generateText({ model: 'gpt-mini', purpose: 'ultron-scheduled-brief', userId: s.owner_id, system: 'Prepare a concise daily plan from the supplied saved tasks and calendar events. Do not invent deadlines or events. Prioritize fixed commitments and encourage realistic pacing.', prompt: JSON.stringify({ tasks, events, routines }), maxTokens: 800 });
        if (r.text) content = r.text;
      } catch (e) {
        content += '\n\nAI enhancement was unavailable; this is the basic task-and-calendar brief.';
      }
    }
    const r = await db.query('INSERT INTO ultron_briefs (owner_id, brief_date, content) VALUES ($1, $2::date, $3) ON CONFLICT (owner_id, brief_date) DO NOTHING', [s.owner_id, date, content]);
    if (r.rowCount) created++; else skipped++;
  }
  return res.json({ created, skipped, owners_checked: owners.length });
}