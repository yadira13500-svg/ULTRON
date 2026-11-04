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
  try {
    const ddgUrl = 'https://api.duckduckgo.com/?q=' + encodeURIComponent(q) + '&format=json&no_html=1&skip_disambig=1';
    const ddgResponse = await fetch(ddgUrl, { timeout_ms: 8000, headers: { 'Accept': 'application/json' } });
    if (ddgResponse.ok) {
      const data = await ddgResponse.json();
      const topics = (data.RelatedTopics || []).flatMap(x => x.Topics || [x]).filter(x => x.FirstURL && x.Text);
      const results = [];
      if (data.AbstractURL && data.AbstractText) results.push({ title: data.Heading || q, url: data.AbstractURL, snippet: data.AbstractText });
      for (const x of topics) results.push({ title: String(x.Text).split(' - ')[0].slice(0, 180), url: x.FirstURL, snippet: x.Text.slice(0, 700) });
      if (results.length) return { results: results.slice(0, 8), source: 'DuckDuckGo Instant Answers', fetched_at: new Date().toISOString() };
    }
  } catch {}
  try {
    const wikiUrl = 'https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=' + encodeURIComponent(q) + '&format=json&utf8=1&srlimit=8';
    const wikiResponse = await fetch(wikiUrl, { timeout_ms: 8000, headers: { 'Accept': 'application/json', 'User-Agent': 'ULTRONPersonalAssistant/1.0' } });
    if (wikiResponse.ok) {
      const data = await wikiResponse.json();
      const results = (data.query?.search || []).map(x => ({ title: x.title, url: 'https://en.wikipedia.org/?curid=' + x.pageid, snippet: String(x.snippet || '').replace(/<[^>]*>/g, '') }));
      if (results.length) return { results, source: 'Wikipedia search', fetched_at: new Date().toISOString(), note: 'These are encyclopedia references, not a complete web-wide search.' };
    }
  } catch {}
  const news = await googleNewsSearch(q, country, 8);
  return { ...news, source: 'Google News RSS', note: 'The public web search did not return results, so ULTRON used the free news index instead.' };
}