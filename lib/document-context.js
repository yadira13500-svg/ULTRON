// Document-level evidence context index. Offsets are UTF-16 offsets into the captured excerpt.
// Structured context is a review aid, not a semantic entailment verdict.
const MAX_TOTAL=5200,MAX_SEGMENTS=8,MAX_SEGMENT=900;
const PRONOUNS=new Set(['it','its','they','them','their','theirs','this','that','these','those','he','him','his','she','her','hers','former','latter','respectively']);
const STOP=new Set(['about','after','again','against','also','among','and','are','because','been','being','between','but','can','could','did','does','doing','during','each','for','from','had','has','have','into','its','may','more','most','not','other','over','same','should','some','such','than','that','the','their','there','these','they','this','those','through','under','very','was','were','what','when','where','which','while','with','would','your','will','said','says']);
const clean=x=>String(x||'').trim();
const words=x=>(clean(x).toLowerCase().match(/[a-z][a-z'-]{1,}/g)||[]).map(w=>w.replace(/['-]/g,''));
function splitParagraphs(raw){
 const out=[],re=/\S(?:[\s\S]*?\S)?(?=\n\s*\n|$)/g;let m;
 while((m=re.exec(raw))&&out.length<1000){const v=m[0].trim();if(v){const left=m[0].search(/\S/),right=m[0].length-m[0].trimEnd().length;out.push({text:v,start:m.index+left,end:m.index+m[0].length-right,index:out.length});}if(!m[0].length)re.lastIndex++;}
 if(out.length<=1&&raw.length){const fallback=/[^.!?]+[.!?]?(?:\s+|$)/g;let x;while((x=fallback.exec(raw))&&out.length<1000){const v=x[0].trim();if(v.length>20){const start=x.index+x[0].indexOf(v);out.push({text:v,start,end:start+v.length,index:out.length});}}}
 return out;
}
function isHeading(t){const s=clean(t);return s.length<160&&(/^#{1,6}\s/.test(s)||/^(?:\d+(?:\.\d+)*[.)]?\s+)?(?:section|chapter|part|article|appendix|definitions?|glossary|scope|background|decision|findings|conclusion)\b/i.test(s)||/^[A-Z0-9][A-Z0-9 &:/()_-]{2,}$/.test(s));}
function headingFor(index,paras){for(let i=index;i>=0;i--)if(isHeading(paras[i].text))return paras[i];return null;}
function entities(text){const found=clean(text).match(/\b(?:[A-Z][a-z][A-Za-z0-9&'-]*(?:\s+[A-Z][a-z][A-Za-z0-9&'-]*){0,3}|[A-Z]{2,}|the\s+[a-z][a-z-]{2,}(?:\s+[a-z][a-z-]{2,}){0,1})\b/g)||[];return [...new Set(found)].filter(x=>!['the','this','that','these','those','it'].includes(x.toLowerCase())).slice(0,20);}
function definedTerms(claim){const phrases=clean(claim).match(/\b[A-Z][a-z][A-Za-z0-9_-]*(?:\s+[A-Z][a-z][A-Za-z0-9_-]*)+\b/g)||[];const acronyms=clean(claim).match(/\b[A-Z]{2,}\b/g)||[];return [...new Set([...phrases,...acronyms])];}
function escapeRe(s){return s.replace(/[|\\{}()[\]^$+*?.-]/g,'\\$&');}
function definitionMatches(claim,paras){
 const out=[];for(const term of definedTerms(claim)){let p=paras.find(x=>new RegExp('\\b'+escapeRe(term)+'\\b.{0,100}\\b(?:means|is defined as|refers to|shall mean|is used here to mean)\\b','i').test(x.text));let alias=null;
  if(!p){for(const candidate of paras){const m=candidate.text.match(/\b([A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*){1,5})\s*\(([A-Z]{2,10})\)|\b([A-Z]{2,10})\s*\(([A-Z][A-Za-z0-9&'-]*(?:\s+[A-Z][A-Za-z0-9&'-]*){1,5})\)/);if(m){const full=m[1]||m[4],short=m[2]||m[3];if(term.toLowerCase()===full.toLowerCase()||term.toLowerCase()===short.toLowerCase()){p=candidate;alias={full,short};break;}}}}
  if(p)out.push({term,alias,paragraphIndex:p.index,start:p.start,end:p.end,excerpt:p.text.slice(0,500)});
 }return out;
}
function pronounSignals(claim,local,paras,currentIndex){
 const refs=[...new Set([...words(claim),...words(local)].filter(w=>PRONOUNS.has(w)))];
 const preceding=paras.filter(p=>p.index<currentIndex),candidates=[];
 for(const p of preceding)for(const name of entities(p.text))candidates.push({entity:name,paragraphIndex:p.index,excerpt:p.text.slice(0,240),recency:currentIndex-p.index});
 const claimNames=entities(claim).map(x=>x.toLowerCase());
 const ranked=candidates.map(c=>({...c,score:(claimNames.includes(c.entity.toLowerCase())?4:0)+(c.recency===1?3:c.recency<=3?2:1)})).sort((a,b)=>b.score-a.score);
 const formerLatter=refs.some(x=>x==='former'||x==='latter'||x==='respectively'),top=ranked[0],second=ranked[1];
 const ambiguous=refs.length>0&&(formerLatter?candidates.length!==2:!top||!!second&&top.score-second.score<2);
 return {pronounReferences:refs,antecedentCandidates:ranked.slice(0,8),resolvedAntecedent:!ambiguous&&top?top.entity:null,pronounAntecedentAmbiguous:ambiguous,referenceResolution:'heuristic_candidate_ranking_not_coreference'};
}
function quoteSignals(text){
 const spans=[];let stack=[],nested=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'||ch==='“'||ch==='‘'){if(stack.length)nested=true;stack.push({start:i,char:ch});}
 else if((ch==='"'&&stack.length&&stack[stack.length-1].char==='"')||(ch==='”'&&stack.length&&stack[stack.length-1].char==='“')||(ch==='’'&&stack.length&&stack[stack.length-1].char==='‘')){const q=stack.pop();spans.push({start:q.start,end:i+1,depth:stack.length+1});}}
 return {quotedMaterial:spans.length>0||/\b(?:quoted|quotation|quote|transcript|verbatim)\b/i.test(text),nestedQuotationDetected:nested||spans.some(x=>x.depth>1),quoteSpans:spans.slice(0,12)};
}
function attributionSignals(text){return /\b(?:according to|as reported by|(?:said|says|stated|states|claimed|claims|alleged|alleges|announced|announces|wrote|writes|testified|testifies)|the spokesperson|the witness|the filing)\b/i.test(text);}
export function buildDocumentContext(claim,sourceText,passageStart,passageEnd){
 const raw=String(sourceText||''),paras=splitParagraphs(raw),idx=paras.findIndex(p=>Number(passageStart)>=p.start&&Number(passageStart)<p.end);
 const current=idx>=0?paras[idx]:{text:raw.slice(Math.max(0,Number(passageStart)||0),Math.max(0,Number(passageEnd)||0)),start:Math.max(0,Number(passageStart)||0),end:Math.max(0,Number(passageEnd)||0),index:0};
 const localStart=paras[Math.max(0,(idx<0?0:idx)-2)]?.start??current.start,localEnd=current.end,localText=raw.slice(localStart,localEnd);
 const defs=definitionMatches(claim,paras),referential=words(claim).some(w=>PRONOUNS.has(w))||words(current.text).some(w=>PRONOUNS.has(w));
 const pronouns=pronounSignals(claim,current.text,paras,idx<0?0:idx);
 const relevant=[];const add=(p,reason)=>{if(p&&!relevant.some(x=>x.index===p.index))relevant.push({...p,reason});};
 for(const p of paras.slice(Math.max(0,(idx<0?0:idx)-2),Math.max(0,idx)))add(p,'preceding_context');
 add(idx>=0?paras[idx]:current,'selected_passage_paragraph');
 const heading=headingFor(idx<0?0:idx,paras);if(heading)add(heading,'section_heading');
 for(const d of defs){const p=paras[d.paragraphIndex];add(p,'defined_term:'+d.term);const h=headingFor(p.index,paras);if(h)add(h,'definition_section_heading');}
 if(referential)for(const candidate of pronouns.antecedentCandidates.slice(0,5))add(paras[candidate.paragraphIndex],'possible_antecedent');
 relevant.sort((a,b)=>a.start-b.start);
 const segments=[];let budget=MAX_TOTAL;
 for(const p of relevant){const text=p.text.slice(0,MAX_SEGMENT);if(segments.length>=MAX_SEGMENTS||text.length>budget)continue;segments.push({paragraphIndex:p.index,startOffset:p.start,endOffset:p.start+text.length,text,reason:p.reason,truncated:text.length<p.text.length});budget-=text.length;}
 const analysisText=segments.map(x=>x.text).join('\n\n');
 const windowStart=Math.max(localStart,Math.min(Number(passageStart)||localStart,Math.max(localStart,localEnd-1400)));
 const windowEnd=Math.min(localEnd,Math.max(Number(passageEnd)||windowStart,windowStart+1400));
 const localExcerpt=raw.slice(windowStart,windowEnd);
 const quote=quoteSignals(current.text),attribution=attributionSignals(analysisText);
 const definedSection=paras.some(p=>/^\s*(?:#{1,6}\s*)?(?:definitions?|glossary|terminology)\s*$/i.test(p.text)),terms=definedTerms(claim);
 const missingDefinitions=definedSection?terms.filter(t=>!defs.some(d=>d.term.toLowerCase()===t.toLowerCase())):[];
 const headings=segments.filter(x=>x.reason.includes('heading')).map(x=>({paragraphIndex:x.paragraphIndex,excerpt:x.text.slice(0,180)}));
 return {contextText:localExcerpt,analysisText,contextStartOffset:windowStart,contextEndOffset:windowEnd,contextParagraphIndexes:segments.map(x=>x.paragraphIndex),contextSegments:segments,contextParagraphCount:segments.length,contextClipped:segments.some(x=>x.truncated),contextVersion:'document_context_v2',
 scope:{...pronouns,...quote,attributionAcrossParagraphs:attribution,headingContextIncluded:headings.length>0,headingParagraphs:headings,definitionDependency:defs.length>0||missingDefinitions.length>0,definitionTerms:defs.map(d=>d.term),missingDefinitions,definitionContextIncluded:defs.length>0,definitionReferences:defs.map(d=>({term:d.term,paragraphIndex:d.paragraphIndex,start:d.start,end:d.end}))}};
}