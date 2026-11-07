// ULTRON mission planner v2: transparent rules, no model calls.
// Turns a plain-language objective into a validated step graph with measurable acceptance checks.
// Search leads are never treated as facts; unsupported consequential actions are refused, not planned.

const URL_RE = /https:\/\/[^\s<>"'”)\]]+/gi;

export function safeUrl(value) {
  try {
    const u = new URL(String(value || '')); const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || !h || u.username || u.password || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
      /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h) || h === '::1' || h.startsWith('[')) return null;
    return u;
  } catch { return null; }
}

const INTENT = {
  claim: /\b(verify|fact[- ]?check|validate|debunk|is it true|is (?:it|this|that) (?:true|accurate|correct|real)|check (?:whether|if|that)|confirm (?:that|whether|if)|myth|hoax|rumou?r)\b/i,
  research: /\b(research|investigate|find out|look into|look up|learn about|learn how|understand|analy[sz]e|study|compare|explain|summari[sz]e|what (?:is|are|was|were|happened)|how (?:does|do|did)|why (?:is|are|did|does))\b/i,
  task: /\b(remind me|reminder|add (?:a )?(?:task|to-?do)|create (?:a )?(?:task|to-?do)|follow[- ]?up|schedule|don'?t let me forget)\b/i,
  save: /\b(save|remember|store|keep a note|add to (?:my )?(?:knowledge|library)|note down)\b/i,
  checkLink: /\b(is (?:this|the|that) (?:link|site|page|url|website) (?:up|working|reachable|live|online)|check (?:the |this )?(?:link|url)|reachab)/i
};
const BLOCKED = /(?:^|[.;]\s*|\band\s+|\bthen\s+|please\s+)(send|email|e-mail|text|message|whatsapp|tweet|post|publish|pay|buy|purchase|order|transfer|wire|delete|book|reserve|sign up|subscribe)\b/i;

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => clean(s).slice(0, n);
const contentWords = s => (clean(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter(w => !['the','and','that','this','with','for','are','was','were','has','have','you','your','please','then','from','about'].includes(w));

export function extractClaim(text) {
  const quoted = String(text).match(/[“"]([^”"]{15,600})[”"]/);
  if (quoted) return clean(quoted[1]);
  let t = clean(String(text).replace(URL_RE, ' ')).replace(/^(please\s+|can you\s+|could you\s+|i want you to\s+|i need you to\s+)/i, '');
  const m = t.match(/(?:verify|fact[- ]?check|validate|debunk|confirm|check)(?:\s+(?:whether|if|that|the claim(?: that)?))?\s*[:,-]?\s*(.+)$/i)
    || t.match(/is it true (?:that\s+)?(.+)$/i) || t.match(/claim(?:s|ed)? (?:that\s+)?(.+)$/i);
  let claim = (m ? m[1] : t);
  claim = claim.replace(/\s*(?:,|;|\band\b)\s*(?:then\s+)?(?:remind me|add (?:a )?(?:task|to-?do)|create (?:a )?(?:task|to-?do)|save (?:it|this|that|the result)|research|follow[- ]?up)\b.*$/i, '');
  return clip(claim.replace(/[?.!]+$/, ''), 600);
}
export function extractResearchQuery(text) {
  let t = clean(String(text).replace(URL_RE, ' ')).replace(/^(please\s+|can you\s+|could you\s+)/i, '');
  t = t.replace(/^(research|investigate|find out(?: about)?|look into|look up|learn about|learn how|study|analy[sz]e|compare|explain|summari[sz]e|understand)\s+/i, '');
  t = t.replace(/\s*(?:,|;|\band\b)\s*(?:then\s+)?(?:remind me|add (?:a )?(?:task|to-?do)|create (?:a )?(?:task|to-?do)|save (?:it|this|that)|follow[- ]?up)\b.*$/i, '');
  return clip(t.replace(/[?.!]+$/, ''), 300);
}
export function buildResearchQueries(objective) {
  const base=extractResearchQuery(objective);
  const dimensions=[
    {pattern:/market demand|customer demand|market size|customers|consumer trends|competitors/i,suffix:'market demand, market size, customer segments, competitors and market trends'},
    {pattern:/costs?|budget|pricing|financial|revenue|profit|investment|economics/i,suffix:'startup and operating costs, pricing, revenue assumptions and unit economics'},
    {pattern:/regulat|compliance|licen[cs]|legal requirements|permits|lawful|statutory/i,suffix:'regulatory requirements, permits, licensing, compliance and legal constraints'},
    {pattern:/risks?|threats?|uncertaint|downside|failure modes|mitigation/i,suffix:'market, operational, financial and legal risks and mitigation options'}
  ];
  const selected=dimensions.filter(d=>d.pattern.test(objective));
  if(selected.length<2)return [clip(base,300)];
  const prefix=clip(base,140);
  return selected.slice(0,4).map(d=>clip(prefix+' — '+d.suffix,300));
}
export function extractTaskTitle(text, fallback) {
  const m = clean(text).match(/(?:remind me to|add (?:a )?(?:task|to-?do) to|create (?:a )?(?:task|to-?do) to|add (?:a )?(?:task|to-?do)\s*[:,]?|follow[- ]?up (?:on|with)|schedule)\s+(.+?)(?:[.;]\s|[.;]?$)/i);
  return clip(m ? m[1].replace(/[?.!]+$/, '') : fallback, 180);
}

export function planMission(objective, sourceUrlsIn = []) {
  const text = clean(objective).slice(0, 2000);
  const lower = text.toLowerCase();
  const found = (text.match(URL_RE) || []).map(u => u.replace(/[.,;]+$/, ''));
  const urls = [...new Set([...found, ...sourceUrlsIn].map(u => safeUrl(u)?.toString()).filter(Boolean))].slice(0, 4);
  const intents = Object.fromEntries(Object.entries(INTENT).map(([k, re]) => [k, re.test(text)]));
  const unsupported = [];
  const blocked = text.match(BLOCKED);
  if (blocked && !/remind me to\s+\w+\s*$/i.test(text.slice(0, blocked.index))) unsupported.push('"' + blocked[1].toLowerCase() + '" is a consequential external action. ULTRON will not do it inside a mission; use chat to prepare an approval request you confirm yourself.');
  const steps = [], criteria = [], questions = [], assumptions = [];
  const add = (type, title, input, depends_on = []) => { steps.push({ type, title: clip(title, 180), input, depends_on }); return steps.length; };
  const crit = (text, check) => criteria.push({ text, check });
  let topicStep = null;

  // 1. Claim verification
  if (intents.claim) {
    const claim = extractClaim(text);
    if (contentWords(claim).length < 3) { questions.push('What exact statement should be fact-checked? Put it in quotes or after "verify that".'); }
    else if (urls.length >= 2) {
      const caps = urls.map((u, i) => add('retrieve_source', 'Capture source ' + (i + 1), { url: u }));
      add('assess_claim', 'Compare the claim against the captured sources', { claim, source_urls: urls }, caps);
      assumptions.push('Using the ' + urls.length + ' source URLs you supplied.');
    } else {
      const s1 = add('research_search', 'Find candidate public sources', { query: claim.slice(0, 280) });
      topicStep = s1;
      questions.push('Review the search leads and provide or approve at least two public HTTPS source URLs before ULTRON performs a claim assessment. Search ranking and snippets are not evidence.');
      assumptions.push('No source URLs were supplied. ULTRON will gather leads first and will not invent source-capture steps or claim that a search result has been verified.');
    }
    if (steps.some(s => s.type === 'assess_claim')) {
      crit('Capture at least two sources with excerpt, publisher and date metadata.', { type: 'sources_captured', min: 2 });
      crit('Report whether the supporting sources are independent origins (not copies or shared wire reports).', { type: 'independent_origins', min: 2 });
      crit('List any contradiction candidates for human inspection.', { type: 'contradictions_reviewed' });
      crit('Leave the factual verdict pending human review.', { type: 'human_review' });
    }
  }

  // 2. Research (skipped when the claim path already searched)
  if (intents.research && !intents.claim) {
    const query = extractResearchQuery(text);
    if (contentWords(query).length < 1) questions.push('What topic should ULTRON research?');
    else {
      const queries=buildResearchQueries(text);
      queries.forEach((q,i)=>{const position=add('research_search',queries.length>1?'Research dimension '+(i+1)+' of '+queries.length:'Find relevant public evidence',{query:q});if(i===0)topicStep=position;});
      if (urls.length) urls.slice(0, 2).forEach((u, i) => add('retrieve_source', 'Capture supplied source ' + (i + 1), { url: u }));
      crit(queries.length>1?'Return at least one search lead for each identified research dimension.':'Return sourced search leads with titles and URLs, without treating snippets as verified facts.', { type: 'search_results', min: queries.length, perStep: queries.length>1 });
      if (urls.length) crit('Capture each supplied source with its excerpt and metadata.', { type: 'sources_captured', min: Math.min(urls.length, 2) });
    }
  }

  // 3. Link reachability
  if (intents.checkLink && urls.length && !intents.claim) {
    urls.slice(0, 3).forEach((u, i) => add('verify_url', 'Check link ' + (i + 1) + ' is reachable', { url: u }));
    crit('Report reachability for each link. Reachability does not prove page accuracy.', { type: 'steps_completed', stepType: 'verify_url' });
  }

  // 4. Save knowledge (only from a captured source or owner-supplied wording)
  if (intents.save && !intents.task) {
    const savedUrl = urls[0];
    const topic = clip(extractResearchQuery(text) || text, 240);
    if (savedUrl) {
      const cap = steps.find(s => s.type === 'retrieve_source' && s.input.url === savedUrl);
      const capPos = cap ? steps.indexOf(cap) + 1 : add('retrieve_source', 'Capture the source to save', { url: savedUrl });
      add('save_learning', 'Save sourced note to the knowledge library', { topic, source_url: savedUrl }, [capPos]);
      crit('Persist the note and read it back from the knowledge library.', { type: 'knowledge_persisted' });
    } else if (!steps.length) questions.push('Which source URL, or what exact note, should be saved?');
    else assumptions.push('Nothing was saved automatically: a note needs a captured source URL or wording you provide.');
  }

  // 5. Task / reminder
  if (intents.task) {
    const fallback = 'Follow up: ' + clip(extractResearchQuery(text) || text, 150);
    const title = extractTaskTitle(text, fallback);
    add('create_task', 'Save the follow-up task', { title, body: clip(text, 1900) }, topicStep ? [steps.length] : []);
    crit('Persist the task and read it back from the owner-scoped list.', { type: 'task_persisted' });
  }

  let status = 'ready';
  if (!steps.length) { status = unsupported.length ? 'blocked_action' : 'needs_clarification'; if (!questions.length) questions.push('Is this a topic to research, a statement to fact-check, a reminder to save, or a link to check?'); }
  else if (questions.length) status = 'needs_clarification';
  else if (unsupported.length) status = 'ready_with_limits';
  if (steps.length > 16) { steps.length = 16; assumptions.push('The plan was trimmed to 16 steps.'); }

  const kinds = Object.entries(intents).filter(([, v]) => v).length;
  const confidence = status === 'needs_clarification' || status === 'blocked_action' ? 'low' : kinds === 1 && !assumptions.length ? 'high' : 'medium';
  return {
    title: clip(text, 180) || 'New ULTRON mission', objective: text, status, intents, steps,
    acceptanceCriteria: criteria.map(c => c.text), acceptanceChecks: criteria,
    clarifyingQuestions: questions, assumptions, unsupportedRequests: unsupported,
    guardrails: ['Free public sources only; no paid model or provider calls.', 'No external messages, purchases, publishing or destructive actions.', 'Search leads are not factual verification.', 'Every claim assessment stays subject to human review.'],
    planner: { mode: 'deterministic_rules_v2', modelCalls: 0, confidence, note: 'Transparent intent rules, not an LLM. Review the steps before launching.' }
  };
}