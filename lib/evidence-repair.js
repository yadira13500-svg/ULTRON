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
  const claimSourceUrls=new Map(rows.filter(s=>s.step_type==='assess_claim').map(s=>[Number(s.position),new Set(arr(s.result?.allSources).map(x=>clean(x.canonicalUrl||x.url)).filter(Boolean))]));
  const oldOrUndated=sourceUrls.filter(url=>{const s=rows.find(x=>x.step_type==='retrieve_source'&&x.result?.url===url)?.result||{};const raw=s.publicationDate?.iso||s.modifiedDate?.iso;return !raw||(Date.now()-Date.parse(raw)>365*86400000)});
  let freshnessLinked=false;
  for(const claim of claims){const urls=oldOrUndated.filter(url=>claimSourceUrls.get(Number(claim.position))?.has(url));if(urls.length){freshnessLinked=true;tasks.push({type:'research_search',title:'Refresh dated evidence for claim '+claim.position,input:{query:safeQuery('Find current authoritative replacements or updates relevant to this claim: '+claim.claim+' Sources: '+urls.slice(0,5).join(' ')+'. Prefer current primary sources and report publication dates.'),repairType:'freshness_refresh',claimPosition:claim.position,claim:claim.claim,sourceUrls:urls.slice(0,5)},depends_on:[]});}}
  if(oldOrUndated.length&&!freshnessLinked)tasks.push({type:'research_search',title:'Refresh dated evidence',input:{query:safeQuery('Find current authoritative replacements or updates for these sources: '+oldOrUndated.slice(0,8).join(' ')+' . Prefer current primary sources and report publication dates.'),repairType:'freshness_refresh',sourceUrls:oldOrUndated.slice(0,8)},depends_on:[]});
  const truncated=sourceUrls.filter(url=>rows.some(x=>x.step_type==='retrieve_source'&&x.result?.url===url&&x.result?.truncated===true));
  let truncationLinked=false;
  for(const claim of claims){const urls=truncated.filter(url=>claimSourceUrls.get(Number(claim.position))?.has(url));if(urls.length){truncationLinked=true;tasks.push({type:'research_search',title:'Find complete sources for claim '+claim.position,input:{query:safeQuery('Find accessible complete versions or official mirrors for this claim: '+claim.claim+' Truncated sources: '+urls.slice(0,5).join(' ')),repairType:'truncated_source_recovery',claimPosition:claim.position,claim:claim.claim,sourceUrls:urls.slice(0,5)},depends_on:[]});}}
  if(truncated.length&&!truncationLinked)tasks.push({type:'research_search',title:'Find complete versions of truncated sources',input:{query:safeQuery('Find accessible complete versions or official mirrors of these truncated sources: '+truncated.slice(0,8).join(' ')),repairType:'truncated_source_recovery',sourceUrls:truncated.slice(0,8)},depends_on:[]});
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
export function buildRepairedClaimAssessmentPlan({sourceRunId,repairRunId,claimPosition,claim,selectedUrls,candidateUrls}){
 const errors=[],normalize=value=>{try{const u=new URL(String(value||'')),host=u.hostname.toLowerCase(),parts=host.split('.').map(Number),ipv4=parts.length===4&&parts.every(Number.isInteger),privateIpv4=ipv4&&(parts[0]===127||parts[0]===10||(parts[0]===192&&parts[1]===168)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===169&&parts[1]===254));if(u.protocol!=='https:'||!host||u.username||u.password||host==='localhost'||host.endsWith('.local')||host.endsWith('.localhost')||host.startsWith('[')||host==='0.0.0.0'||privateIpv4)return null;u.hash='';return u.toString();}catch{return null;}};
 const claimText=clean(claim),position=Number(claimPosition),selected=arr(selectedUrls).map(normalize),candidates=new Set(arr(candidateUrls).map(normalize).filter(Boolean));
 if(!clean(sourceRunId)||!clean(repairRunId))errors.push('Both original and repair mission IDs are required.');
 if(!Number.isInteger(position)||position<1)errors.push('A valid original claim position is required.');
 if(!claimText||claimText.length>600)errors.push('The original claim must contain 1–600 characters.');
 if(arr(selectedUrls).length<2||arr(selectedUrls).length>4)errors.push('Select between two and four research results.');
 if(selected.some(x=>!x))errors.push('Only public HTTPS source URLs can be captured.');
 if(new Set(selected).size!==selected.length)errors.push('Selected source URLs must be unique.');
 if(selected.some(x=>!candidates.has(x)))errors.push('Every selected URL must come from a completed repair search result.');
 const hosts=selected.filter(Boolean).map(x=>new URL(x).hostname.toLowerCase().replace(/^www[.]/,''));
 if(new Set(hosts).size<2)errors.push('Choose sources on two distinct hosts; this is only a diversity screen, not proof of independence.');
 if(errors.length)return {valid:false,errors,steps:[]};
 const steps=selected.map((url,i)=>({position:i+1,type:'retrieve_source',title:'Capture repaired evidence source '+(i+1),input:{url,evidenceRepair:true,sourceRunId,repairRunId,originalClaimPosition:position},depends_on:[]}));
 steps.push({position:steps.length+1,type:'assess_claim',title:'Reassess original claim '+position+' using repaired evidence',input:{claim:claimText,source_urls:selected,evidenceRepair:true,sourceRunId,repairRunId,originalClaimPosition:position},depends_on:selected.map((_,i)=>i+1)});
 return {valid:true,errors:[],steps,sourceCount:selected.length,hostDiversity:new Set(hosts).size,independentOriginsProven:false,factualTruthVerified:false,requiresSeparateVerifier:true};
}