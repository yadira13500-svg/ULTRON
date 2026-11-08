const STOP = new Set(('a an and are as at be been but by can could did do does for from had has have how i if in into is it its may me my of on or our out please should so than that the their them then there these they this to was we were what when where which who why will with would you your about after before between during each more most other same some such than through under using very').split(' '));
const words = value => (String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,' ').trim().split(/\s+/).filter(x => x.length > 2 && !STOP.has(x)));
const stamp = value => { const n=Date.parse(value||''); return Number.isFinite(n)?n:0; };
export function buildContextualMemoryQuery(prompt, history = []) {
 const current=String(prompt||'').trim();
 const followUp=/\b(it|that|this|they|them|those|these|there|same|continue|next|again|more|previous|earlier|above)\b/i.test(current)||/^(do it|go on|keep going|carry on|continue|next|again|more|why|how|what about that|and then)[.!?]*$/i.test(current);
 if(!followUp||!Array.isArray(history)) return current;
 const prior=history.filter(x=>x&&x.role==='user').slice(-4).map(x=>String(x.content||'').trim()).filter(Boolean).slice(-3);
 return [...prior,current].join(' ').slice(-1800);
}
export function flagPreferenceConflicts(items = []) {
 const rows=Array.isArray(items)?items.map(x=>({...x})):[], groups=new Map();
 const tokens=value=>new Set(words(String(value||'').replace(/\b(not|never|no|avoid|without|dont|don't|cannot|can't)\b/gi,' ')));
 const negative=value=>/\b(not|never|no|avoid|without|dont|don't|cannot|can't)\b/i.test(String(value||''));
 for(let i=0;i<rows.length;i++){
  const x=rows[i];if(x.kind!=='confirmed_preference')continue;
  const key=String(x.category||'').toLowerCase().trim();if(!key)continue;
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
 }
 const flagged=[];
 for(const [category,indices] of groups){
  if(indices.length<2)continue;
  for(let a=0;a<indices.length;a++)for(let b=a+1;b<indices.length;b++){
   const ia=indices[a],ib=indices[b],A=rows[ia],B=rows[ib],ta=tokens(A.preference||A.content),tb=tokens(B.preference||B.content);
   const common=[...ta].filter(t=>tb.has(t)).length,overlap=common/Math.max(1,Math.min(ta.size,tb.size));
   if(overlap>=0.6&&negative(A.preference||A.content)!==negative(B.preference||B.content)){
    A.memory_conflict=B.memory_conflict=true;A.conflict_category=B.conflict_category=category;
   }
  }
  const marked=indices.filter(i=>rows[i].memory_conflict);if(marked.length)flagged.push({category,items:marked.map(i=>rows[i])});
 }
 return {items:rows,conflicts:flagged};
}
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
 const contextual=buildContextualMemoryQuery('make it faster',[{role:'user',content:'We are improving the ULTRON Hatchable project memory retrieval and specialist coordination.'}]);
 const contextualTop=rankMemoryCandidates(contextual,fixtures,4)[0]?.kind||null;
 const standalone=buildContextualMemoryQuery('Explain photosynthesis',[{role:'user',content:'We are improving ULTRON memory.'}]);
 const conflictCheck=flagPreferenceConflicts([{kind:'confirmed_preference',category:'response_style',preference:'Prefer concise answers',updated_at:'2026-11-06T00:00:00Z'},{kind:'confirmed_preference',category:'response_style',preference:'Do not prefer concise answers',updated_at:'2026-11-07T00:00:00Z'}]);
 const conflictVisible=conflictCheck.conflicts.length===1&&conflictCheck.items.every(x=>x.memory_conflict===true);
 const ok=project[0]?.kind==='memory'&&verifier[0]?.kind==='knowledge'&&project.every(x=>x.relevance_score>0)&&unrelated.length===0&&contextual.includes('ULTRON Hatchable project')&&contextualTop==='memory'&&standalone==='Explain photosynthesis'&&conflictVisible;
 return {name:'relevance_ranked_memory_retrieval',ok,semantic:ok,projectTop:project[0]?.kind||null,verifierTop:verifier[0]?.kind||null,irrelevantResults:unrelated.length,contextualFollowUpPreserved:contextual.includes('ULTRON Hatchable project'),standaloneQueryUnpolluted:standalone==='Explain photosynthesis',preferenceConflictDetected:conflictVisible,detail:ok?'Relevant project memory and evidence knowledge outrank unrelated recent conversation; unrelated queries return no memory.':'Memory relevance ranking did not meet its retrieval fixtures.'};
}