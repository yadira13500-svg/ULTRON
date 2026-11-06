import { browser } from 'hatchable';
import { googleNewsSearch, comparePublisherReports } from 'lib/rss.js';

async function investigatePublisherArticles(items = [], max = 6) {
  const targets=items.filter(x=>x&&x.url&&/^https:\/\//i.test(x.url)).slice(0,max);
  const investigated=[];
  for(const item of targets){
    try{
      let targetUrl=item.url;try{const redirect=await fetch(item.url,{redirect:'follow',timeout_ms:10000,headers:{'User-Agent':'Mozilla/5.0 ULTRON research'}});if(redirect.url&&/^https:\/\//i.test(redirect.url))targetUrl=redirect.url;}catch{}
      const article=await browser.session(async page=>{
        await page.goto(targetUrl,{waitUntil:'domcontentloaded',timeout:12000});
        const publisher=await page.evaluate(()=>Array.from(document.querySelectorAll('a[href]')).map(a=>a.href).find(h=>/^https:\/\//i.test(h)&&!/(news\.google\.com|accounts\.google\.com|support\.google\.com)/i.test(h))||'');
        if(publisher){try{await page.goto(publisher,{waitUntil:'domcontentloaded',timeout:10000})}catch{}}
        return await page.evaluate(()=>({
          final_url:location.href,
          title:document.querySelector('meta[property="og:title"]')?.content||document.title||'',
          description:document.querySelector('meta[name="description"]')?.content||document.querySelector('meta[property="og:description"]')?.content||'',
          text:(document.querySelector('article')?.innerText||document.querySelector('[itemprop="articleBody"]')?.innerText||document.querySelector('main')?.innerText||document.body?.innerText||'').slice(0,6500)
        }));
      });
      const body=String(article?.text||'').replace(/\s+/g,' ').trim();
      const finalUrl=String(article?.final_url||'');const directUrl=/^https:\/\//i.test(finalUrl)&&!/news\.google\.com/i.test(finalUrl)?finalUrl:item.url;investigated.push({...item,url:directUrl,article_url:directUrl,article_title:String(article?.title||item.title).slice(0,300),article_description:String(article?.description||'').slice(0,700),article_text:body.length>=300?body:'',investigation_status:body.length>=300?'article_text_extracted':'publisher_page_limited'});
    }catch{investigated.push({...item,investigation_status:'publisher_page_unavailable'});}
  }
  return investigated;
}
export async function searchPublicWeb(query, country = 'WORLD') {
  const q = String(query || '').trim().slice(0, 240);
  if (!q) return { results: [], source: 'public web search' };
  if (/(election|war|conflict|invasion|ceasefire|breaking|latest|current|news|president|prime minister|parliament|politic|government|minister|Ukraine|Russia|Iran|Israel|Gaza|Sudan|Taiwan|Kenya|US election)/i.test(q)) {
    try {
      let news;
      if(country==='WORLD'){
        const editions=['US','GB','IN','JP','BR','ZA','NG','KE','AU','DE'];
        const feeds=[];for(const code of editions){try{feeds.push(await googleNewsSearch(q,code,4))}catch{feeds.push(null)}}
        const seen=new Set();const results=[];
        for(let i=0;i<feeds.length;i++)for(const item of (feeds[i]?.results||[])){const key=String(item.url||'').split('?')[0];if(!key||seen.has(key))continue;seen.add(key);results.push({...item,region:feeds[i].country});}
        news={results:results.slice(0,24),country:'Worldwide · 10 regional editions',fetched_at:new Date().toISOString(),source:'Google News multi-edition RSS'};
      }else news=await googleNewsSearch(q,country,16);
      if(news?.results?.length){const articles=await investigatePublisherArticles(news.results,5);return {...news,results:articles,comparisons:comparePublisherReports(articles),source:'Global news editions + publisher article retrieval',fetched_at:new Date().toISOString(),note:'Current affairs are searched across multiple regional editions. Publisher pages are retrieved where accessible; article access limits are marked rather than treated as evidence.'};}
    } catch {}
  }
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
  if (/(election|war|conflict|invasion|ceasefire|breaking|latest|current|news|president|prime minister|Ukraine|Russia|Iran|Israel|Gaza|Sudan|Taiwan)/i.test(q)) {
    try {
      const news = await googleNewsSearch(q, country, 8);
      if (news?.results?.length) return { ...news, source: 'Google News RSS', fetched_at: new Date().toISOString(), note: 'Current-affairs lookup from free publisher headlines and links.' };
    } catch {}
  }
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