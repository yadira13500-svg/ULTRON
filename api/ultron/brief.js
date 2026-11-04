import { ai, api, db } from 'hatchable';

export const access = 'admin';
export const methods = ['GET', 'POST'];

function localParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = k => parts.find(p => p.type === k)?.value;
  return { date: get('year') + '-' + get('month') + '-' + get('day') };
}

export default async function (req, res) {
  const owner = String(req.member.id);
  await db.query('INSERT INTO ultron_settings (owner_id) VALUES ($1) ON CONFLICT (owner_id) DO NOTHING', [owner]);
  const settings = (await db.query('SELECT ai_enabled, memory_enabled, daily_brief_enabled, daily_ai_brief, daily_brief_hour, timezone FROM ultron_settings WHERE owner_id = $1', [owner])).rows[0];
  const date = localParts(new Date(), settings.timezone || 'UTC').date;
  if (req.method === 'GET') {
    const existing = await db.query('SELECT brief_date, content, created_at FROM ultron_briefs WHERE owner_id = $1 AND brief_date = $2::date', [owner, date]);
    if (existing.rows.length) return res.json({ brief: existing.rows[0], generated: false });
    return res.json({ brief: null, generated: false });
  }
  const tasks = (await db.query("SELECT kind, title, due_at FROM ultron_items WHERE owner_id = $1 AND status = 'open' AND kind IN ('task','reminder','goal') ORDER BY due_at NULLS LAST, created_at ASC LIMIT 30", [owner])).rows;
  const routines = settings.memory_enabled ? (await db.query("SELECT content FROM ultron_memories WHERE owner_id = $1 AND category = 'routine' ORDER BY updated_at DESC LIMIT 10", [owner])).rows.map(x => x.content) : [];
  let events = [], calendarConnected = true;
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const r = await api.google_calendar.get('/calendar/v3/calendars/primary/events', { query: { timeMin: now.toISOString(), timeMax: end.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 20 } });
    events = (r.body?.items || []).map(e => ({ title: e.summary || 'Untitled event', start: e.start?.dateTime || e.start?.date || '', end: e.end?.dateTime || e.end?.date || '' }));
  } catch { calendarConnected = false; }
  const context = 'Open tasks and goals: ' + JSON.stringify(tasks) + '\nSaved personal routines: ' + JSON.stringify(routines) + '\nCalendar events in the next 24 hours: ' + JSON.stringify(events);
  let content;
  if (settings.ai_enabled) {
    try {
      const r = await ai.generateText({ model: 'gpt-mini', purpose: 'ultron-daily-brief', userId: owner, system: 'You are ULTRON. Prepare a concise, realistic daily plan. Prioritize fixed calendar commitments, urgent deadlines, and a manageable number of tasks. Do not invent events or deadlines. Clearly note missing calendar access. Include: top priorities, suggested sequence, breaks, and one encouraging close.', prompt: context, maxTokens: 1000 });
      content = r.text;
    } catch (e) {
      if (e?.code === 'SetupRequired') return res.status(412).json({ error: 'Connect an AI provider in the project Setup page before generating an AI daily plan.' });
      content = null;
    }
  }
  if (!content) {
    const priority = tasks.filter(t => t.kind !== 'goal').slice(0, 5);
    content = 'TODAY\n' + (events.length ? 'Calendar: ' + events.map(e => e.start + ' — ' + e.title).join('; ') : (calendarConnected ? 'No calendar events found in the next 24 hours.' : 'Calendar is not connected yet.')) + '\n\nPRIORITIES\n' + (priority.length ? priority.map((t,i) => (i+1) + '. ' + t.title).join('\n') : 'Your task list is clear. Choose one meaningful outcome for today.') + (routines.length ? '\n\nPERSONAL ROUTINES\n' + routines.map(x => '• ' + x).join('\n') : '') + '\n\nKeep the plan realistic: handle fixed commitments first, then one important task at a time, with breaks between focus blocks.';
  }
  await db.query('INSERT INTO ultron_briefs (owner_id, brief_date, content) VALUES ($1, $2::date, $3) ON CONFLICT (owner_id, brief_date) DO UPDATE SET content = EXCLUDED.content, created_at = now()', [owner, date, content]);
  return res.json({ brief: { brief_date: date, content }, generated: true, calendar_connected: calendarConnected });
}