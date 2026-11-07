const cleanText=v=>String(v||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim().slice(0,1800);
async function jsonGet(url,source){
 try{const r=await fetch(url,{timeout_ms:10000,headers:{Accept:'application/json','User-Agent':'ULTRON-OpenKnowledge/1.0'}});if(!r.ok)return {source,ok:false,status:r.status,results:[]};return {source,ok:true,status:r.status,data:await r.json()};}
 catch(e){return {source,ok:false,status:0,error:String(e?.message||e).slice(0,120),results:[]};}
}
function result(title,url,summary,source,publishedAt='',meta={}) {
 try{const u=new URL(url);if(u.protocol!=='https:'||!u.hostname)return null;return {title:cleanText(title).slice(0,300),url:u.href,summary:cleanText(summary),source,published_at:String(publishedAt||'').slice(0,40),...meta};}catch{return null;}
}
function xmlField(block,name){const m=block.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));return cleanText(m?.[1]||'');}
async function openAlex(q){
 const u='https://api.openalex.org/works?search='+encodeURIComponent(q)+'&per-page=6&select=id,doi,title,publication_year,authorships,primary_location,cited_by_count,type';
 const x=await jsonGet(u,'OpenAlex');const rows=x.data?.results||[];
 return {source:'OpenAlex',ok:x.ok,status:x.status,results:rows.map(w=>result(w.title,w.doi||w.primary_location?.landing_page_url||w.id,'Authors: '+(w.authorships||[]).slice(0,4).map(a=>a.author?.display_name).filter(Boolean).join(', ')+' · Citations: '+(w.cited_by_count??'not supplied'),'OpenAlex',w.publication_year||'',{kind:'scholarly_work',doi:w.doi||null})).filter(Boolean)};
}
async function crossref(q){
 const u='https://api.crossref.org/works?query.bibliographic='+encodeURIComponent(q)+'&rows=6&select=DOI,title,author,published,publisher,type';
 const x=await jsonGet(u,'Crossref');const rows=x.data?.message?.items||[];
 return {source:'Crossref',ok:x.ok,status:x.status,results:rows.map(w=>{const d=w.published?.['date-parts']?.[0]||[];return result(w.title?.[0],w.DOI?'https://doi.org/'+w.DOI:'', 'Publisher: '+(w.publisher||'not supplied')+' · Type: '+(w.type||'not supplied'),'Crossref',d.join('-'),{kind:'scholarly_work',doi:w.DOI||null});}).filter(Boolean)};
}
async function europePmc(q){
 const u='https://www.ebi.ac.uk/europepmc/webservices/rest/search?query='+encodeURIComponent(q)+'&format=json&pageSize=6&resultType=core';
 const x=await jsonGet(u,'Europe PMC');const rows=x.data?.resultList?.result||[];
 return {source:'Europe PMC',ok:x.ok,status:x.status,results:rows.map(w=>result(w.title,w.doi?'https://doi.org/'+w.doi:w.pmid?'https://europepmc.org/article/MED/'+w.pmid:'', 'Authors: '+(w.authorString||'not supplied')+' · Journal: '+(w.journalTitle||'not supplied'),'Europe PMC',w.firstPublicationDate||'',{kind:'biomedical_research',doi:w.doi||null,pmid:w.pmid||null})).filter(Boolean)};
}
async function pubmed(q){
 const base='https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
 const a=await jsonGet(base+'esearch.fcgi?db=pubmed&term='+encodeURIComponent(q)+'&retmode=json&retmax=6','PubMed');
 const ids=a.data?.esearchresult?.idlist||[];if(!a.ok||!ids.length)return {source:'PubMed',ok:a.ok,status:a.status,results:[]};
 const b=await jsonGet(base+'esummary.fcgi?db=pubmed&id='+ids.join(',')+'&retmode=json','PubMed');
 const results=ids.map(id=>{const w=b.data?.result?.[id];return result(w?.title,'https://pubmed.ncbi.nlm.nih.gov/'+id+'/', 'Journal: '+(w?.fulljournalname||'not supplied')+' · Authors: '+(w?.authors||[]).slice(0,4).map(a=>a.name).join(', '),'PubMed',w?.pubdate||'',{kind:'biomedical_research',pmid:id});}).filter(Boolean);
 return {source:'PubMed',ok:b.ok,status:b.status,results};
}
async function arxiv(q){
 try{
  const u='https://export.arxiv.org/api/query?search_query=all:'+encodeURIComponent(q)+'&start=0&max_results=6&sortBy=relevance';
  const r=await fetch(u,{timeout_ms:10000,headers:{Accept:'application/atom+xml','User-Agent':'ULTRON-OpenKnowledge/1.0'}});
  if(!r.ok)return {source:'arXiv',ok:false,status:r.status,results:[]};
  const xml=await r.text(),blocks=xml.match(/<entry>[\s\S]*?<\/entry>/gi)||[];
  const results=blocks.map(b=>{const title=xmlField(b,'title'),summary=xmlField(b,'summary'),id=xmlField(b,'id'),published=xmlField(b,'published');return result(title,id,summary,'arXiv',published,{kind:'preprint'});}).filter(Boolean);
  return {source:'arXiv',ok:true,status:r.status,results};
 }catch(e){return {source:'arXiv',ok:false,status:0,error:String(e?.message||e).slice(0,120),results:[]};}
}
export async function searchOpenKnowledge(query){
 const q=String(query||'').trim().slice(0,180);if(!q)throw new Error('Enter a research topic.');
 const providers=[openAlex,crossref,europePmc,pubmed,arxiv];
 const settled=await Promise.all(providers.map(fn=>fn(q)));
 const seen=new Set(),results=[];
 for(const p of settled)for(const x of p.results||[]){const key=x.doi?'doi:'+x.doi.toLowerCase():x.url.toLowerCase();if(seen.has(key))continue;seen.add(key);results.push(x);}
 return {query:q,results:results.slice(0,30),providers:settled.map(p=>({source:p.source,ok:p.ok,status:p.status,resultCount:(p.results||[]).length,error:p.error||null})),checkedAt:new Date().toISOString(),note:'Open scholarly and biomedical indexes. Search results are leads, not proof; preprints are not necessarily peer reviewed. ULTRON has not independently verified each paper.'};
}