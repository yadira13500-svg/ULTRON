export function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/<[^>]*>/g, '').trim();
}
export function parseRss(xml, limit = 15) {
  const items = [];
  const blocks = String(xml || '').match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks.slice(0, limit)) {
    const field = name => {
      const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i');
      return decodeXml(block.match(re)?.[1] || '');
    };
    const link = field('link');
    const title = field('title');
    if (!title || !/^https?:\/\//i.test(link)) continue;
    items.push({
      title: title.slice(0, 300),
      url: link,
      source: field('source').slice(0, 100),
      description: field('description').slice(0, 700),
      published_at: field('pubDate')
    });
  }
  return items;
}
export const NEWS_COUNTRIES = {
  US:{label:'United States',hl:'en-US',gl:'US',ceid:'US:en'},
  NG:{label:'Nigeria',hl:'en-NG',gl:'NG',ceid:'NG:en'},
  GB:{label:'United Kingdom',hl:'en-GB',gl:'GB',ceid:'GB:en'},
  CA:{label:'Canada',hl:'en-CA',gl:'CA',ceid:'CA:en'},
  IN:{label:'India',hl:'en-IN',gl:'IN',ceid:'IN:en'},
  AU:{label:'Australia',hl:'en-AU',gl:'AU',ceid:'AU:en'},
  ZA:{label:'South Africa',hl:'en-ZA',gl:'ZA',ceid:'ZA:en'},
  GH:{label:'Ghana',hl:'en-GH',gl:'GH',ceid:'GH:en'},
  KE:{label:'Kenya',hl:'en-KE',gl:'KE',ceid:'KE:en'},
  FR:{label:'France',hl:'fr-FR',gl:'FR',ceid:'FR:fr'},
  DE:{label:'Germany',hl:'de-DE',gl:'DE',ceid:'DE:de'},
  JP:{label:'Japan',hl:'ja-JP',gl:'JP',ceid:'JP:ja'},
  BR:{label:'Brazil',hl:'pt-BR',gl:'BR',ceid:'BR:pt-BR'},
  MX:{label:'Mexico',hl:'es-419',gl:'MX',ceid:'MX:es-419'}
};
export function comparePublisherReports(items = []) {
  const clean = items.filter(x => x && x.title && x.url).map(x => {
    let host=''; try { host=new URL(x.url).hostname.replace(/^www\./,'').toLowerCase(); } catch {}
    const source=String(x.source||host||'Publisher').trim();
    const trusted=/reuters\.com|apnews\.com|bbc\.(com|co\.uk)|aljazeera\.com|theguardian\.com|npr\.org|france24\.com|dw\.com|nation\.africa|standardmedia\.co\.ke|citizen\.digital|who\.int|un\.org|gov\./i.test(host)||/reuters|associated press|bbc|al jazeera|the guardian|daily nation|the eastafrican|the africa report|people daily|the standard/i.test(source);
    const words=String(x.title||'').toLowerCase().replace(/https?:\/\/\S+/g,' ').match(/[a-z]{4,}/g)||[];
    const stop=new Set(['that','this','with','from','after','before','over','into','says','said','report','reports','latest','update','live','what','when','where','will','have','has','been','were','their','about','amid','could','would','should','more','than','also','official','officials','kenya','politics','political','government','country','today','2027','2026','president','minister','election','news']);
    return {...x,source,host,source_signal:trusted?'recognized publisher signal; still assess article and sourcing':(source?'publisher identified; quality not independently assessed':'publisher not identified'),source_score:trusted?0.8:0.45,terms:[...new Set(words.filter(w=>!stop.has(w)))]};
  });
  const groups=[];
  for(const item of clean){
    let best=null,bestScore=0;
    for(const g of groups){if(g.some(x=>x.source.toLowerCase()===item.source.toLowerCase()))continue;const base=g[0].terms;const common=item.terms.filter(t=>base.includes(t));const score=common.length/Math.max(1,Math.min(8,Math.max(base.length,item.terms.length)));if(common.length>=3&&score>=0.5&&score>bestScore){best=g;bestScore=score;}}
    if(best)best.push(item);else groups.push([item]);
  }
  return groups.map(g=>{
    const publishers=[...new Set(g.map(x=>x.source.toLowerCase()))];
    const text=g.map(x=>x.title+' '+(x.description||x.snippet||'')).join(' ').toLowerCase();
    const denialSources=g.filter(x=>/\b(denies|denied|disputes|disputed|rejects|rejected|not true|no evidence|false claim)\b/i.test(String(x.title+' '+(x.description||x.snippet||''))));const assertionSources=g.filter(x=>!denialSources.includes(x)&&/\b(says|said|announces|announced|confirms|confirmed|reports|reported|claims|claimed|according to|officials say)\b/i.test(String(x.title+' '+(x.description||x.snippet||''))));const conflictWords=denialSources.some(d=>assertionSources.some(a=>a.source.toLowerCase()!==d.source.toLowerCase()));
    const dates=g.map(x=>Date.parse(x.published_at||'')).filter(Number.isFinite);
    const freshest=dates.length?new Date(Math.max(...dates)).toISOString():null;
    const recent=!!freshest&&(Date.now()-Date.parse(freshest))<72*60*60*1000;const status=conflictWords?'disputed':publishers.length>=2?'corroborated_reporting':recent?'developing':'single_source';
    return {status,label:status==='disputed'?'Disputed / conflicting claims':status==='corroborated_reporting'?'Corroborated across publishers (not independently proven)':status==='developing'?'Developing · limited independent coverage':'Single-publisher reporting',publisher_count:publishers.length,publishers,latest_published_at:freshest,conflict_signals:conflictWords?['Coverage contains explicit denial or dispute language; inspect each linked report.']:[],items:g.map(({terms,...x})=>x),caution:'Publisher agreement is evidence of corroboration, not proof that every detail is true.'};
  });
}
export async function googleNewsSearch(query, country = 'US', limit = 10) {
  const c = NEWS_COUNTRIES[country] || NEWS_COUNTRIES.US;
  const q = String(query || 'top news').trim().slice(0, 220);
  const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:7d') +
    '&hl=' + encodeURIComponent(c.hl) + '&gl=' + c.gl + '&ceid=' + encodeURIComponent(c.ceid);
  const response = await fetch(url, { timeout_ms: 10000, headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' } });
  if (!response.ok) throw new Error('News source returned HTTP ' + response.status);
  const xml = await response.text();
  return { results: parseRss(xml, limit), country: c.label, fetched_at: new Date().toISOString(), source: 'Google News RSS' };
}