import { searchPublicWeb } from 'lib/search.js';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const q = String(req.query?.q || '').trim();
  const country = String(req.query?.country || 'US').toUpperCase();
  if (!q || q.length > 240) return res.status(400).json({ error: 'Enter a research question up to 240 characters.' });
  try {
    const result = await searchPublicWeb(q, country);
    return res.json({ query: q, ...result });
  } catch (error) {
    console.error('ULTRON research failed', String(error?.message || error).slice(0, 160));
    return res.status(502).json({ error: 'Public research is temporarily unavailable. No paid search provider was used.' });
  }
}