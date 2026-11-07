// Bounded document-context extraction for deterministic evidence review.
// Context is descriptive evidence metadata, never a semantic entailment verdict.
const MAX_CONTEXT_CHARS = 5200;
const PRONOUNS = new Set(['it','its','they','them','their','theirs','this','that','these','those','he','him','his','she','her','hers','former','latter','respectively']);
const STOP = new Set(['about','after','again','against','also','among','and','are','because','been','being','between','but','can','could','did','does','doing','during','each','for','from','had','has','have','into','its','may','more','most','not','other','over','same','should','some','such','than','that','the','their','there','these','they','this','those','through','under','very','was','were','what','when','where','which','while','with','would','your','will','said','says']);
const clean = value => String(value || '').trim();
function paragraphSpans(text) {
  const raw=String(text||''), out=[];
  const re=/[^\n]*(?:\n(?!\s*\n)[^\n]*)*/g;
  let m;
  while((m=re.exec(raw)) && out.length<500) {
    const value=m[0];
    if(value.trim()) {
      const left=value.search(/\S/), right=value.length-value.trimEnd().length;
      out.push({text:value.trim(),start:m.index+left,end:m.index+value.length-right,paragraphIndex:out.length});
    }
    if(!m[0].length) re.lastIndex++;
  }
  return out;
}
function words(text){return (clean(text).toLowerCase().match(/[a-z][a-z'-]{1,}/g)||[]).map(x=>x.replace(/['-]/g,''));}
function nounCandidates(text) {
  const matches=clean(text).match(/\b(?:[A-Z][a-z]{2,}(?:\s+[a-z][a-z-]{3,}){0,2}|the\s+[a-z][a-z-]{3,}(?:\s+[a-z][a-z-]{3,}){0,2})\b/g)||[];
  return [...new Set(matches)].slice(-12);
}
function isHeading(text) {
  const lines=clean(text).split(/\n/).map(x=>x.trim()).filter(Boolean);
  return lines.length>0 && lines.every(x=>x.length<120) && (lines.some(x=>/^#{1,6}\s/.test(x)) || lines.every(x=>x.length<90 && (x===x.toUpperCase() || /^[A-Z][^.!?]{2,80}$/.test(x))));
}
function definitionMatches(claim, paragraphs) {
  const phrases=clean(claim).match(/\b[A-Z][a-z][A-Za-z0-9_-]*(?:\s+[A-Z][a-z][A-Za-z0-9_-]*)+\b/g)||[];
  const acronyms=clean(claim).match(/\b[A-Z]{2,}\b/g)||[];
  const terms=[...new Set([...phrases,...acronyms])];
  const found=[];
  for(const term of terms) {
    const re=new RegExp('\\b'+term+'\\b.{0,100}\\b(?:means|is defined as|refers to|shall mean|is used here to mean)\\b','i');
    for(const p of paragraphs) if(re.test(p.text)) {found.push({term,paragraphIndex:p.paragraphIndex,start:p.start,end:p.end,excerpt:p.text.slice(0,500)});break;}
  }
  return found;
}
export function buildDocumentContext(claim, sourceText, passageStart, passageEnd) {
  const raw=String(sourceText||''), spans=paragraphSpans(raw);
  const index=spans.findIndex(p=>Number(passageStart)>=p.start&&Number(passageStart)<p.end);
  const current=index>=0?spans[index]:{start:Math.max(0,Number(passageStart)||0),end:Math.max(0,Number(passageEnd)||0),text:raw.slice(Math.max(0,Number(passageStart)||0),Math.max(0,Number(passageEnd)||0)),paragraphIndex:0};
  const previous=spans.slice(Math.max(0,(index<0?0:index)-2),index<0?0:index);
  const defs=definitionMatches(claim,spans);
  const included=[...previous,current,...defs.map(d=>spans[d.paragraphIndex]).filter(Boolean)];
  let start=included.length?Math.min(...included.map(x=>x.start)):current.start;
  let end=included.length?Math.max(...included.map(x=>x.end)):current.end;
  let clipped=false;
  if(end-start>MAX_CONTEXT_CHARS) { start=Math.max(current.start-MAX_CONTEXT_CHARS+Math.min(current.end-current.start,1200),start); end=Math.min(raw.length,start+MAX_CONTEXT_CHARS); clipped=true; }
  const contextText=raw.slice(start,end);
  const before=raw.slice(0,current.start);
  const localText=raw.slice(current.start,current.end);
  const pronounTokens=[...new Set([...words(claim),...words(localText)].filter(w=>PRONOUNS.has(w)))];
  const antecedents=nounCandidates(before.slice(-2400));
  const claimTerms=new Set(words(claim).filter(w=>!STOP.has(w)));
  const antecedentOverlap=antecedents.filter(n=>words(n).some(w=>claimTerms.has(w)));
  const pronounNeedsAntecedent=pronounTokens.length>0;
  const antecedentAmbiguous=pronounNeedsAntecedent && (antecedents.length===0 || (antecedents.length>1 && antecedentOverlap.length===0));
  const quoteMarks=(contextText.match(/["“”‘’]/g)||[]).length;
  const quotedMaterial=quoteMarks>=2 || /\b(?:quoted|quotation|quote|transcript|verbatim)\b/i.test(contextText);
  const attribution=/\b(?:according to|as reported by|[A-Z][A-Za-z .'-]{1,48}\s+(?:said|says|stated|states|claimed|claims|announced|announces|wrote|writes)|the spokesperson|the report|the filing|the document)\b/i.test(contextText);
  const headingParagraphs=included.filter(p=>isHeading(p.text)).map(p=>({paragraphIndex:p.paragraphIndex,excerpt:p.text.slice(0,180)}));
  const definitionTerms=defs.map(d=>d.term);
  const definedSection=spans.some(p=>/^\s*(?:#{1,6}\s*)?(?:definitions?|glossary|terminology)\s*$/i.test(p.text));
  const capitalizedClaimTerms=[...new Set([...(clean(claim).match(/\b[A-Z][a-z][A-Za-z0-9_-]*(?:\s+[A-Z][a-z][A-Za-z0-9_-]*)+\b/g)||[]),...(clean(claim).match(/\b[A-Z]{2,}\b/g)||[])])];
  const definitionDependency=defs.length>0 || (definedSection && capitalizedClaimTerms.length>0);
  const missingDefinitions=definedSection?capitalizedClaimTerms.filter(t=>!definitionTerms.includes(t)): [];
  return {
    contextText,contextStartOffset:start,contextEndOffset:end,contextParagraphIndexes:included.map(p=>p.paragraphIndex),
    contextParagraphCount:included.length,contextClipped:clipped,
    scope:{pronounReferences:pronounTokens,antecedentCandidates:antecedents,antecedentOverlap,pronounAntecedentAmbiguous:antecedentAmbiguous,quotedMaterial,attributionAcrossParagraphs:attribution,headingContextIncluded:headingParagraphs.length>0,headingParagraphs,definitionDependency,definitionTerms,missingDefinitions,definitionContextIncluded:defs.length>0},
    contextVersion:'document_context_v1'
  };
}