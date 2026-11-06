import { googleNewsSearch, NEWS_COUNTRIES } from 'lib/rss.js';

export const access = 'admin';
export const methods = ['GET'];

export default async function (req, res) {
  const country = String(req.query?.country || 'WORLD').toUpperCase();
  const category = String(req.query?.category || 'top').toLowerCase();
  if (!NEWS_COUNTRIES[country]) return res.status(400).json({ error: 'Unsupported country filter.' });
  const topics = {
    top: 'top news',
    world: 'world news',
    business: 'business economy',
    technology: 'technology science',
    politics: 'politics government',
    health: 'health medicine',
    sports: 'sports'
  };
  if (!topics[category]) return res.status(400).json({ error: 'Unsupported news category.' });
  try {
    const data = await googleNewsSearch(topics[category], country, 18);
    return res.json({ ...data, country_code: country, category, refresh_note: 'Headlines are supplied by Google News RSS. Publication times and availability depend on each publisher.' });
  } catch (error) {
    console.error('ULTRON news feed unavailable', String(error?.message || error).slice(0, 180));
    return res.status(502).json({ error: 'The free news feed is temporarily unavailable. Try refreshing in a moment.' });
  }
}