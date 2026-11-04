import { db } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const owner = String(req.member.id);
  const id = String(req.query?.conversation_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'A valid conversation id is required.' });
  const { rows } = await db.query('SELECT role, content, created_at FROM ultron_messages WHERE owner_id = $1 AND conversation_id = $2 ORDER BY created_at ASC LIMIT 100', [owner, id]);
  return res.json({ messages: rows });
}