// ULTRON claim-evidence analysis (deterministic, no model calls).
// Screens captured sources against a claim for support, contradiction, source independence,
// freshness and provenance. It never declares a claim "true": every result stays human-reviewed.

const STOP = new Set(['about','after','again','against','also','among','and','are','because','been','being','between','but','can','could','did','does','doing','during','each','for','from','had','has','have','into','its','may','more','most','not','other','over','same','should','some','such','than','that','the','their','there','these','they','this','those','through','under','very','was','were','what','when','where','which','while','with','would','your','will','said','says']);
const NEG_WORDS = new Set(['no','not','never','none','neither','nor','without','cannot','denied','denies','deny','nobody','nothing']);
const UP = new Set(['increase','increased','increases','rise','rose','risen','rises','grow','grew','grown','gain','gained','climb','climbed','surge','surged','higher','up','jump','jumped','expand','expanded','improve','improved']);
const DOWN = new Set(['decrease','decreased','decreases','fall','fell','fallen','falls','drop','dropped','decline','declined','shrink','shrank','lower','down','plunge','plunged','reduce','reduced','cut','shrunk','worsen','worsened']);
const POS = new Set(['approve','approved','confirm','confirmed','allow','allowed','support','supported','pass','passed','win','won','true','safe','effective','legal','open','opened','succeed','succeeded','accept','accepted']);
const NEGV = new Set(['reject','rejected','deny','denied','ban','banned','oppose','opposed','fail','failed','lose','lost','false','unsafe','ineffective','illegal','close','closed','block','blocked','refuse','refused','withdraw','withdrawn']);
const HEDGES = /\b(reportedly|allegedly|alleged|rumou?r(?:ed|s)?|claims?|claimed|may|might|could|possibly|unconfirmed|according to unnamed|appears? to)\b/i;
const WIRES = [['reuters',/\breuters\b/i],['associated press',/\b(associated press|\(ap\)|— ap\b|\bap —)/i],['afp',/\b(agence france-presse|\(afp\)|— afp\b)/i],['bloomberg',/\bbloomberg\b/i],['press trust of india',/\bpress trust of india\b|\(pti\)/i]];

const stem = w => { w = String(w).toLowerCase(); if (w.length > 5) w = w.replace(/(ing|ed|es)$/, ''); if (w.length > 4) w = w.replace(/s$/, ''); return w; };
const words = t => (String(t || '').toLowerCase().replace(/n't\b/g, ' not ').match(/[a-z0-9][a-z0-9']*/g) || []).map(x => x.replace(/'/g, ''));
const contentStems = t => [...new Set(words(t).filter(x => x.length > 2 && !STOP.has(x)).map(stem))];
const numbers = t => [...new Set((String(t || '').match(/\d[\d,]*(?:\.\d+)?/g) || []).map(x => x.replace(/,/g, '')))];
const sentences = t => String(t || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 20).slice(0, 400);

// Evaluate only a standalone, explicit arithmetic equality. No eval/Function, units,
// prose inference, currency conversion, or implicit assumptions are permitted.
export function evaluateExplicitCalculation(input) {
  const raw = String(input || '').trim();
  const match = raw.match(/^\s*([0-9][0-9,]*(?:\.\d+)?(?:\s*[()+*/%\-]\s*[0-9][0-9,]*(?:\.\d+)?|\s*[()+*/%\-])*?)\s*=\s*([0-9][0-9,]*(?:\.\d+)?)\s*$/);
  if (!match) return { status: 'not_evaluated', reason: 'not_a_standalone_explicit_equality' };
  const expression = match[1].replace(/,/g, '');
  const claimed = Number(match[2].replace(/,/g, ''));
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+*/%\-]/g) || [];
  if (!tokens.length || tokens.join('') !== expression.replace(/\s+/g, '')) return { status: 'not_evaluated', reason: 'unsupported_expression_syntax' };
  let i = 0;
  const peek = () => tokens[i];
  const take = () => tokens[i++];
  function primary() {
    if (peek() === '-') { take(); return -primary(); }
    if (peek() === '+') { take(); return primary(); }
    if (peek() === '(') {
      take(); const v = sum();
      if (take() !== ')') throw new Error('unclosed_parenthesis');
      return v;
    }
    const t = take();
    if (t === undefined || !/^\d+(?:\.\d+)?$/.test(t)) throw new Error('expected_number');
    let v = Number(t);
    while (peek() === '%') { take(); v /= 100; }
    return v;
  }
  function product() {
    let v = primary();
    while (peek() === '*' || peek() === '/') {
      const op = take(), rhs = primary();
      if (op === '/' && rhs === 0) throw new Error('division_by_zero');
      v = op === '*' ? v * rhs : v / rhs;
    }
    return v;
  }
  function sum() {
    let v = product();
    while (peek() === '+' || peek() === '-') {
      const op = take(), rhs = product();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }
  try {
    const calculated = sum();
    if (i !== tokens.length || !Number.isFinite(calculated) || !Number.isFinite(claimed)) {
      return { status: 'not_evaluated', reason: 'invalid_or_non_finite_expression' };
    }
    const tolerance = Math.max(1e-9, Math.abs(calculated) * 1e-9);
    const matches = Math.abs(calculated - claimed) <= tolerance;
    return { status: 'evaluated', expression, calculated, claimed, matches, difference: Number((claimed - calculated).toPrecision(12)) };
  } catch (error) {
    return { status: 'not_evaluated', reason: String(error?.message || error) };
  }
}

export function registrableDomain(host) {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const compound = new Set(['co.uk', 'org.uk', 'com.au', 'co.nz', 'co.ke', 'com.br', 'co.jp', 'com.sg', 'co.za', 'co.in']);
  return compound.has(parts.slice(-2).join('.')) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

function polarityNearTerms(sentence, termSet) {
  const toks = words(sentence);
  const termIdx = [], negIdx = [];
  toks.forEach((w, i) => { if (termSet.has(stem(w))) termIdx.push(i); if (NEG_WORDS.has(w)) negIdx.push(i); });
  return negIdx.some(n => termIdx.some(t => Math.abs(n - t) <= 6));
}
function axis(sentenceToks, SET_A, SET_B) {
  const a = sentenceToks.some(w => SET_A.has(w)), b = sentenceToks.some(w => SET_B.has(w));
  return a && !b ? 'a' : b && !a ? 'b' : null;
}

export function analyzeSentence(claim, sentence) {
  const cTerms = contentStems(claim), sTerms = new Set(contentStems(sentence));
  if (!cTerms.length) return { coverage: 0 };
  const hit = cTerms.filter(x => sTerms.has(x));
  const coverage = hit.length / cTerms.length;
  const caps = (String(claim).match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []).filter(x => !STOP.has(x.toLowerCase())).map(x => stem(x));
  const entityCoverage = caps.length ? caps.filter(x => sTerms.has(x)).length / caps.length : 1;
  const cToks = words(claim), sToks = words(sentence);
  const termSet = new Set(hit);
  const claimNeg = polarityNearTerms(claim, new Set(cTerms)), sentNeg = polarityNearTerms(sentence, termSet);
  const polarityMismatch = coverage >= 0.5 && claimNeg !== sentNeg;
  const dirC = axis(cToks, UP, DOWN), dirS = axis(sToks, UP, DOWN);
  const valC = axis(cToks, POS, NEGV), valS = axis(sToks, POS, NEGV);
  const directionConflict = coverage >= 0.5 && dirC && dirS && dirC !== dirS;
  const valenceConflict = coverage >= 0.5 && valC && valS && valC !== valS;
  const cn = numbers(claim), sn = numbers(sentence);
  const numberMatch = cn.length ? cn.every(n => sn.includes(n)) : null;
  const numberConflict = coverage >= 0.5 && cn.length > 0 && sn.length > 0 && !cn.every(n => sn.includes(n));
  return { coverage: Number(coverage.toFixed(3)), entityCoverage: Number(entityCoverage.toFixed(3)), matchedTerms: hit, polarityMismatch, directionConflict: !!directionConflict, valenceConflict: !!valenceConflict, numberMatch, numberConflict, hedged: HEDGES.test(sentence) };
}

export function stanceOf(a) {
  if (!a || a.coverage < 0.4 || a.entityCoverage < 0.5) return 'not_addressed';
  if (a.polarityMismatch || a.directionConflict || a.valenceConflict || a.numberConflict) return 'contradicts_candidate';
  if (a.coverage >= 0.6 && a.numberMatch !== false) return a.hedged ? 'related_unclear' : 'supports_candidate';
  return 'related_unclear';
}

function shingles(text, n = 6) {
  const toks = words(text).slice(0, 1500), set = new Set();
  for (let i = 0; i + n <= toks.length; i++) set.add(toks.slice(i, i + n).join(' '));
  return set;
}
function jaccardAndContainment(a, b) {
  if (!a.size || !b.size) return { jaccard: 0, containment: 0 };
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return { jaccard: inter / (a.size + b.size - inter), containment: inter / Math.min(a.size, b.size) };
}

export function sourceIndependence(sources) {
  const n = sources.length, parent = [...Array(n).keys()];
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (i, j, reason, links) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; links.push({ a: i, b: j, reason }); };
  const links = [];
  const sh = sources.map(s => shingles(s.excerpt));
  const domain = sources.map(s => registrableDomain(s.host || (() => { try { return new URL(s.url).hostname; } catch { return ''; } })()));
  const pub = sources.map(s => String(s.publisher || '').toLowerCase().replace(/\s+(inc|llc|ltd|limited|corp|corporation)\.?$/, '').trim());
  const canon = sources.map(s => { try { const u = new URL(s.canonicalUrl || s.url); return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, ''); } catch { return ''; } });
  const wires = sources.map(s => WIRES.filter(([, re]) => re.test(String(s.excerpt || '').slice(0, 6000))).map(([name]) => name));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (domain[i] && domain[i] === domain[j]) union(i, j, 'same registrable domain', links);
    else if (pub[i] && pub[i] === pub[j]) union(i, j, 'same declared publisher', links);
    if (canon[i] && canon[i] === canon[j]) union(i, j, 'same canonical page', links);
    const { jaccard, containment } = jaccardAndContainment(sh[i], sh[j]);
    if (jaccard >= 0.2 || containment >= 0.5) union(i, j, 'near-identical text (' + Math.round(Math.max(jaccard, containment) * 100) + '% shared phrasing), likely syndication or copying', links);
    const sharedWire = wires[i].find(w => wires[j].includes(w));
    if (sharedWire) union(i, j, 'both attribute reporting to ' + sharedWire, links);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  return { independentGroupCount: groups.size, groups: [...groups.values()].map(idx => ({ sourceIndexes: idx, urls: idx.map(i => sources[i].url), reasons: links.filter(l => idx.includes(l.a) && idx.includes(l.b)).map(l => l.reason) })), note: 'Heuristic signals (shared domain/publisher/canonical page, copied phrasing, common wire attribution). They cannot prove editorial or ownership independence.' };
}

export function freshness(source, now = Date.now()) {
  const iso = (source.modifiedDate && source.modifiedDate.iso) || (source.publicationDate && source.publicationDate.iso) || null;
  if (!iso) return { state: 'undated', ageDays: null };
  const age = Math.floor((now - Date.parse(iso)) / 86400000);
  if (age < 0) return { state: 'future_dated', ageDays: age };
  return { state: age <= 180 ? 'fresh' : age <= 730 ? 'aging' : 'stale', ageDays: age };
}

export function provenance(source) {
  const flags = [];
  const checks = { https: String(source.url || '').startsWith('https://'), canonical: !!source.canonicalUrl, publisher: !!source.publisher, date: !!(source.publicationDate && source.publicationDate.iso), title: !!source.title };
  for (const [k, ok] of Object.entries(checks)) if (!ok) flags.push('missing_' + k);
  return { score: Object.values(checks).filter(Boolean).length / 5, flags };
}

export function analyzeClaimEvidence(claim, sources, now = Date.now()) {
  const perSource = sources.map((s, index) => {
    let best = { score: -1, sentence: '', a: { coverage: 0 } };
    for (const sentence of sentences(s.excerpt)) {
      const a = analyzeSentence(claim, sentence);
      const conflictBonus = (a.polarityMismatch || a.directionConflict || a.valenceConflict || a.numberConflict) ? 0.05 : 0;
      const score = a.coverage + (a.entityCoverage || 0) * 0.15 + conflictBonus + (a.numberMatch ? 0.1 : 0);
      if (score > best.score) best = { score, sentence, a };
    }
    const stance = stanceOf(best.a);
    return { index, url: s.url, host: s.host || '', stance, excerpt: best.sentence.slice(0, 700), coverage: best.a.coverage || 0, matchedTerms: best.a.matchedTerms || [], signals: { polarityMismatch: !!best.a.polarityMismatch, directionConflict: !!best.a.directionConflict, valenceConflict: !!best.a.valenceConflict, numberConflict: !!best.a.numberConflict, numberMatch: best.a.numberMatch ?? null, hedged: !!best.a.hedged }, freshness: freshness(s, now), provenance: provenance(s) };
  });
  const independence = sourceIndependence(sources);
  const groupOf = i => independence.groups.findIndex(g => g.sourceIndexes.includes(i));
  const supporters = perSource.filter(x => x.stance === 'supports_candidate');
  const contradictors = perSource.filter(x => x.stance === 'contradicts_candidate');
  const supportGroups = new Set(supporters.map(x => groupOf(x.index))).size;
  const contradictGroups = new Set(contradictors.map(x => groupOf(x.index))).size;
  let status = 'insufficient_evidence';
  if (contradictors.length && supporters.length) status = 'conflicting_evidence';
  else if (contradictors.length) status = 'contradicted_candidate';
  else if (supportGroups >= 2) status = 'evidence_candidates_found';
  const reasons = [];
  if (supporters.length > supportGroups) reasons.push('Supporting sources collapse to ' + supportGroups + ' independent origin(s); copies or shared attribution do not count twice.');
  if (supportGroups < 2 && !contradictors.length) reasons.push('Fewer than two independent supporting origins were found.');
  if (contradictors.length) reasons.push(contradictors.length + ' source(s) contain wording that may contradict the claim (' + contradictGroups + ' independent origin(s)). Human inspection required.');
  const stale = perSource.filter(x => x.freshness.state === 'stale' || x.freshness.state === 'undated').length;
  if (stale) reasons.push(stale + ' source(s) are stale or undated; recency of the claim is not established.');
  const lowProv = perSource.filter(x => x.provenance.score < 0.6).length;
  if (lowProv) reasons.push(lowProv + ' source(s) have thin provenance metadata (publisher, date or canonical URL missing).');
  if (supporters.some(x => x.signals.hedged)) reasons.push('Some matching passages are hedged (reportedly, may, alleged) and were not counted as support.');
  return { status, confidenceBand: status === 'evidence_candidates_found' && !stale && !lowProv ? 'moderate' : 'low', supportingSourceCount: supporters.length, contradictingSourceCount: contradictors.length, independentSupportGroups: supportGroups, independentContradictGroups: contradictGroups, perSource, independence, reasons, verified: false, limits: 'Keyword, polarity, number and phrasing screens only. This is not entailment checking, fact-checking or proof of truth; a human reviewer decides.' };
}