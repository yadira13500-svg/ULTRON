import { searchPublicWeb } from 'lib/search.js';
import { db } from 'hatchable';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const q = String(req.query?.q || '').trim();
  const country = String(req.query?.country || 'US').toUpperCase();
  if (!q || q.length > 240) return res.status(400).json({ error: 'Enter a research question up to 240 characters.' });
  try {
    const result = await searchPublicWeb(q, country);
    const owner = String(req.member.id);
    const entries = (result.results || []).filter(x => x && x.title && x.url).slice(0, 6);
    for (const item of entries) {
      const summary = String(item.snippet || item.description || item.title).replace(/<[^>]*>/g, '').slice(0, 1200);
      const url = String(item.url).slice(0, 1000);
      const source = String(item.source || (() => { try { return new URL(url).hostname; } catch { return 'Public source'; } })()).slice(0, 160);
      await db.query('INSERT INTO ultron_knowledge (owner_id, topic, summary, source_url, source_name, published_at) SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS (SELECT 1 FROM ultron_knowledge WHERE owner_id=$1 AND source_url=$4 AND topic=$2)', [owner, q.slice(0,240), summary, url, source, String(item.published_at || '').slice(0,120)]);
    }
    return res.json({ query: q, ...result, learning: { saved: entries.length, message: 'Research sources added to your private knowledge library.' } });
  } catch (error) {
    console.error('ULTRON research failed', String(error?.message || error).slice(0, 160));
    return res.status(502).json({ error: 'Public research is temporarily unavailable. No paid search provider was used.' });
  }
}