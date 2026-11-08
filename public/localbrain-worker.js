import { CreateMLCEngine } from 'https://esm.run/@mlc-ai/web-llm';

const MODEL_ID = 'SmolLM2-360M-Instruct-q4f32_1-MLC';
let engine = null;
let loading = null;
let busy = false;

self.onmessage = async event => {
  const message = event.data || {};
  if (message.type === 'load') {
    if (engine) { self.postMessage({type:'ready',model:MODEL_ID,cached:true}); return; }
    if (loading) return;
    loading = (async () => {
      if (!self.navigator?.gpu) throw new Error('WebGPU is unavailable in this browser. The local model was not downloaded.');
      const adapter = await self.navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('No compatible GPU adapter was found. The local model was not downloaded.');
      self.postMessage({type:'status',status:'downloading',message:'Preparing local model. The first download may be several hundred megabytes.'});
      engine = await CreateMLCEngine(MODEL_ID, {
        initProgressCallback: report => self.postMessage({type:'progress',progress:report?.progress ?? null,text:report?.text || 'Loading local model…'})
      });
      self.postMessage({type:'ready',model:MODEL_ID,cached:false});
    })().catch(error => {
      engine = null;
      self.postMessage({type:'error',message:String(error?.message || error).slice(0,400)});
    }).finally(() => { loading = null; });
    return;
  }
  if (message.type === 'generate') {
    if (!engine) { self.postMessage({type:'error',requestId:message.requestId,message:'The local model has not been loaded.'}); return; }
    if (busy) { self.postMessage({type:'error',requestId:message.requestId,message:'The local model is already processing another request.'}); return; }
    busy = true;
    try {
      const started = performance.now();
      const response = await engine.chat.completions.create({
        messages: Array.isArray(message.messages) ? message.messages : [],
        temperature: 0.2,
        max_tokens: Math.max(96, Math.min(320, Number(message.maxTokens) || 320)),
        stream: false
      });
      const reply = String(response?.choices?.[0]?.message?.content || '').trim();
      if (!reply) throw new Error('The local model returned an empty answer.');
      self.postMessage({type:'reply',requestId:message.requestId,reply,model:MODEL_ID,latencyMs:Math.round(performance.now()-started),usage:response?.usage || null});
    } catch (error) {
      self.postMessage({type:'error',requestId:message.requestId,message:String(error?.message || error).slice(0,400)});
    } finally { busy = false; }
  }
};