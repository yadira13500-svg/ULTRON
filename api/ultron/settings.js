import { db } from 'hatchable';

export const access = 'admin';
export const methods = ['GET', 'PUT'];

export default async function (req, res) {
  const owner = String(req.member.id);
  await db.query('INSERT INTO ultron_settings (owner_id) VALUES ($1) ON CONFLICT (owner_id) DO NOTHING', [owner]);
  if (req.method === 'GET') {
    const { rows } = await db.query('SELECT ai_enabled, memory_enabled, daily_brief_enabled, daily_ai_brief, daily_brief_hour, timezone FROM ultron_settings WHERE owner_id = $1', [owner]);
    return res.json({ settings: rows[0] });
  }
  const b = req.body || {};
  const sets = [];
  const values = [owner];
  const add = (column, value) => { values.push(value); sets.push(column + ' = $' + values.length); };
  if (typeof b.ai_enabled === 'boolean') add('ai_enabled', b.ai_enabled);
  if (typeof b.memory_enabled === 'boolean') add('memory_enabled', b.memory_enabled);
  if (typeof b.daily_brief_enabled === 'boolean') add('daily_brief_enabled', b.daily_brief_enabled);
  if (typeof b.daily_ai_brief === 'boolean') add('daily_ai_brief', b.daily_ai_brief);
  if (Number.isInteger(b.daily_brief_hour) && b.daily_brief_hour >= 0 && b.daily_brief_hour <= 23) add('daily_brief_hour', b.daily_brief_hour);
  if (typeof b.timezone === 'string' && b.timezone.length <= 80) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: b.timezone }); add('timezone', b.timezone); }
    catch { return res.status(400).json({ error: 'Invalid timezone.' }); }
  }
  if (!sets.length) return res.status(400).json({ error: 'No valid settings supplied.' });
  sets.push('updated_at = now()');
  const { rows } = await db.query('UPDATE ultron_settings SET ' + sets.join(', ') + ' WHERE owner_id = $1 RETURNING ai_enabled, memory_enabled, daily_brief_enabled, daily_ai_brief, daily_brief_hour, timezone', values);
  return res.json({ settings: rows[0] });
}