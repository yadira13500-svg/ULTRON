/* ULTRON Call Assistant: quick, permission-based replies for calls you cannot take.
   A web app cannot answer a phone call by itself. This panel writes the reply, then YOU choose
   to text it, copy it, or have ULTRON speak it. Nothing is ever sent automatically. */
(() => {
  const $ = s => document.querySelector(s);
  const KEY = 'ultron_call_assistant_v1';
  const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent || '');
  const STATUS = {
    busy: { label: 'Busy', me: "Hi, I can't talk right now, I'm busy. I'll get back to you as soon as I can.", asst: 'Hello, this is ULTRON, the assistant for {n}. {n} is busy right now and cannot take your call. Please leave a message or send a text, and {n} will get back to you.' },
    meeting: { label: 'In a meeting', me: "Hi, I'm in a meeting right now and can't talk. I'll call you back as soon as I'm out.", asst: 'Hello, this is ULTRON, the assistant for {n}. {n} is in a meeting and cannot take your call. Please leave a message and {n} will reply when the meeting ends.' },
    driving: { label: 'Driving', me: "Hi, I'm driving and can't take your call safely. I'll call you back when I've stopped.", asst: 'Hello, this is ULTRON, the assistant for {n}. {n} is driving and cannot take your call. Please leave a message and {n} will call you back once safely stopped.' },
    resting: { label: 'Resting', me: "Hi, I'm resting right now and can't talk. I'll get back to you later today.", asst: 'Hello, this is ULTRON, the assistant for {n}. {n} is resting and is not available right now. Please leave a message and {n} will return your call later.' },
    later: { label: 'Call back later', me: "Hi, now isn't a good time to talk. Can I call you back later today?", asst: 'Hello, this is ULTRON, the assistant for {n}. {n} is not available right now but will call you back later today. Please leave your name and a short message.' },
    urgent: { label: 'Unavailable (urgent only)', me: "Hi, I'm not available right now. If it's urgent, please text me and say so, otherwise I'll call you back soon.", asst: 'Hello, this is ULTRON, the assistant for {n}. {n} is not available right now. If this is an emergency, please hang up and call your local emergency number. Otherwise, leave a message and {n} will respond soon.' }
  };
  let st = { name: '', status: 'busy', as: 'me', msg: '', number: '' };
  try { st = Object.assign(st, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const toast2 = t => { try { toast(t); } catch { alert(t); } };
  const build = () => {
    const p = STATUS[st.status] || STATUS.busy;
    const n = (st.name || '').trim() || 'the person you are calling';
    return (st.as === 'asst' ? p.asst : p.me).replace(/\{n\}/g, n);
  };
  const el = {};
  const init = () => {
    ['callName', 'callStatus', 'callAs', 'callMsg', 'callNumber', 'callText', 'callCopy', 'callSpeak', 'callReset', 'callState'].forEach(id => { el[id] = document.getElementById(id); });
    if (!el.callMsg) return;
    el.callName.value = st.name; el.callStatus.value = st.status; el.callAs.value = st.as; el.callNumber.value = st.number;
    el.callMsg.value = st.msg || build();
    const sync = () => { if (el.callState) el.callState.textContent = (STATUS[st.status] || STATUS.busy).label.toUpperCase(); };
    sync();
    const refill = () => { st.msg = ''; el.callMsg.value = build(); sync(); save(); };
    el.callName.addEventListener('input', () => { st.name = el.callName.value; refill(); });
    el.callStatus.addEventListener('change', () => { st.status = el.callStatus.value; refill(); });
    el.callAs.addEventListener('change', () => { st.as = el.callAs.value; refill(); });
    el.callNumber.addEventListener('input', () => { st.number = el.callNumber.value; save(); });
    el.callMsg.addEventListener('input', () => { st.msg = el.callMsg.value; save(); });
    el.callReset.addEventListener('click', () => { st = { name: st.name, status: 'busy', as: 'me', msg: '', number: '' }; el.callStatus.value = 'busy'; el.callAs.value = 'me'; el.callNumber.value = ''; refill(); toast2('Reset.'); });
    el.callCopy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(el.callMsg.value); toast2('Copied.'); } catch { el.callMsg.select(); toast2('Select and copy the text.'); }
    });
    el.callSpeak.addEventListener('click', () => { if (window.speak) window.speak(el.callMsg.value); });
    el.callText.addEventListener('click', () => {
      const body = encodeURIComponent(el.callMsg.value);
      const num = (el.callNumber.value || '').replace(/[^\d+]/g, '');
      location.href = 'sms:' + num + (IOS ? '&' : '?') + 'body=' + body;
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();