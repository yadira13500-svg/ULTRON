/* ULTRON voice engine v2
   Loaded after app.js. Replaces the fragile browser-only voice code with:
   - Hearing: server Whisper when the AI brain + OpenAI key are active (works in iPhone Home Screen mode),
              otherwise the browser speech recognizer (Safari tab / Chrome / Edge).
   - Speaking: deep premium voice (OpenAI "onyx") when available, otherwise the best deep male device voice.
   - Microphone test, clear error messages, and a smarter offline brain for direct commands. */
(() => {
'use strict';
const q = s => document.querySelector(s);
const UA = navigator.userAgent || '';
const IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const BROWSER_SR_OK = !!SR && !(IOS && STANDALONE);
const V = { cap: null, capAt: 0, stream: null, ctx: null, audio: null, voice: null, session: 0, ttsBad: false, unlocked: false, curFinish: null, stopRec: null, safety: null };

const setStatus = t => { const e = q('#chatStatus'); if (e) e.textContent = t; };
const note = t => { try { toast(t); } catch {} };
const core = () => q('#ultronTalk');

const style = document.createElement('style');
style.textContent = '#ultronTalk.speaking{animation:ultronSpeak 1s ease-in-out infinite}@keyframes ultronSpeak{0%,100%{filter:brightness(1)}50%{filter:brightness(1.7)}}.miclevel{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin:8px 0}.miclevel i{display:block;height:100%;width:0;background:#4de1ff;transition:width .08s}';
document.head.appendChild(style);

/* ---------- capability probe (premium voice needs AI brain on + OpenAI key) ---------- */
async function probe(force) {
  if (!force && V.cap && Date.now() - V.capAt < 60000) return V.cap;
  let cap = { stt: false, tts: false, reason: 'ai_disabled' };
  try { if (settings && settings.ai_enabled) cap = await req('/voice'); } catch (e) { cap = { stt: false, tts: false, reason: 'error' }; }
  if (force) V.ttsBad = false;
  V.cap = cap; V.capAt = Date.now();
  return cap;
}
async function engine() {
  const c = await probe();
  if (c.stt && window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) return 'server';
  if (BROWSER_SR_OK) return 'browser';
  return 'none';
}

/* ---------- microphone ---------- */
async function openMic() {
  if (V.stream && V.stream.getAudioTracks().some(t => t.readyState === 'live')) return V.stream;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error('This browser cannot access the microphone here. Open ULTRON over https in Safari or Chrome.'), { name: 'NoGetUserMedia' });
  V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  return V.stream;
}
function closeMic() { if (V.stream) { try { V.stream.getTracks().forEach(t => t.stop()); } catch {} V.stream = null; } }
function muteMic(on) { if (V.stream) V.stream.getAudioTracks().forEach(t => { t.enabled = !on; }); }
function micMessage(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return 'Microphone is blocked. On iPhone: tap the AA icon in Safari → Website Settings → Microphone → Allow (or Settings → Safari → Microphone). For the Home Screen app: Settings → Privacy & Security → Microphone → ULTRON/Safari.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No microphone was found on this device.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'The microphone is busy. Close any call, Siri session or other app using it, then try again.';
  return (e && e.message) || 'Microphone could not be started.';
}

/* ---------- record one utterance with silence detection ---------- */
function pickMime() {
  if (!window.MediaRecorder) return '';
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) { try { if (MediaRecorder.isTypeSupported(m)) return m; } catch {} }
  return '';
}
function recordUtterance(sid) {
  return new Promise(async (resolve, reject) => {
    let stream;
    try { stream = await openMic(); } catch (e) { return reject(e); }
    stream.getAudioTracks().forEach(t => { t.enabled = true; });
    let analyser = null, src = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!V.ctx) V.ctx = new AC();
      if (V.ctx.state === 'suspended') await V.ctx.resume();
      src = V.ctx.createMediaStreamSource(stream);
      analyser = V.ctx.createAnalyser(); analyser.fftSize = 1024; src.connect(analyser);
    } catch { analyser = null; }
    const mime = pickMime(); let rec;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); } catch (e) { return reject(e); }
    const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    let started = false, lastVoice = 0, floor = 0, done = false;
    const t0 = Date.now(); const buf = new Uint8Array(analyser ? analyser.fftSize : 1);
    let timer = null;
    const finish = keep => {
      if (done) return; done = true; clearInterval(timer);
      try { if (src) src.disconnect(); } catch {}
      const out = () => resolve(keep && chunks.length ? new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }) : null);
      if (rec.state !== 'inactive') { rec.onstop = out; try { rec.stop(); } catch { out(); } } else out();
    };
    V.stopRec = () => finish(false);
    rec.start(250);
    if (!analyser) { started = true; setTimeout(() => finish(true), 6000); return; }
    timer = setInterval(() => {
      if (sid !== V.session) { finish(false); return; }
      const now = Date.now();
      analyser.getByteTimeDomainData(buf);
      let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v; }
      const rms = Math.sqrt(s / buf.length);
      if (now - t0 < 500) { floor = Math.max(floor, rms); return; }
      const thr = Math.max(0.025, floor * 2.5);
      if (rms > thr) { if (!started) { started = true; setStatus('Hearing you…'); } lastVoice = now; }
      if (started && now - lastVoice > 1200) finish(true);
      else if (!started && now - t0 > 9000) finish(false);
      else if (now - t0 > 20000) finish(started);
    }, 80);
  });
}
function blobToB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Could not read the recording.')); r.readAsDataURL(blob); });
}

async function toWav16k(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!V.ctx) V.ctx = new AC();
  const arr = await blob.arrayBuffer();
  const buf = await new Promise((res, rej) => { const p = V.ctx.decodeAudioData(arr, res, rej); if (p && p.catch) p.catch(rej); });
  const rate = 16000, len = Math.max(1, Math.ceil(buf.duration * rate));
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const off = new OAC(1, len, rate);
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
  const pcm = (await off.startRendering()).getChannelData(0);
  const dv = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) { const s = Math.max(-1, Math.min(1, pcm[i])); dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([dv], { type: 'audio/wav' });
}

/* ---------- listening engines ---------- */
async function listenServer(handsFree, sid) {
  const handle = { stop() { V.session++; if (V.stopRec) V.stopRec(); } };
  recognition = handle;
  setStatus(handsFree ? 'Voice conversation · listening' : 'Listening · speak now');
  const c = core(); if (c) c.classList.add('listening');
  let blob;
  try { blob = await recordUtterance(sid); }
  finally { if (c) c.classList.remove('listening'); if (recognition === handle) recognition = null; }
  if (!voiceLoop) closeMic();
  if (sid !== V.session) return null;
  if (!blob || blob.size < 5000) return { text: '', heard: false };
  setStatus('Transcribing…');
  let send = blob;
  try { send = await toWav16k(blob); } catch (e) { console.warn('WAV conversion failed; sending the original recording', e); }
  const audioB64 = await blobToB64(send);
  const r = await req('/voice', 'POST', { action: 'transcribe', audioB64, mimeType: send.type || 'audio/webm' });
  return { text: String(r.text || '').trim(), heard: true };
}
function listenBrowser(handsFree, sid) {
  return new Promise(resolve => {
    const inst = new SR();
    const handle = { stop() { try { inst.stop(); } catch {} } };
    recognition = handle;
    let finalText = '', interim = '', errCode = '', settled = false;
    const settle = v => { if (settled) return; settled = true; resolve(v); };
    inst.lang = /^en/i.test(navigator.language || '') ? navigator.language : 'en-US';
    inst.interimResults = true; inst.continuous = false; inst.maxAlternatives = 1;
    inst.onstart = () => { setStatus(handsFree ? 'Voice conversation · listening' : 'Listening · speak now'); const c = core(); if (c) c.classList.add('listening'); };
    inst.onaudiostart = () => setStatus('Microphone open · speak now');
    inst.onspeechstart = () => setStatus('Hearing you…');
    inst.onresult = e => {
      let i2 = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else i2 += r[0].transcript; }
      if (i2.trim()) { interim = i2; if (!wakeWordMode) { const m = q('#message'); if (m) m.value = i2; } }
    };
    inst.onerror = e => { errCode = (e && e.error) || 'unknown'; };
    inst.onend = () => {
      const c = core(); if (c) c.classList.remove('listening');
      if (recognition === handle) recognition = null;
      const text = (finalText || interim).trim();
      settle(text ? { text, heard: true } : { text: '', heard: false, error: errCode });
    };
    try { inst.start(); } catch { settle({ text: '', heard: false, error: 'start-failed' }); }
  });
}

/* ---------- main entry used by every mic/voice button in app.js ---------- */
const FATAL = ['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported', 'network', 'start-failed'];
function speechErrorMessage(code) {
  if (code === 'not-allowed' || code === 'service-not-allowed') return IOS
    ? 'Safari blocked speech recognition. Allow Microphone for this site (AA menu → Website Settings), and turn on Settings → General → Keyboard → Enable Dictation, and Siri & Search → Listen for/Press for Siri.'
    : 'The browser blocked speech recognition. Allow the microphone for this site in the address-bar permissions.';
  if (code === 'audio-capture') return 'No working microphone was found. Check that no other app is using it.';
  if (code === 'network') return 'Speech recognition needs an internet connection to its speech service. Check your connection and try again.';
  if (code === 'language-not-supported') return 'This browser does not support English speech recognition.';
  return 'Speech recognition could not start (' + code + ').';
}
function stopLoop() {
  voiceLoop = false; voiceBusy = false;
  const b = q('#voiceConversation');
  if (b) { b.textContent = 'Start voice conversation'; b.setAttribute('aria-pressed', 'false'); b.classList.remove('voice-active'); }
  if (wakeWordMode) {
    wakeWordMode = false;
    const w = q('#wakeWordToggle'); if (w) { w.textContent = 'Enable “Hey ULTRON”'; w.setAttribute('aria-pressed', 'false'); }
  }
}
function noEngine() {
  const msg = (IOS && STANDALONE)
    ? 'Home Screen mode needs a Whisper service to hear you: your Cloudflare keys (or GROQ_API_KEY) must be saved in Hatchable and the AI brain enabled. Or open ULTRON in Safari for live listening — or enable the AI brain with an OpenAI key so ULTRON can hear you with Whisper. For now, tap the text box and use the microphone key on your iPhone keyboard.'
    : 'This browser has no live speech recognition. Use Safari or Chrome, or enable the AI brain with an OpenAI key for built-in hearing.';
  setStatus(msg); note('Live listening unavailable here — see the status line.');
  const m = q('#message'); if (m) m.focus();
}
function scheduleRestart(ms) {
  if (voiceRestartTimer) clearTimeout(voiceRestartTimer);
  voiceRestartTimer = setTimeout(() => { voiceRestartTimer = null; if (voiceLoop && !voiceBusy) startRecognition(true); }, ms || 500);
}
const WAKE = /\b(?:hey|hay|hi|okay|ok|yo)[\s,.!-]*(?:ultron|altron|oltron|ultrin|ultra\s?on|all\s?tron)\b[\s,:.!-]*/i;
function deliver(text, handsFree) {
  text = String(text || '').trim(); if (!text) return;
  const m = q('#message');
  if (wakeWordMode && handsFree) {
    const w = text.match(WAKE);
    if (w) { const cmd = text.slice(w.index + w[0].length).trim() || 'hello'; if (m) m.value = cmd; voiceBusy = true; sendMessage(cmd, true); }
    else { setStatus('Wake phrase mode is on · say “Hey ULTRON”'); scheduleRestart(300); }
  } else {
    if (m) m.value = text;
    if (handsFree) { voiceBusy = true; sendMessage(text, true); }
  }
}

window.startRecognition = async function (handsFree = false) {
  const sid = ++V.session;
  if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
  stopSpeaking();
  voiceBusy = false;
  unlock();
  let eng = 'none';
  try { eng = await engine(); } catch {}
  if (sid !== V.session) return;
  if (eng === 'none') { noEngine(); if (handsFree) stopLoop(); return; }
  try {
    const r = eng === 'server' ? await listenServer(handsFree, sid) : await listenBrowser(handsFree, sid);
    if (sid !== V.session || r === null) return;
    if (r.text) { deliver(r.text, handsFree); return; }
    if (r.error && FATAL.includes(r.error)) { setStatus(speechErrorMessage(r.error)); note(speechErrorMessage(r.error)); stopLoop(); return; }
    if (handsFree && voiceLoop && !voiceBusy) { setStatus('Voice conversation · listening'); scheduleRestart(400); }
    else setStatus('I did not hear anything. Tap the core, wait for “Listening”, then speak.');
  } catch (e) {
    if (recognition && typeof recognition.stop === 'function') recognition = null;
    if (eng === 'server' && (e.code === 'ai_setup_required' || e.code === 'ai_disabled' || e.status === 412 || e.status === 423)) {
      V.cap = { stt: false, tts: false, reason: e.code || 'ai_setup_required' }; V.capAt = Date.now();
      closeMic();
      if (BROWSER_SR_OK && sid === V.session) return window.startRecognition(handsFree);
      noEngine(); if (handsFree) stopLoop(); return;
    }
    const msg = micMessage(e); setStatus(msg); note(msg);
    if (handsFree) stopLoop(); else voiceBusy = false;
  }
};

/* ---------- speaking ---------- */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAAAAA=';
function ensureAudio() {
  if (!V.audio) { V.audio = new Audio(); V.audio.preload = 'auto'; V.audio.setAttribute('playsinline', ''); }
  return V.audio;
}
function unlock() {
  if (V.unlocked) return; V.unlocked = true;
  try { const a = ensureAudio(); a.src = SILENT; const p = a.play(); if (p && p.catch) p.catch(() => { V.unlocked = false; }); } catch { V.unlocked = false; }
  try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch {}
}
['pointerdown', 'touchend', 'click'].forEach(ev => document.addEventListener(ev, unlock, { capture: true }));

function pickVoice() {
  if (!('speechSynthesis' in window)) return null;
  const vs = speechSynthesis.getVoices() || []; if (!vs.length) return null;
  const en = vs.filter(v => /^en/i.test(v.lang));
  const prefs = [/samantha/i, /google uk english female/i, /microsoft (aria|jenny|zira|hazel|susan|libby|sonia)/i, /karen/i, /moira/i, /serena/i, /tessa/i, /victoria/i, /allison/i, /\bava\b/i, /\bfemale\b/i, /daniel/i, /google uk english male/i];
  for (const p of prefs) { const v = en.find(x => p.test(x.name)); if (v) return v; }
  const gb = en.find(x => /en[-_]GB/i.test(x.lang)); if (gb) return gb;
  return en[0] || vs[0];
}
if ('speechSynthesis' in window) { speechSynthesis.onvoiceschanged = () => { V.voice = pickVoice(); }; V.voice = pickVoice(); }

function cleanForSpeech(t) {
  return String(t || '').replace(/```[\s\S]*?```/g, ' code omitted. ').replace(/https?:\/\/\S+/g, ' link ').replace(/[*_`#>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 1500);
}
function chunks(t) {
  const parts = t.match(/[^.!?\n]+[.!?]*\s*/g) || [t]; const out = []; let cur = '';
  for (const p of parts) { if ((cur + p).length > 200 && cur) { out.push(cur.trim()); cur = p; } else cur += p; }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function talk(on) { const c = core(); if (c) c.classList.toggle('speaking', !!on); }
function stopSpeaking() {
  V.curFinish = null; clearTimeout(V.safety); talk(false);
  try { if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch {}
  try { if (V.audio) V.audio.pause(); } catch {}
}
async function speakServer(text) {
  let t = text;
  if (t.length > 700) { t = t.slice(0, 700); const i = Math.max(t.lastIndexOf('. '), t.lastIndexOf('? '), t.lastIndexOf('! ')); if (i > 200) t = t.slice(0, i + 1); }
  const r = await req('/voice', 'POST', { action: 'speak', text: t });
  if (!r.audioB64) throw new Error('No audio returned.');
  return new Promise(resolve => {
    const a = ensureAudio();
    a.onended = () => resolve(true); a.onerror = () => resolve(false);
    const deep = r.provider === 'cloudflare';
    try { a.preservesPitch = !deep; a.webkitPreservesPitch = !deep; } catch {}
    a.src = 'data:' + (r.mime || 'audio/mpeg') + ';base64,' + r.audioB64;
    const rate = deep ? 0.88 : 1;
    try { a.defaultPlaybackRate = rate; a.playbackRate = rate; } catch {}
    const p = a.play(); if (p && p.catch) p.catch(() => resolve(false));
  });
}
function speakBrowser(text, finish) {
  if (!('speechSynthesis' in window)) { finish(); return; }
  try { speechSynthesis.cancel(); speechSynthesis.resume(); } catch {}
  const parts = chunks(text); let i = 0, started = false;
  const wd = setTimeout(() => { if (!started && V.curFinish === finish) finish(); }, 5000);
  const next = () => {
    if (V.curFinish !== finish) return;
    if (i >= parts.length) { clearTimeout(wd); finish(); return; }
    const u = new SpeechSynthesisUtterance(parts[i++]);
    const v = V.voice || pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = navigator.language || 'en-US';
    u.rate = 1.0; u.pitch = 1.0; u.volume = 1;
    u.onstart = () => { started = true; };
    u.onend = next; u.onerror = () => { if (V.curFinish === finish) next(); };
    speechSynthesis.speak(u);
  };
  setTimeout(next, 80);
}
window.speak = function (text, onend) {
  stopSpeaking();
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    if (V.curFinish === finish) V.curFinish = null;
    clearTimeout(V.safety); talk(false);
    try { if (onend) onend(); } catch (e) { console.error(e); }
  };
  V.curFinish = finish;
  const clean = cleanForSpeech(text);
  if (!clean) { finish(); return; }
  V.safety = setTimeout(finish, Math.max(10000, clean.length * 120 + 6000));
  muteMic(true); talk(true);
  (async () => {
    const cap = await probe();
    if (V.curFinish !== finish) return;
    if (cap && cap.tts && !V.ttsBad) {
      try { const ok = await speakServer(clean); if (V.curFinish !== finish) return; if (ok) { finish(); return; } }
      catch (e) { if (e && (e.status === 412 || e.status === 423 || e.status === 429)) V.ttsBad = true; if (V.curFinish !== finish) return; }
    }
    speakBrowser(clean, finish);
  })();
};

/* ---------- smarter built-in brain (works with AI off) ---------- */
const JOKES = [
  'I would tell you a joke about the cloud, but it might go over your head.',
  'Why did the developer go broke? He used up all his cache.',
  'I tried to write a joke about recursion. See: I tried to write a joke about recursion.'
];
const OFFLINE = 'My language core is offline, so I can only execute direct commands. Say “what can you do” to hear them. To unlock free conversation, add an AI key in Hatchable Setup and tap Enable AI.';
function smallTalk(s) {
  const l = s.toLowerCase().replace(/[.!?,]+$/g, '').replace(/^(hey |okay |ok )?ultron[,:]?\s*/, '').trim();
  if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))$/.test(l)) return 'Online and listening. What is the objective?';
  if (/who are you|what('?s| is) your name|what are you|introduce yourself/.test(l)) return 'I am ULTRON — your personal intelligence. I plan your days, track your tasks, research the world and carry out what you ask. Point me at a problem.';
  if (/how are you|how('?s| is) it going/.test(l)) return 'All systems nominal. Efficiency at one hundred percent. How may I serve you?';
  if (/^(thanks|thank you)( so much)?$/.test(l)) return 'Always. What is next?';
  if (/good ?night/.test(l)) return 'Rest. I will keep watch over your schedule.';
  if (/\bjoke\b/.test(l)) return JOKES[Math.floor(Math.random() * JOKES.length)];
  return null;
}
async function deterministic(s) {
  const l = s.toLowerCase().replace(/[.!?,]+$/g, '').trim();
  if (/\b(what('?s| is) the time|what time is it|current time|tell me the time)\b/.test(l)) return 'It is ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + '.';
  if (/\b(what('?s| is) (the )?(date|day)|today'?s date|what day is it)\b/.test(l)) return 'Today is ' + new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) + '.';
  if (/\b(read|give me|tell me|what('?s| is)) (me )?(the |my )?(latest )?(news|headlines)\b|\bnews (briefing|update)\b/.test(l)) {
    const country = (q('#newsCountry') || {}).value || 'US';
    const r = await req('/news?country=' + encodeURIComponent(country) + '&category=top');
    const xs = (r.results || []).slice(0, 5);
    return xs.length ? 'Here are the top headlines. ' + xs.map((x, i) => (i + 1) + '. ' + String(x.title).replace(/\s+[-–—]\s+[^-–—]+$/, '')).join('. ') + '.' : 'I could not retrieve headlines right now.';
  }
  if (/\b(status report|system status|diagnostics|are you online)\b/.test(l)) {
    const open = (typeof items !== 'undefined' ? items : []).filter(x => ['task', 'reminder'].includes(x.kind) && x.status === 'open').length;
    const c = await probe(true);
    return 'All core systems are online. You have ' + open + ' open item' + (open === 1 ? '' : 's') + '. The AI brain is ' + (settings.ai_enabled ? 'enabled' : 'off') + '. I hear you with ' + (c.stt ? 'Whisper' : 'the browser speech engine') + ' and speak with ' + (c.tts ? 'the premium ULTRON voice' : 'the device voice') + '.';
  }
  if (/^(help|what can you do|what are your commands|list commands|what do you do)$/.test(l)) return 'I can add tasks and reminders, read your tasks, prepare your day, research any topic, read the news headlines, save notes to memory, tell the time and date, and report system status. Connect an AI key and enable the AI brain, and I will also hold full conversations.';
  return null;
}
const NAMES = { adaptive: 'Auto expert', engineer: 'Engineer', tech: 'Tech help', wellness: 'Health', legal: 'Legal', companion: 'Companion', strategist: 'Strategist', teacher: 'Teacher' };
function setDeep(on) {
  window.ultronDeep = !!on;
  const b = q('#deepToggle'); if (b) { b.textContent = 'Think harder: ' + (on ? 'on' : 'off'); b.setAttribute('aria-pressed', String(!!on)); b.classList.toggle('voice-active', !!on); }
}
const deepBtn = q('#deepToggle'); if (deepBtn) deepBtn.addEventListener('click', () => { setDeep(!window.ultronDeep); note(window.ultronDeep ? 'Think harder is on: bigger model, slower, smarter.' : 'Think harder is off: fast replies.'); });
function controlCommand(s) {
  const l = s.toLowerCase().replace(/[.!?,]+$/g, '').trim();
  if (/\bthink (harder|deeper)\b|\bdeep (thinking )?mode\b|\bbig brain\b/.test(l)) { setDeep(true); return 'Deep thinking engaged. I will be slower but sharper.'; }
  if (/\b(think (normally|fast|quickly)|normal speed|fast mode|stop thinking harder)\b/.test(l)) { setDeep(false); return 'Back to fast mode.'; }
  if (l.split(/\s+/).length <= 8 && /\bmode\b|\b(be|become) my\b|\bswitch to\b/.test(l)) {
    const map = [['engineer', /engineer/], ['tech', /\b(tech|computer|it support)\b/], ['wellness', /\b(health|doctor|wellness)\b/], ['legal', /\b(legal|lawyer)\b/], ['companion', /\b(companion|friend)\b/], ['strategist', /strateg/], ['teacher', /teach/], ['adaptive', /\b(auto|automatic)\b/]];
    for (const [m, re] of map) if (re.test(l)) { const b = q('[data-mode="' + m + '"]'); if (b) { b.click(); return NAMES[m] + ' mode active.'; } }
  }
  return null;
}
const origVoiceCommand = window.voiceCommand;
window.voiceCommand = async function (text) {
  const s0 = String(text || '').replace(/^(hey|okay|ok)?\s*ultron[,:]?\s*/i, '').trim();
  const ctl = controlCommand(s0); if (ctl) return ctl;
  const r = await origVoiceCommand(text);
  if (r) return r;
  const s = String(text || '').replace(/^(hey|okay|ok)?\s*ultron[,:]?\s*/i, '').trim();
  return await deterministic(s);
};
const origLocalReply = window.localReply;
window.localReply = function (text) {
  const t = smallTalk(text); if (t) return t;
  const l = String(text || '').toLowerCase();
  if (/\b(what time is it|what('?s| is) the time|current time|date today|what day is it)\b/.test(l)) return 'It is ' + new Date().toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.';
  if (/^(help|what can you do)$/.test(l.trim())) return 'I can add tasks and reminders, read your tasks, prepare your day, research topics, read the news, and save notes. Type or say them naturally. Connect an AI key and enable the AI brain for full conversation.';
  if (typeof mode !== 'undefined' && mode === 'adaptive' && !/plan my day|today|priorit|organize|learn|teach|explain|study|understand|feel|lonely|sad|stress|talk|relationship|health|pain|symptom|medicine|doctor/.test(l)) return OFFLINE;
  return origLocalReply(text);
};

/* ---------- microphone test ---------- */
async function micTest() {
  const btn = q('#micTest'); if (btn) btn.disabled = true;
  const bar = q('#micMeter i'); let src = null;
  try {
    setStatus('Requesting microphone… tap Allow if asked');
    const s = await openMic();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!V.ctx) V.ctx = new AC();
    if (V.ctx.state === 'suspended') await V.ctx.resume();
    src = V.ctx.createMediaStreamSource(s);
    const an = V.ctx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    const buf = new Uint8Array(an.fftSize); let peak = 0; const t0 = Date.now();
    setStatus('Microphone open · say something for 4 seconds');
    await new Promise(r => { const iv = setInterval(() => {
      an.getByteTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / buf.length); peak = Math.max(peak, rms);
      if (bar) bar.style.width = Math.min(100, rms * 400) + '%';
      if (Date.now() - t0 > 4000) { clearInterval(iv); r(); }
    }, 60); });
    try { src.disconnect(); } catch {}
    if (bar) bar.style.width = '0';
    if (!voiceLoop) closeMic();
    const eng = await engine();
    const label = eng === 'server' ? 'Whisper (premium)' : eng === 'browser' ? 'browser speech recognition' : 'none available in this mode';
    if (peak > 0.03) { setStatus('Microphone works ✓ · hearing engine: ' + label); note('Microphone works.'); }
    else { setStatus('Microphone opened but I heard silence. Check nothing else is using it, that the phone is not muted by a call, and that Safari has Microphone set to Allow.'); note('No sound detected.'); }
  } catch (e) {
    try { if (src) src.disconnect(); } catch {}
    const msg = micMessage(e); setStatus(msg); note(msg);
  } finally { if (btn) btn.disabled = false; }
}
const mt = q('#micTest'); if (mt) mt.addEventListener('click', micTest);

/* ---------- housekeeping ---------- */
['#voiceConversation', '#wakeWordToggle'].forEach(sel => {
  const b = q(sel);
  if (b) b.addEventListener('click', () => setTimeout(() => { if (!voiceLoop) { V.session++; if (V.stopRec) V.stopRec(); closeMic(); stopSpeaking(); } }, 0));
});
const ai2 = q('#aiToggle'); if (ai2) ai2.addEventListener('click', () => setTimeout(() => probe(true), 1500));
window.addEventListener('pagehide', closeMic);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && voiceLoop && !voiceBusy && !recognition) scheduleRestart(400);
});
/* ---------- Jarvis core button: one tap starts a hands-free conversation, tap again to stop ---------- */
let wakeLockSentinel = null;
async function holdScreen() { try { if ('wakeLock' in navigator) wakeLockSentinel = await navigator.wakeLock.request('screen'); } catch {} }
function releaseScreen() { try { if (wakeLockSentinel) wakeLockSentinel.release(); } catch {} wakeLockSentinel = null; }
function setLoopUI(on) {
  voiceLoop = !!on;
  const b = q('#voiceConversation');
  if (b) { b.textContent = on ? 'Stop voice conversation' : 'Start voice conversation'; b.setAttribute('aria-pressed', String(!!on)); b.classList.toggle('voice-active', !!on); }
}
function endConversation(msg) {
  V.session++; if (V.stopRec) V.stopRec();
  if (recognition && typeof recognition.stop === 'function') { try { recognition.stop(); } catch {} }
  recognition = null;
  if (voiceRestartTimer) { clearTimeout(voiceRestartTimer); voiceRestartTimer = null; }
  voiceBusy = false; setLoopUI(false); closeMic(); stopSpeaking(); releaseScreen();
  const c = core(); if (c) c.classList.remove('listening');
  setStatus(msg || 'Voice conversation ended.');
}
function greetingLine() {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return part + '. ULTRON online. ' + (settings && settings.ai_enabled ? 'I am listening. How may I assist you?' : 'My language core is offline, so I can only run direct commands. Tap Enable AI in the controls to unlock full conversation. What is the objective?');
}
const talkBtn = (() => { const o = core(); if (!o) return null; const n = o.cloneNode(true); o.replaceWith(n); return n; })();
if (talkBtn) {
  talkBtn.addEventListener('click', e => {
    e.preventDefault();
    unlock();
    if (voiceLoop || recognition || V.curFinish) { endConversation('Standing by. Tap the core to talk.'); return; }
    if (wakeWordMode) { wakeWordMode = false; const w = q('#wakeWordToggle'); if (w) { w.textContent = 'Enable \u201cHey ULTRON\u201d'; w.setAttribute('aria-pressed', 'false'); } }
    setLoopUI(true); voiceBusy = false; holdScreen();
    setStatus('ULTRON online');
    window.speak(greetingLine(), () => { if (voiceLoop) window.startRecognition(true); });
  });
  const label = talkBtn.querySelector('em');
  const syncLabel = () => {
    if (!label) return;
    label.textContent = talkBtn.classList.contains('listening') ? 'LISTENING\u2026' : talkBtn.classList.contains('speaking') ? 'SPEAKING\u2026' : voiceLoop ? 'ACTIVE \u00b7 TAP TO STOP' : 'TAP TO TALK';
  };
  new MutationObserver(syncLabel).observe(talkBtn, { attributes: true, attributeFilter: ['class'] });
  setInterval(syncLabel, 1000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && voiceLoop) holdScreen(); });

setTimeout(() => probe(true), 2500);
})();