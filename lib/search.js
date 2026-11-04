import { browser } from 'hatchable';
import { googleNewsSearch } from 'lib/rss.js';

export async function searchPublicWeb(query, country = 'US') {
  const q = String(query || '').trim().slice(0, 240);
  if (!q) return { results: [], source: 'public web search' };
  try {
    const results = await browser.session(async page => {
      const providers = [
        'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
        'https://www.google.com/search?q=' + encodeURIComponent(q)
      ];
      for (const target of providers) {
        try {
          await page.goto(target, { waitUntil: 'domcontentloaded' });
          const found = await page.evaluate(() => Array.from(document.querySelectorAll('a')).map(a => {
            const h = a.querySelector('h3');
            const ddg = a.classList.contains('result__a');
            const url = a.href || '';
            const block = a.parentElement?.parentElement;
            return { title: (h?.textContent || (ddg ? a.textContent : '') || '').trim(), url, snippet: (block?.innerText || '').slice(0, 700) };
          }).filter(x => x.title && /^https?:\/\//i.test(x.url) && !/(duckduckgo|google)\.(com|[a-z.]+)\//i.test(x.url)).slice(0, 8));
          if (found?.length) return found;
        } catch {}
      }
      return [];
    });
    if (results?.length) return { results, source: 'Public web search', fetched_at: new Date().toISOString() };
  } catch (error) {
    console.error('Public web search fallback', String(error?.message || error).slice(0, 160));
  }
  const news = await googleNewsSearch(q, country, 8);
  return { ...news, source: 'Google News RSS', note: 'The public web search did not return results, so ULTRON used the free news index instead.' };
}