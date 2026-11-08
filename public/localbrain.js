(() => {
  const MODEL_ID='SmolLM2-360M-Instruct-q4f32_1-MLC';
  let worker=null, ready=false, loading=false, sequence=0, teamBusy=false;
  const pending=new Map(), history=[];
  const listeners=new Set();
  const state={ready:false,loading:false,model:MODEL_ID,backend:'webgpu',lastLatencyMs:null,lastError:null};
  const emit=()=>{for(const fn of listeners){try{fn({...state})}catch{}}};
  function ensureWorker(){
    if(worker)return worker;
    if(!('Worker'in window))throw new Error('This browser does not support background workers required by the local model.');
    worker=new Worker('/localbrain-worker.js',{type:'module'});
    worker.onmessage=event=>{
      const data=event.data||{};
      if(data.type==='progress'||data.type==='status'){
        state.loading=true;state.progress=data.progress??null;state.statusText=data.text||data.message||'Loading local model…';emit();
      }else if(data.type==='ready'){
        ready=true;loading=false;state.ready=true;state.loading=false;state.lastError=null;state.statusText='Local model ready on this device';emit();
      }else if(data.type==='reply'){
        state.lastLatencyMs=data.latencyMs;state.lastError=null;const item=pending.get(data.requestId);if(item){pending.delete(data.requestId);history.push({role:'assistant',content:data.reply});while(history.length>8)history.shift();item.resolve(data);}
      }else if(data.type==='error'){
        const item=pending.get(data.requestId);if(item){pending.delete(data.requestId);item.reject(new Error(data.message||'Local model error.'));}
        else {loading=false;state.loading=false;state.lastError=data.message||'Local model failed to load.';state.statusText=state.lastError;emit();}
      }
    };
    worker.onerror=event=>{state.lastError=event.message||'Local model worker failed.';state.statusText=state.lastError;loading=false;state.loading=false;emit();};
    return worker;
  }
  const api={
    get ready(){return ready;},
    get state(){return {...state};},
    onState(fn){listeners.add(fn);fn({...state});return()=>listeners.delete(fn);},
    capability(){
      const supported=!!navigator.gpu;
      return {webgpu:supported,worker:('Worker'in window),secureContext:!!window.isSecureContext,model:MODEL_ID,ready,loading};
    },
    async load(){
      if(ready)return {...state};
      if(loading)return new Promise((resolve,reject)=>{const off=api.onState(s=>{if(s.ready){off();resolve(s)}else if(s.lastError){off();reject(new Error(s.lastError))}})});
      if(!window.isSecureContext)throw new Error('Local model loading requires a secure HTTPS context.');
      if(!('Worker'in window))throw new Error('This browser does not support the background worker required for local inference.');
      if(!navigator.gpu)throw new Error('WebGPU is not available in this browser. No model was downloaded and no provider was contacted.');
      loading=true;state.loading=true;state.lastError=null;state.statusText='Checking local GPU…';emit();
      ensureWorker().postMessage({type:'load'});
      return new Promise((resolve,reject)=>{
        const off=api.onState(s=>{if(s.ready){off();resolve(s)}else if(s.lastError){off();reject(new Error(s.lastError))}});
      });
    },
    async generate(prompt){
      if(!ready)throw new Error('Load the local model first.');
      const q=String(prompt||'').trim();if(!q)throw new Error('Enter a question for ULTRON.');
      const requestId=String(++sequence);
      const messages=[{role:'system',content:'You are ULTRON, a careful local assistant. Answer clearly and directly. Distinguish known facts from assumptions. If you do not know or lack evidence, say so. Do not invent citations, current facts, tool use, or verification. You are a small on-device model; acknowledge uncertainty on difficult questions.'},...history.slice(-6),{role:'user',content:q}];
      history.push({role:'user',content:q});while(history.length>8)history.shift();
      return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject});ensureWorker().postMessage({type:'generate',requestId,messages});});
    },
    async runSpecialistTeam(prompt,evidence=''){
      if(!ready)throw new Error('Load the local model first.');
      if(teamBusy)throw new Error('ULTRON local specialist team is already processing a mission.');
      const q=String(prompt||'').trim();if(!q)throw new Error('Enter a mission for the specialist team.');
      teamBusy=true;const started=performance.now();
      const invokeRole=(messages,maxTokens)=>{const requestId=String(++sequence);return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject});ensureWorker().postMessage({type:'generate',requestId,messages,maxTokens});});};
      try{
        const supplied=String(evidence||'').slice(0,5000)||'No external source material was supplied. Do not claim web research was performed.';
        const researcher=await invokeRole([{role:'system',content:'You are ULTRON Researcher, a separate evidence-mapping specialist. You have no web or file tools. Break the mission into subquestions; distinguish supplied evidence from assumptions; identify missing evidence and verification needs. Never claim you searched.'},{role:'user',content:'MISSION: '+q+'\nSUPPLIED MATERIAL: '+supplied+'\nReturn concise known, unknown, and verification needs.'}],190);
        const analyst=await invokeRole([{role:'system',content:'You are ULTRON Analyst. Solve the mission using only the prompt and researcher map. Distinguish inference from fact, show a concise reasoning summary, and flag ambiguity. Do not fabricate sources.'},{role:'user',content:'MISSION: '+q+'\nRESEARCHER MAP:\n'+researcher.reply+'\nSUPPLIED MATERIAL:\n'+supplied+'\nGive a provisional answer and limitations.'}],230);
        const verifier=await invokeRole([{role:'system',content:'You are ULTRON Verifier, a separate adversarial review session. Do not merely agree. Check the original task and analyst output for unsupported claims, logical gaps, arithmetic errors, contradictions, and missing evidence. You have no external tools.'},{role:'user',content:'ORIGINAL MISSION: '+q+'\nRESEARCHER MAP:\n'+researcher.reply+'\nANALYST PROPOSAL:\n'+analyst.reply+'\nSUPPLIED MATERIAL:\n'+supplied+'\nReturn verdict: pass, qualified, or reject; list defects and corrected conclusion.'}],210);
        return {reply:'RESEARCHER — evidence map\n'+researcher.reply+'\n\nANALYST — provisional analysis\n'+analyst.reply+'\n\nINDEPENDENT VERIFIER — challenge\n'+verifier.reply+'\n\nULTRON status: three separate on-device specialist passes completed. This is not proof of factual accuracy; no web search or external verification was performed.',workflow:'local_three_specialist_passes',sessions:[{role:'researcher',latencyMs:researcher.latencyMs},{role:'analyst',latencyMs:analyst.latencyMs},{role:'verifier',latencyMs:verifier.latencyMs}],totalLatencyMs:Math.round(performance.now()-started),verified:false};
      }finally{teamBusy=false;}
    },
    resetConversation(){history.length=0;},
    unload(){
      if(worker){worker.terminate();worker=null;}
      for(const item of pending.values())item.reject(new Error('Local model session was reset.'));
      pending.clear();history.length=0;ready=false;loading=false;
      state.ready=false;state.loading=false;state.lastError=null;state.statusText='Local model unloaded from memory. Cached model files remain on this device.';emit();
      return {...state};
    }
  };
  window.ULTRON_LOCAL_BRAIN=api;
})();