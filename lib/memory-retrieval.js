const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have how i if in into is it its may me my of on or our out please should so than that the their them then there these they this to was we were what when where which who why will with would you your about after before between during each more most other same some such than through under using very').split(' '));
const words = value => (String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(x => x.length > 2 && !STOP.has(x)));
const stamp = value => { const n=Date.parse(value||''); return Number.isFinite(n)?n:0; };
export function rankMemoryCandidates(query, candidates, limit = 12) {
  const q=String(query||'').trim().toLowerCase(), terms=[...new Set(words(q))];
  if(!terms.length||!Array.isArray(candidates)) return [];
  const docs=candidates.map(item=>({item,body:String([item.title,item.category,item.content,item.topic,item.summary,item.preference,item.lesson].filter(Boolean).join(' ')).toLowerCase(),tokens:new Set(words([item.title,item.category,item.content,item.topic,item.summary,item.preference,item.lesson].filter(Boolean).join(' ')))}));
  const df=new Map(); for(const d of docs) for(const t of terms) if(d.tokens.has(t)) df.set(t,(df.get(t)||0)+1);
  const weights=new Map(terms.map(t=>[t,Math.log(1+(docs.length+1)/((df.get(t)||0)+1))]));
  const totalWeight=[...weights.values()].reduce((a,b)=>a+b,0)||1, now=Date.now();
  return docs.map(d=>{
    const matched=terms.filter(t=>d.tokens.has(t)), weighted=matched.reduce((n,t)=>n+(weights.get(t)||0),0)/totalWeight, coverage=matched.length/terms.length;
    const phrase=q.length>=8&&d.body.includes(q)?1:0, pairs=terms.slice(0,-1).map((t,i)=>t+' '+terms[i+1]), bigram=pairs.length?Math.min(1,pairs.filter(x=>d.body.includes(x)).length/pairs.length):0;
    const age=stamp(d.item.updated_at||d.item.reviewed_at||d.item.created_at||d.item.last_checked_at), recency=age?Math.max(0,1-(now-age)/(365*86400000)):0;
    return {...d.item,relevance_score:Number(Math.min(1,0.55*weighted+0.25*coverage+0.12*bigram+0.08*phrase+0.025*recency).toFixed(4)),matched_terms:matched};
  }).filter(x=>x.relevance_score>=0.12).sort((a,b)=>b.relevance_score-a.relevance_score||stamp(b.updated_at||b.reviewed_at||b.created_at)-stamp(a.updated_at||a.reviewed_at||a.created_at)).slice(0,Math.max(1,Math.min(30,Number(limit)||12)));
}
export function memoryRetrievalSelfTest() {
 const fixtures=[{kind:'memory',category:'project',content:'ULTRON should preserve the existing Hatchable project and never rebuild it.',updated_at:'2026-11-01T00:00:00Z'},{kind:'knowledge',topic:'Multi-agent verification',summary:'Independent verifiers should challenge evidence and detect contradictions.',source_url:'https://example.org/agents',created_at:'2026-11-02T00:00:00Z'},{kind:'lesson',lesson:'Use an alternate public source after an HTTP 403.',reviewed_at:'2026-11-03T00:00:00Z'},{kind:'conversation',content:'We discussed a restaurant booking and dinner time.',created_at:'2026-11-06T00:00:00Z'}];
 const project=rankMemoryCandidates('continue the existing ULTRON Hatchable project',fixtures,4), verifier=rankMemoryCandidates('independent verifier contradictions evidence',fixtures,4), unrelated=rankMemoryCandidates('zxqv no matching topic',fixtures,4);
 const ok=project[0]?.kind==='memory'&&verifier[0]?.kind==='knowledge'&&project.every(x=>x.relevance_score>0)&&unrelated.length===0;
 return {name:'relevance_ranked_memory_retrieval',ok,semantic:ok,projectTop:project[0]?.kind||null,verifierTop:verifier[0]?.kind||null,irrelevantResults:unrelated.length,detail:ok?'Relevant project memory and evidence knowledge outrank unrelated recent conversation; unrelated queries return no memory.':'Memory relevance ranking did not meet its retrieval fixtures.'};
}