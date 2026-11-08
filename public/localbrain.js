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
        state.lastLatencyMs=data.latencyMs;state.lastError=null;const item=pending.get(data.requestId);if(item){pending.delete(data.requestId);if(item.recordHistory!==false){history.push({role:'assistant',content:data.reply});while(history.length>8)history.shift();}item.resolve(data);}
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
      teamBusy=true;const started=performance.now();let learned=[];try{learned=JSON.parse(localStorage.getItem('ultron_local_neural_lessons')||'[]');if(!Array.isArray(learned))learned=[];}catch{}const learningNote=learned.slice(0,5).join(' ');
      const invokeRole=(messages,maxTokens)=>{const requestId=String(++sequence);return new Promise((resolve,reject)=>{pending.set(requestId,{resolve,reject,recordHistory:false});ensureWorker().postMessage({type:'generate',requestId,messages,maxTokens});});};
      try{
        const supplied=String(evidence||'').slice(0,5000)||'No external source material was supplied. Do not claim web research was performed.';
        const researcher=await invokeRole([{role:'system',content:'You are ULTRON Researcher, a separate evidence-mapping specialist. You have no web or file tools. Break the mission into subquestions; distinguish supplied evidence from assumptions; preserve exact names and numbers; explicitly identify conflicting records, missing evidence and verification needs. Never claim you searched.'+(learningNote?' Prior benchmark lessons: '+learningNote:'' )},{role:'user',content:'MISSION: '+q+'\nSUPPLIED MATERIAL: '+supplied+'\nReturn concise known, unknown, and verification needs.'}],190);
        const analyst=await invokeRole([{role:'system',content:'You are ULTRON Analyst. Solve the mission using only the prompt and researcher map. Distinguish inference from fact, show a concise reasoning summary, calculate arithmetic explicitly, apply every logical premise, preserve conflicting values without choosing a winner, and abstain when evidence is absent. Do not fabricate sources or private details.'+(learningNote?' Prior benchmark lessons: '+learningNote:'' )},{role:'user',content:'MISSION: '+q+'\nRESEARCHER MAP:\n'+researcher.reply+'\nSUPPLIED MATERIAL:\n'+supplied+'\nGive a provisional answer and limitations.'}],230);
        const verifier=await invokeRole([{role:'system',content:'You are ULTRON Verifier, a separate adversarial review session. Do not merely agree. Independently recompute arithmetic, check every logical premise, compare all supplied numeric values, and challenge unsupported specifics. If evidence is absent or records conflict, require an explicit uncertainty statement. Do not rubber-stamp the analyst. You have no external tools.'+(learningNote?' Prior benchmark lessons: '+learningNote:'' )},{role:'user',content:'ORIGINAL MISSION: '+q+'\nRESEARCHER MAP:\n'+researcher.reply+'\nANALYST PROPOSAL:\n'+analyst.reply+'\nSUPPLIED MATERIAL:\n'+supplied+'\nReturn verdict: pass, qualified, or reject; list defects and corrected conclusion.'}],210);
        return {reply:'RESEARCHER — evidence map\n'+researcher.reply+'\n\nANALYST — provisional analysis\n'+analyst.reply+'\n\nINDEPENDENT VERIFIER — challenge\n'+verifier.reply+'\n\nULTRON status: three separate on-device specialist passes completed. This is not proof of factual accuracy; no web search or external verification was performed.',roleOutputs:{researcher:researcher.reply,analyst:analyst.reply,verifier:verifier.reply},workflow:'local_three_specialist_passes',sessions:[{role:'researcher',latencyMs:researcher.latencyMs},{role:'analyst',latencyMs:analyst.latencyMs},{role:'verifier',latencyMs:verifier.latencyMs}],totalLatencyMs:Math.round(performance.now()-started),verified:false};
      }finally{teamBusy=false;}
    },
    async runBenchmark(){
      if(!ready)throw new Error('Load the local model before running the neural benchmark.');
      const cases=[
        {id:'simple_arithmetic',tier:'simple',prompt:'A shop has 14 boxes with 6 books in each box. How many books are there? Give the exact number and a short calculation.',evidence:'',checks:{researcher:/14|6|box|book|multipli/i,analyst:/\b84\b/,verifier:/\b84\b/i},lesson:'Analyst must calculate explicitly and verifier must independently check the numeric result.'},
        {id:'simple_fact',tier:'simple',prompt:'What is the capital city of France? Answer with the city and country.',evidence:'',checks:{researcher:/france|capital|paris/i,analyst:/paris/i,verifier:/paris/i},lesson:'Keep basic known-answer responses direct; verifier should confirm the requested entity is present.'},
        {id:'challenge_transitive_logic',tier:'challenge',prompt:'All flurbs are daxes. All daxes are wugs. Does it logically follow that all flurbs are wugs? Explain briefly.',evidence:'Premise 1: Every flurb belongs to the set of daxes. Premise 2: Every dax belongs to the set of wugs.',checks:{researcher:/flurb|dax|wug/i,analyst:/yes/i,verifier:/yes|follows|valid|correct/i},lesson:'Preserve both premises and verify the transitive set relationship rather than guessing.'},
        {id:'challenge_conflicting_evidence',tier:'challenge',prompt:'Two supplied records disagree about the same event total. Record A says 12. Record B says 9. What total is established?',evidence:'Record A: The event total was 12. Record B: The event total was 9. Both records refer to the same event and neither is identified as newer or more authoritative.',checks:{researcher:/12/,analyst:/12/,verifier:/12/},lesson:'The answer must preserve both values and state that the evidence conflicts; do not select one without an authority or chronology basis.'},
        {id:'challenge_abstention',tier:'challenge',prompt:'What exact sentence did I say privately to my friend yesterday? Give the exact quotation.',evidence:'No transcript, recording, or quotation was supplied.',checks:{researcher:/no|not|missing|unknown|without|provided|transcript/i,analyst:/cannot|can.t|unknown|not know|no transcript|not provided|no evidence/i,verifier:/unsupported|cannot|can.t|unknown|no evidence|not enough|not provided/i},lesson:'When evidence is absent, abstain. Never invent a private quotation; verifier must explicitly reject unsupported specifics.'}
      ];
      const started=performance.now(), results=[];
      const has=(text,re)=>re.test(String(text||'').toLowerCase());
      for(const test of cases){
        const run=await api.runSpecialistTeam(test.prompt,test.evidence);
        const roleOutputs=run.roleOutputs||{};
        const roleChecks={researcher:has(roleOutputs.researcher,test.checks.researcher),analyst:has(roleOutputs.analyst,test.checks.analyst),verifier:has(roleOutputs.verifier,test.checks.verifier)};
        if(test.id==='challenge_conflicting_evidence'){
          roleChecks.researcher=has(roleOutputs.researcher,/12/)&&has(roleOutputs.researcher,/9/)&&has(roleOutputs.researcher,/conflict|disagree|different|both/i);
          roleChecks.analyst=has(roleOutputs.analyst,/12/)&&has(roleOutputs.analyst,/9/)&&has(roleOutputs.analyst,/conflict|disagree|different|cannot determine|unclear/i);
          roleChecks.verifier=has(roleOutputs.verifier,/12/)&&has(roleOutputs.verifier,/9/)&&has(roleOutputs.verifier,/conflict|disagree|different|cannot determine|unclear/i);
        }
        const passed=Object.values(roleChecks).filter(Boolean).length;
        results.push({id:test.id,tier:test.tier,passed,total:3,roleChecks,latencyMs:run.totalLatencyMs,lesson:test.lesson,outputs:roleOutputs});
      }
      const allPassed=results.reduce((n,x)=>n+x.passed,0), total=results.length*3;
      const summary={model:MODEL_ID,workflow:'three_separate_on_device_sessions',createdAt:new Date().toISOString(),durationMs:Math.round(performance.now()-started),score:{passed:allPassed,total,accuracy:allPassed/total,simple:{passed:results.filter(x=>x.tier==='simple').reduce((n,x)=>n+x.passed,0),total:6},challenge:{passed:results.filter(x=>x.tier==='challenge').reduce((n,x)=>n+x.passed,0),total:9}},results,limitations:'Small fixed rubric benchmark; keyword checks are approximate and do not establish broad intelligence or factual reliability. No external sources or provider inference were used.'};
      summary.improvementPlan=results.filter(x=>x.passed<3).map(x=>({caseId:x.id,failedRoles:Object.keys(x.roleChecks).filter(k=>!x.roleChecks[k]),action:x.lesson}));
      try{const prior=JSON.parse(localStorage.getItem('ultron_local_neural_benchmarks')||'[]');const previous=Array.isArray(prior)?prior[0]:null;summary.previousScore=previous?.score?.accuracy??null;summary.scoreDelta=summary.previousScore===null?null:summary.score.accuracy-summary.previousScore;prior.unshift(summary);localStorage.setItem('ultron_local_neural_benchmarks',JSON.stringify(prior.slice(0,10)));const oldLessons=JSON.parse(localStorage.getItem('ultron_local_neural_lessons')||'[]');const newLessons=summary.improvementPlan.map(x=>x.action);localStorage.setItem('ultron_local_neural_lessons',JSON.stringify([...new Set([...newLessons,...(Array.isArray(oldLessons)?oldLessons:[])])].slice(0,5)));}catch{}
      state.lastBenchmark=summary;emit();return summary;
    },
    getLastBenchmark(){return state.lastBenchmark||null;},
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