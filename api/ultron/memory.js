import { db } from 'hatchable';

export const access = 'admin';
export const methods = ['GET', 'POST', 'DELETE'];

export default async function (req, res) {
  const owner = String(req.member.id);
  if (req.method === 'GET') {
    const { rows } = await db.query('SELECT id, category, content, source, created_at, updated_at FROM ultron_memories WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 200', [owner]);
    return res.json({ memories: rows });
  }
  if (req.method === 'POST') {
    const { category = 'general', content } = req.body || {};
    if (typeof content !== 'string' || !content.trim() || content.length > 3000) return res.status(400).json({ error: 'Memory must contain 1–3000 characters.' });
    const { rows } = await db.query('INSERT INTO ultron_memories (owner_id, category, content, source) VALUES ($1, $2, $3, $4) RETURNING id, category, content, source, created_at', [owner, String(category).slice(0,40), content.trim(), 'user']);
    return res.status(201).json({ memory: rows[0] });
  }
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'A memory id is required.' });
  const { rowCount } = await db.query('DELETE FROM ultron_memories WHERE id = $1 AND owner_id = $2', [id, owner]);
  return res.json({ ok: rowCount > 0 });
}