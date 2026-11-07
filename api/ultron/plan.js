export const access = 'admin';
export const methods = ['POST'];

const safeUrl = value => {
  try {
    const u = new URL(String(value || ''));
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !h || u.username || u.password ||
      h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '::1' || h.startsWith('[')) return null;
    return u;
  } catch { return null; }
};

function buildPlan(objective, sourceUrls=[]) {
  const text=String(objective||'').trim();
  const lower=text.toLowerCase();
  const wantsClaim=/\b(verify|fact.check|validate|confirm|is it true|claim|contradict|dispute)\b/.test(lower);
  const wantsResearch=/\b(research|investigate|find out|look into|compare|learn|understand|analy[sz]e|study)\b/.test(lower);
  const wantsTask=/\b(create|add|make|remind me|schedule|todo|to.do)\b/.test(lower);
  const title=text.replace(/\s+/g,' ').slice(0,180) || 'New ULTRON mission';
  const steps=[];
  const acceptance=[];
  let status='ready';
  if(wantsClaim) {
    const urls=[...new Set(sourceUrls.map(x=>safeUrl(x)?.toString()).filter(Boolean))].slice(0,4);
    if(urls.length<2) {
      status='needs_sources';
      acceptance.push('Provide at least two distinct public HTTPS source URLs before a claim assessment can run.');
    } else {
      urls.forEach((url,i)=>steps.push({type:'retrieve_source',title:'Capture source '+(i+1),input:{url},depends_on:[]}));
      steps.push({type:'assess_claim',title:'Compare claim against captured sources',input:{claim:text,source_urls:urls},depends_on:urls.map((_,i)=>i+1)});
      acceptance.push('Capture each supplied source and preserve its excerpt, publisher and date.');
      acceptance.push('Screen for supporting passages, publisher independence signals and possible contradictions.');
      acceptance.push('Leave factual verdict pending human review.');
    }
  } else if(wantsResearch) {
    steps.push({type:'research_search',title:'Find relevant public evidence',input:{query:text},depends_on:[]});
    acceptance.push('Return sourced search leads with titles and URLs; do not treat search snippets as verified facts.');
    acceptance.push('Identify evidence gaps and propose the next source-capture step.');
  } else if(wantsTask) {
    const cleaned=text.replace(/^(please\s+)?(?:(?:create|add|make)\s+(?:a\s+)?(?:task|to-do)\s+(?:to\s+)?|schedule\s+|remind me to\s+)/i,'').replace(/[.!?]+$/,'').trim();
    steps.push({type:'create_task',title:'Save the requested follow-up task',input:{title:cleaned.slice(0,180)||title,body:text},depends_on:[]});
    acceptance.push('Persist the requested task and read it back from the owner-scoped task list.');
  } else {
    status='needs_clarification';
    acceptance.push('Clarify whether this is research, a factual claim check, or an action to perform.');
  }
  return {title,objective:text,status,steps,acceptanceCriteria:acceptance,guardrails:['Free public sources only; no paid model or provider calls.','No external messages, purchases, publishing or destructive actions.','Search leads are not factual verification.','Every claim assessment remains subject to human review.'],planner:{mode:'deterministic_rules_v1',modelCalls:0,confidence:'bounded',note:'This planner uses transparent intent patterns, not an LLM. Review the proposed steps before launching.'}};
}

export default async function(req,res) {
  const body=req.body||{};
  const objective=String(body.objective||'').trim().slice(0,2000);
  if(!objective)return res.status(400).json({error:'Provide a mission objective under 2,000 characters.'});
  const sourceUrls=Array.isArray(body.source_urls)?body.source_urls:[];
  if(sourceUrls.length>4)return res.status(400).json({error:'Provide no more than four source URLs.'});
  const plan=buildPlan(objective,sourceUrls);
  return res.json({...plan,previewOnly:true,auditRecorded:false});
}