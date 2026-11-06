export const access = 'scheduler';
export const methods = ['POST'];

// Daily self-test of the free services ULTRON depends on. Failures show up as function errors in the logs.
const CHECKS = {
  weather: 'https://api.open-meteo.com/v1/forecast?latitude=-1.29&longitude=36.82&current=temperature_2m',
  wikipedia: 'https://en.wikipedia.org/api/rest_v1/page/summary/Nairobi',
  currency: 'https://open.er-api.com/v6/latest/USD',
  news: 'https://news.google.com/rss?hl=en-KE&gl=KE&ceid=KE:en',
  search: 'https://html.duckduckgo.com/html/?q=nairobi'
};

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'ULTRON-selftest/1.0' } });
    clearTimeout(timer);
    return { name, ok: r.ok, status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    return { name, ok: false, status: 0, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 120) };
  }
}

export default async function (req, res) {
  const results = [];
  for (const [name, url] of Object.entries(CHECKS)) results.push(await probe(name, url));
  const failed = results.filter(r => !r.ok);
  console.log('ULTRON self-test', JSON.stringify(results));
  if (failed.length) return res.status(500).json({ ok: false, failed, results });
  return res.json({ ok: true, results });
}