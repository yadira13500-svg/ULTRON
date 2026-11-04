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