import { db } from 'hatchable';

export const access = 'member';
export const methods = ['GET', 'POST', 'PUT', 'DELETE'];

export default async function (req, res) {
  const owner = String(req.member.id);
  if (req.method === 'GET') {
    const kind = req.query?.kind;
    const params = [owner];
    let where = 'owner_id = $1';
    if (kind && ['task','goal','journal','lesson','reminder'].includes(kind)) {
      params.push(kind);
      where += ' AND kind = $2';
    }
    const { rows } = await db.query(`SELECT id, kind, title, body, status, due_at, created_at FROM ultron_items WHERE ${where} AND status <> 'archived' ORDER BY CASE WHEN status = 'open' THEN 0 ELSE 1 END, due_at NULLS LAST, created_at DESC LIMIT 250`, params);
    return res.json({ items: rows });
  }
  if (req.method === 'POST') {
    const { kind, title, body = '', due_at = null } = req.body || {};
    if (!['task','goal','journal','lesson','reminder'].includes(kind) || typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'A valid kind and title are required.' });
    const { rows } = await db.query('INSERT INTO ultron_items (owner_id, kind, title, body, due_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, kind, title, body, status, due_at, created_at', [owner, kind, title.trim().slice(0,180), String(body).slice(0,12000), due_at || null]);
    return res.status(201).json({ item: rows[0] });
  }
  if (req.method === 'PUT') {
    const { id, status } = req.body || {};
    if (!id || !['open','done','archived'].includes(status)) return res.status(400).json({ error: 'An item id and valid status are required.' });
    const { rows } = await db.query('UPDATE ultron_items SET status = $3, updated_at = now() WHERE id = $1 AND owner_id = $2 RETURNING id, kind, title, body, status, due_at, created_at', [id, owner, status]);
    if (!rows.length) return res.status(404).json({ error: 'Item not found.' });
    return res.json({ item: rows[0] });
  }
  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'An item id is required.' });
    const { rowCount } = await db.query("UPDATE ultron_items SET status = 'archived', updated_at = now() WHERE id = $1 AND owner_id = $2", [id, owner]);
    return res.json({ ok: rowCount > 0 });
  }
}