/* ULTRON offline hearing: runs a small Whisper model inside the browser (no API key, no server).
   Used only when neither server Whisper nor browser speech recognition is available
   (for example the iPhone Home Screen app). The model downloads once (about 40 MB) and is cached. */
(() => {
  let pipe = null, loading = null;
  const api = {
    ready: false,
    async transcribe(pcm, onStatus) {
      const say = t => { try { if (onStatus) onStatus(t); } catch {} };
      if (!pipe) {
        if (!loading) {
          loading = (async () => {
            say('Loading offline hearing, one time only, about 40 MB\u2026');
            const mod = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2');
            mod.env.allowLocalModels = false;
            pipe = await mod.pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
              dtype: 'q8',
              device: 'wasm',
              progress_callback: p => { if (p && p.status === 'progress' && typeof p.progress === 'number') say('Loading offline hearing\u2026 ' + Math.round(p.progress) + '%'); }
            });
            api.ready = true;
          })().catch(e => {
            loading = null; pipe = null;
            throw new Error('Offline hearing could not load (' + String((e && e.message) || e).slice(0, 120) + '). Check your connection, add a free GROQ_API_KEY in Hatchable Setup, or open ULTRON in Safari.');
          });
        }
        await loading;
      }
      say('Transcribing\u2026');
      const out = await pipe(pcm, { chunk_length_s: 30 });
      return (out && out.text) || '';
    }
  };
  window.ULTRON_LOCAL_STT = api;
})();