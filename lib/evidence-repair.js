const arr=v=>Array.isArray(v)?v:[];
const clean=v=>String(v??'').trim();
const hostOf=value=>{try{return new URL(String(value)).hostname.toLowerCase().replace(/^www\\./,'')}catch{return ''}};
const safeQuery=s=>clean(s).replace(/\\s+/g,' ').slice(0,300);
export function buildEvidenceRepairProposal(run,steps,intelligence){
  const rows=arr(steps),claims=arr(intelligence?.evidence?.claims),sources=arr(intelligence?.evidence?.groups).flatMap(g=>arr(g.urls).map(url=>({url,group:g.group})));
  const tasks=[],sourceUrls=[...new Set(sources.map(s=>s.url).filter(Boolean))];
  for(const claim of claims.filter(c=>c.independentPublisherGroups<2||c.supportingCandidates<2)){
    const excluded=[...new Set(sourceUrls.map(hostOf).filter(Boolean))];
    const query=safeQuery('Find primary and independently originated sources that directly address this claim: '+claim.claim+'. Prefer official records, original research and publishers not represented by these existing sources: '+excluded.join(', ')+'. Do not treat syndicated copies as independent.');
    tasks.push({type:'research_search',title:'Find independent evidence for claim '+claim.position,input:{query,repairType:'independent_source_gap',claimPosition:claim.position,claim:claim.claim,excludeHosts:excluded,sourceUrls},depends_on:[]});
  }
  for(const claim of claims.filter(c=>c.conflictCount>0||c.contradictingCandidates>0)){
    tasks.push({type:'research_search',title:'Investigate conflicting evidence for claim '+claim.position,input:{query:safeQuery('Investigate the conflicting passages and definitions for this claim: '+claim.claim+'. Locate original documents and dated primary sources; compare scope, dates and terminology.'),repairType:'conflict_investigation',claimPosition:claim.position,claim:claim.claim,conflicts:arr(claim.conflicts).slice(0,6)},depends_on:[]});
  }
  const oldOrUndated=sourceUrls.filter(url=>{const s=rows.find(x=>x.step_type==='retrieve_source'&&x.result?.url===url)?.result||{};const raw=s.publicationDate?.iso||s.modifiedDate?.iso;return !raw||(Date.now()-Date.parse(raw)>365*86400000)});
  if(oldOrUndated.length)tasks.push({type:'research_search',title:'Refresh dated evidence',input:{query:safeQuery('Find current authoritative replacements or updates for these sources: '+oldOrUndated.slice(0,8).join(' ')+' . Prefer current primary sources and report publication dates.'),repairType:'freshness_refresh',sourceUrls:oldOrUndated.slice(0,8)},depends_on:[]});
  const truncated=sourceUrls.filter(url=>rows.some(x=>x.step_type==='retrieve_source'&&x.result?.url===url&&x.result?.truncated===true));
  if(truncated.length)tasks.push({type:'research_search',title:'Find complete versions of truncated sources',input:{query:safeQuery('Find accessible complete versions or official mirrors of these truncated sources: '+truncated.slice(0,8).join(' ')),repairType:'truncated_source_recovery',sourceUrls:truncated.slice(0,8)},depends_on:[]});
  if(arr(intelligence?.specialistReview?.failedChecks).length)tasks.push({type:'research_search',title:'Resolve independent verifier challenges',input:{query:safeQuery('Gather additional independent evidence to address these verifier challenges: '+arr(intelligence.specialistReview.failedChecks).map(x=>arr(x.challenge).join('; ')).join(' | ')),repairType:'verifier_challenge_resolution'},depends_on:[]});
  const unique=tasks.filter((t,i)=>tasks.findIndex(x=>x.input.repairType===t.input.repairType&&x.input.claimPosition===t.input.claimPosition)===i).slice(0,12).map((t,i)=>({...t,position:i+1}));
  return {version:'evidence_repair_v1',sourceRunId:run.id,sourceMissionTitle:clean(run.title),objective:'Repair identified evidence gaps while preserving the original mission findings. New leads are candidates until captured and separately assessed.',tasks:unique,sourceSnapshot:sourceUrls.slice(0,30),requiresOwnerApproval:true,automaticExecution:false,limitations:['Search results are leads, not captured evidence.','Host exclusions are explicit search guidance, not a guaranteed provider-side filter.','Publisher grouping is heuristic and does not prove independence.','A revised claim assessment requires capturing selected sources and a separate claim-verification pass.']};
}
export function verifyEvidenceRepairProposal(proposal){
 const errors=[];
 if(proposal?.version!=='evidence_repair_v1')errors.push('Unsupported repair proposal version.');
 if(!Array.isArray(proposal?.tasks)||proposal.tasks.length<1||proposal.tasks.length>12)errors.push('A repair proposal must contain 1–12 bounded tasks.');
 const seen=new Set();
 for(const t of arr(proposal?.tasks)){if(t.type!=='research_search'||!clean(t.input?.query)||clean(t.input.query).length>300)errors.push('Repair tasks must be bounded research searches.');const key=t.input?.repairType+':'+(t.input?.claimPosition||'');if(seen.has(key))errors.push('Duplicate repair task identity.');seen.add(key);}
 return {passed:errors.length===0,errors,taskCount:arr(proposal?.tasks).length,independentVerifierRequired:true,factualTruthVerified:false};
}