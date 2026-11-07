import { searchPublicWeb } from 'lib/search.js';
import { searchOpenKnowledge } from 'lib/open-knowledge.js';
const ACADEMIC_QUERY=/\b(research|study|studies|paper|papers|academic|scholarly|peer.review|literature|scientific|clinical|evidence|systematic review|meta.analysis|journal|arxiv|pubmed|doi|evaluation methods)\b/i;
export async function searchResearchSources(query,country='WORLD',options={}) {
 const q=String(query||'').trim().slice(0,240); if(!q)return {query:q,results:[],source:'research retrieval'};
 const includeScholarly=options.includeScholarly===true||ACADEMIC_QUERY.test(q);
 const [webResult,scholarResult]=await Promise.allSettled([searchPublicWeb(q,country),includeScholarly?searchOpenKnowledge(q):Promise.resolve(null)]);
 const web=webResult.status==='fulfilled'?webResult.value:{results:[],source:'public web unavailable',error:String(webResult.reason?.message||webResult.reason||'').slice(0,160)};
 const scholar=scholarResult.status==='fulfilled'?scholarResult.value:null, results=[],seen=new Set();
 const add=(item,kind)=>{if(!item||!item.url||!item.title)return;let u;try{u=new URL(String(item.url));if(u.protocol!=='https:')return;}catch{return;}
  const key=String(item.doi||u.href).toLowerCase().replace(/\/$/,'');if(seen.has(key))return;seen.add(key);
  results.push({title:String(item.title).slice(0,300),url:u.href,snippet:String(item.snippet||item.summary||item.description||'').slice(0,1400),publisher:String(item.publisher||item.source||'').slice(0,160),source_kind:kind,kind:item.kind||null,doi:item.doi||null,published_at:item.published_at||''});};
 for(const x of web.results||[])add(x,'web'); for(const x of scholar?.results||[])add(x,'scholarly_index');
 return {query:q,results:results.slice(0,24),source:scholar?'public web + open scholarly indexes':(web.source||'public web'),fetched_at:web.fetched_at||scholar?.checkedAt||new Date().toISOString(),research_coverage:{web_results:(web.results||[]).length,scholarly_results:(scholar?.results||[]).length,scholarly_search_attempted:includeScholarly,providers:scholar?.providers||[],web_error:webResult.status==='rejected'?String(webResult.reason?.message||webResult.reason).slice(0,160):null},note:'Search results are discovery leads, not verified claims. Capture primary sources, check dates and publisher independence, compare exact passages, and retain human review for contested conclusions.'};
}