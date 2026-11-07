const arr=v=>Array.isArray(v)?v:[];
const clean=v=>String(v??'').trim();
function hostOf(value){try{return new URL(String(value)).hostname.toLowerCase().replace(/^www\\./,'')}catch{return ''}}
function publisherKey(source){const publisher=clean(source.publisher).toLowerCase().replace(/\\s+(inc|llc|ltd|limited|corporation|corp)\\.?$/,'');if(publisher)return 'publisher:'+publisher;const host=hostOf(source.canonicalUrl||source.url);const p=host.split('.').filter(Boolean);return 'host:'+(p.length>2?p.slice(-2).join('.'):host)}
function sourceDate(source){const raw=source.publicationDate?.iso||source.modifiedDate?.iso||null;const n=raw?Date.parse(raw):NaN;return Number.isFinite(n)?n:null}
function dedupeSources(steps){
 const map=new Map();
 for(const step of steps){const r=step.result||{};if(step.step_type!=='retrieve_source'||r.retrieved!==true||!r.url)continue;
  const key=clean(r.canonicalUrl||r.url);if(!map.has(key))map.set(key,{url:r.url,canonicalUrl:r.canonicalUrl||null,title:r.title||'',publisher:r.publisher||null,host:hostOf(r.url),publicationDate:r.publicationDate||null,modifiedDate:r.modifiedDate||null,retrievedAt:r.retrievedAt||null,excerptLength:clean(r.excerpt).length,sourceStepPosition:Number(step.position),truncated:r.truncated===true});
 }
 return [...map.values()];
}
export function buildMissionIntelligence(steps,acceptance=null,specialistTasks=[]){
 const rows=arr(steps).slice().sort((a,b)=>Number(a.position)-Number(b.position));
 const sources=dedupeSources(rows),groupMap=new Map();
 for(const s of sources){const k=publisherKey(s);if(!groupMap.has(k))groupMap.set(k,[]);groupMap.get(k).push(s);}
 const claims=rows.filter(s=>s.step_type==='assess_claim'&&s.status==='completed').map(s=>{
  const a=s.result||{},deep=a.deepAnalysis||{},per=arr(deep.perSource);
  const support=Number(deep.supportingSourceCount??per.filter(x=>x.stance==='supports_candidate').length);
  const contradict=Number(deep.contradictingSourceCount??per.filter(x=>x.stance==='contradicts_candidate').length);
  const unclear=per.filter(x=>!['supports_candidate','contradicts_candidate'].includes(x.stance)).length;
  const urls=arr(a.allSources).map(x=>clean(x.canonicalUrl||x.url)).filter(Boolean);
  const groupCount=Number(deep.independentSupportGroups??new Set(arr(a.allSources).map(publisherKey)).size);
  const conflicts=arr(a.contradictionCandidates).map(c=>({sourceA:c.sourceA||c.source||null,sourceB:c.sourceB||null,signal:clean(c.reason||c.excerpt||c.signals?.join?.('; ')||'Potential disagreement between captured sources').slice(0,420),reviewRequired:true}));
  const status=clean(deep.status||a.assessmentStatus||'unknown');
  return {position:Number(s.position),claim:clean(a.claim||s.input?.claim||s.title).slice(0,600),status,sources:urls.length,independentPublisherGroups:groupCount,supportingCandidates:support,contradictingCandidates:contradict,unclearSources:unclear,conflictCount:conflicts.length,conflicts:conflicts.slice(0,8),reasons:arr(deep.reasons).slice(0,8),humanReviewRequired:true};
 });
 const conflicts=claims.flatMap(c=>c.conflicts.map(x=>({...x,claimPosition:c.position,claim:c.claim})));
 const dated=sources.map(s=>({source:s,date:sourceDate(s)}));
 const unknownDates=dated.filter(x=>x.date===null).length;
 const older=dated.filter(x=>x.date!==null&&Date.now()-x.date>365*86400000).length;
 const truncated=sources.filter(s=>s.truncated).length;
 const verifierFailures=arr(specialistTasks).filter(t=>t.phase==='verification'&&(t.status==='failed'||t.verification?.passed===false)).map(t=>({stepId:t.step_id,role:t.specialist_role,challenge:arr(t.verification?.challenge).slice(0,5),error:clean(t.error).slice(0,240)}));
 const executionRecords=arr(specialistTasks).filter(t=>t.phase==='execution').length;
 const publisherGroups=[...groupMap.entries()].map(([key,list])=>({group:key,sourceCount:list.length,urls:list.map(s=>s.url)}));
 const totalClaims=claims.length,thinClaims=claims.filter(c=>c.independentPublisherGroups<2||c.supportingCandidates<2).length;
 const unresolvedClaims=claims.filter(c=>c.contradictingCandidates>0||c.conflictCount>0||!['evidence_candidates_found'].includes(c.status)).length;
 const suggestions=[];
 if(totalClaims&&thinClaims)suggestions.push({priority:'high',action:'add_independent_sources',detail:thinClaims+' claim assessment(s) lack two independent publisher groups or two supporting candidates.'});
 if(conflicts.length||claims.some(c=>c.contradictingCandidates>0))suggestions.push({priority:'high',action:'inspect_conflicts',detail:'Compare the original passages, dates, definitions and publisher ownership before resolving disagreements.'});
 if(unknownDates)suggestions.push({priority:'medium',action:'check_publication_dates',detail:unknownDates+' captured source(s) have no usable publication or modification date.'});
 if(older)suggestions.push({priority:'medium',action:'refresh_older_sources',detail:older+' source(s) have declared dates older than one year; relevance depends on the topic.'});
 if(truncated)suggestions.push({priority:'medium',action:'inspect_truncated_sources',detail:truncated+' source(s) were truncated during capture.'});
 if(verifierFailures.length)suggestions.push({priority:'high',action:'resolve_verifier_challenges',detail:verifierFailures.length+' independent verifier record(s) failed or remain rejected.'});
 const unmet=Number(acceptance?.counts?.unmet||0),review=Number(acceptance?.counts?.needs_review||0);
 const factualDecision=verifierFailures.length?'verification_challenges_open':conflicts.length||claims.some(c=>c.contradictingCandidates>0)||claims.some(c=>c.status==='conflicting_evidence'||c.status==='contradicted_candidate')?'conflicts_or_claims_need_review':totalClaims&&(thinClaims||unresolvedClaims)?'insufficient_independent_support':totalClaims?'evidence_screen_complete_human_review_required':'not_assessed';
 const readiness=unmet>0?'acceptance_criteria_unmet':review>0?'acceptance_review_pending':factualDecision==='verification_challenges_open'?'specialist_verification_incomplete':factualDecision==='conflicts_or_claims_need_review'?'evidence_conflicts_need_review':factualDecision==='insufficient_independent_support'?'evidence_insufficient':'operational_and_evidence_review';
 return {version:'mission_intelligence_v2',decisionReadiness:readiness,
  factualAssessment:{status:factualDecision,claimCount:totalClaims,claimsNeedingMoreEvidence:thinClaims,claimsWithUnresolvedSignals:unresolvedClaims,conflictSignals:conflicts.length,verifiedTruth:false},
  evidence:{capturedSources:sources.length,canonicalSourceCount:new Set(sources.map(s=>s.canonicalUrl||s.url)).size,distinctHosts:new Set(sources.map(s=>s.host).filter(Boolean)).size,independentPublisherGroups:publisherGroups.length,groups:publisherGroups,undatedSources:unknownDates,olderThanOneYear:older,truncatedSources:truncated,claims},
  specialistReview:{verificationChallenges:verifierFailures.length,failedChecks:verifierFailures,executionSpecialistRecords:executionRecords},
  recommendedNextSteps:suggestions,acceptance:{status:acceptance?.status||'not_evaluated',unmet,needsReview:review},
  limitations:['Publisher and domain grouping are heuristic signals, not proof of editorial independence.','Publication dates are page-declared and may be absent or inaccurate.','Keyword, polarity and numeric signals do not establish semantic entailment.','Operational verification does not establish factual truth. Human review remains required.']};
}