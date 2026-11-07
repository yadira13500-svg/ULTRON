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
  let timer;
  try {
    const ctl = new AbortController();
    timer = setTimeout(() => ctl.abort(), 9000);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'ULTRON-selftest/1.0', 'Accept': 'application/json,application/rss+xml,application/xml,text/html' } });
    const contentType = String(r.headers.get('content-type') || '').toLowerCase();
    const body = await r.text();
    clearTimeout(timer);
    if (!r.ok) return { name, ok: false, status: r.status, ms: Date.now() - t0, contentType, error: 'HTTP request failed.' };
    let semantic = false, detail = '';
    try {
      if (name === 'weather') { const d=JSON.parse(body); semantic=Number.isFinite(d?.current?.temperature_2m); detail=semantic?'Current temperature field present.':'Missing current.temperature_2m.'; }
      else if (name === 'wikipedia') { const d=JSON.parse(body); semantic=typeof d?.title==='string'&&typeof d?.extract==='string'&&d.extract.length>20; detail=semantic?'Article title and readable extract present.':'Missing article title or readable extract.'; }
      else if (name === 'currency') { const d=JSON.parse(body); semantic=d?.result==='success'&&typeof d?.rates?.EUR==='number'&&typeof d?.time_last_update_unix==='number'; detail=semantic?'Successful exchange-rate payload with EUR rate and update timestamp.':'Exchange-rate payload is incomplete or unsuccessful.'; }
      else if (name === 'news') { semantic=/<item[\s>]/i.test(body)&&/<title[\s>]/i.test(body); detail=semantic?'RSS feed contains item and title elements.':'RSS feed has no recognizable item/title elements.'; }
      else if (name === 'search') { semantic=/class=["']result__a["']/i.test(body)&&body.length>1000; detail=semantic?'Search response contains result links.':'Search response contains no recognizable result links.'; }
    } catch { detail='Response could not be parsed or did not match the expected service schema.'; }
    return { name, ok: semantic, status: r.status, ms: Date.now() - t0, contentType, semantic, detail, bytes: body.length };
  } catch (e) {
    if (timer) clearTimeout(timer);
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