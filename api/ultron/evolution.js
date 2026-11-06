import { db } from 'hatchable';
export const access = 'admin';
export const methods = ['GET','POST','PUT','DELETE'];
const domains=['science','coding','business','world affairs','education'];
export default async function(req,res){
 const owner=String(req.member.id), b=req.body||{};
 if(req.method==='GET'){
  const [p,n,e,r,f,s,g,l,c]=await Promise.all([
   db.query('SELECT id,category,preference,confidence,source,confirmed,updated_at FROM ultron_preferences WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,label,node_type,description FROM ultron_graph_nodes WHERE owner_id=$1 ORDER BY label LIMIT 200',[owner]),
   db.query('SELECT id,from_id,to_id,relation,evidence,source_url,confidence FROM ultron_graph_edges WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 300',[owner]),
   db.query('SELECT id,topic,frequency,boundary,enabled,last_run_at FROM ultron_research_plans WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,question,response_excerpt,rating,correction,proposed_improvement,status,created_at FROM ultron_feedback WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,domain,title,objective,source_url,source_name,lesson,test_json,status,content_excerpt,ingested_at,last_error,created_at FROM ultron_skill_modules WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,from_id,to_id,relation,rationale,evidence,source_quality,evidence_strength,status,created_at,reviewed_at FROM ultron_graph_suggestions WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,lesson,evidence,confidence,status,created_at,reviewed_at FROM ultron_agent_lessons WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,run_id,step_id,claim_text,assessment_status,review_status,verification_state,method,assessment,reviewer_note,correction,created_at,reviewed_at FROM ultron_claim_reviews WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner])
  ]);
  return res.json({preferences:p.rows,nodes:n.rows,edges:e.rows,researchPlans:r.rows,feedback:f.rows,skills:s.rows,suggestions:g.rows,agentLessons:l.rows,claimReviews:c.rows,domains});
 }
 if(req.method==='POST'){
  const type=String(b.type||'');
  if(type==='knowledge_sync'){
   const {rows}=await db.query("SELECT id,topic,summary,source_url,source_name,published_at,source_status FROM ultron_knowledge WHERE owner_id=$1 AND source_url LIKE 'https://%' ORDER BY created_at DESC LIMIT 100",[owner]);
   let linked=0;
   for(const item of rows){
    const topicLabel=String(item.topic||'').slice(0,180);if(!topicLabel)continue;
    const topic=await db.query("INSERT INTO ultron_graph_nodes(owner_id,label,node_type,description) VALUES($1,$2,'topic',$3) ON CONFLICT(owner_id,label,node_type) DO UPDATE SET description=CASE WHEN EXCLUDED.description<>'' THEN EXCLUDED.description ELSE ultron_graph_nodes.description END RETURNING id",[owner,topicLabel,String(item.summary||'').slice(0,1000)]);
    const sourceLabel=('Source: '+String(item.source_name||'Research source')+' · '+topicLabel+' · '+String(item.id).slice(0,8)).slice(0,180);
    const source=await db.query("INSERT INTO ultron_graph_nodes(owner_id,label,node_type,description) VALUES($1,$2,'source',$3) ON CONFLICT(owner_id,label,node_type) DO UPDATE SET description=EXCLUDED.description RETURNING id",[owner,sourceLabel,String(item.source_url).slice(0,1000)]);
    const evidence=[String(item.summary||'Saved research source.'),item.published_at?'Publication date: '+item.published_at:'Publication date unavailable',item.source_status?'Source status: '+item.source_status:'Source status not checked'].join(' · ').slice(0,1000);
    await db.query("INSERT INTO ultron_graph_edges(owner_id,from_id,to_id,relation,evidence,source_url,confidence) VALUES($1,$2,$3,'documented by',$4,$5,0.5) ON CONFLICT(owner_id,from_id,to_id,relation) DO UPDATE SET evidence=EXCLUDED.evidence,source_url=EXCLUDED.source_url",[owner,topic.rows[0].id,source.rows[0].id,evidence,String(item.source_url).slice(0,1000)]);
    linked++;
   }
   return res.json({ok:true,linked,scanned:rows.length,note:'Saved research sources are linked as evidence records; this does not independently verify their claims.'});
  }
  if(type==='discover_relationships'){
   const {rows}=await db.query("SELECT id,topic,summary,source_url,source_name,published_at,source_status,created_at FROM ultron_knowledge WHERE owner_id=$1 AND source_url LIKE 'https://%' AND COALESCE(source_status,'unchecked') NOT IN ('blocked','unavailable') ORDER BY created_at DESC LIMIT 100",[owner]);
   const quality=x=>{let score=0.35;const host=(()=>{try{return new URL(x.source_url).hostname.replace(/^www\\./,'').toLowerCase()}catch{return ''}})();if(/\\.(gov|edu)$/.test(host)||/\\.(gov|edu)\\./.test(host))score+=0.3;else if(/reuters\\.com|apnews\\.com|bbc\\.co\\.uk|bbc\\.com|who\\.int|un\\.org|worldbank\\.org|nature\\.com|science\\.org|ft\\.com|npr\\.org|theguardian\\.com/.test(host))score+=0.25;else if(host)score+=0.1;if(x.source_status==='available')score+=0.1;if(x.published_at){const age=Date.now()-Date.parse(x.published_at);if(Number.isFinite(age)&&age<30*86400000)score+=0.1;else if(Number.isFinite(age)&&age<365*86400000)score+=0.05}return Math.max(0,Math.min(1,score))};
   const named=x=>{const t=String(x||'');const found=t.match(/\\b(?:[A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]{2,}){1,3})\\b/g)||[];return [...new Set(found.map(v=>v.toLowerCase()))].filter(v=>!['united states','united kingdom','new york','world health','prime minister'].includes(v))};
   const relation=x=>{const t=String(x||'').toLowerCase();const patterns=[['influences',/\\b(influences|drives|shapes|affects)\\b/],['causes or contributes to',/\\b(causes|contributes to|leads to|results in)\\b/],['cooperates with',/\\b(cooperates with|partners with|jointly)\\b/],['responds to',/\\b(responds to|reacts to|in response to)\\b/],['depends on',/\\b(depends on|relies on|is dependent on)\\b/]];return patterns.find(x=>x[1].test(t))?.[0]||''};
   let created=0,checked=0;
   for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i],c=rows[j];if(a.topic===c.topic||a.source_url===c.source_url)continue;checked++;
    const shared=named(a.summary+' '+a.topic).filter(v=>named(c.summary+' '+c.topic).includes(v));if(!shared.length)continue;
    const relA=relation(a.summary),relB=relation(c.summary);if(!relA||!relB||relA!==relB)continue;const rel=relA;
    const evidence=[a,c].map(x=>({source:x.source_name||new URL(x.source_url).hostname,url:x.source_url,topic:x.topic,excerpt:String(x.summary||'').slice(0,700),published_at:x.published_at||null,status:x.source_status||'unchecked',quality:quality(x)}));
    const rationale='Both independently saved sources mention '+shared[0]+' and contain explicit relationship language ('+rel+'). This is a candidate interpretation, not a verified causal conclusion.';
    const from=await db.query("INSERT INTO ultron_graph_nodes(owner_id,label,node_type,description) VALUES($1,$2,'topic','') ON CONFLICT(owner_id,label,node_type) DO UPDATE SET label=EXCLUDED.label RETURNING id",[owner,String(a.topic).slice(0,180)]);
    const to=await db.query("INSERT INTO ultron_graph_nodes(owner_id,label,node_type,description) VALUES($1,$2,'topic','') ON CONFLICT(owner_id,label,node_type) DO UPDATE SET label=EXCLUDED.label RETURNING id",[owner,String(c.topic).slice(0,180)]);
    if(from.rows[0].id===to.rows[0].id)continue;
    const q=(quality(a)+quality(c))/2;
    const ins=await db.query("INSERT INTO ultron_graph_suggestions(owner_id,from_id,to_id,relation,rationale,evidence,source_quality,evidence_strength) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) ON CONFLICT(owner_id,from_id,to_id,relation) DO UPDATE SET rationale=EXCLUDED.rationale,evidence=EXCLUDED.evidence,source_quality=EXCLUDED.source_quality,evidence_strength=EXCLUDED.evidence_strength WHERE ultron_graph_suggestions.status='pending' RETURNING id",[owner,from.rows[0].id,to.rows[0].id,rel,rationale,JSON.stringify(evidence),q,0.7]);
    if(ins.rowCount)created++;
   }
   return res.json({ok:true,created,checkedPairs:checked,note:'Only cross-topic pairs with two distinct source URLs, a shared named entity and explicit relationship language are proposed. Shared keywords alone are not enough. Quality scores assess source signals and freshness, not truth.'});
  }
  if(type==='preference'){
   if(!b.category||!b.preference)return res.status(400).json({error:'Category and preference required.'});
   const {rows}=await db.query('INSERT INTO ultron_preferences(owner_id,category,preference,confidence,source,confirmed) VALUES($1,$2,$3,$4,$5,true) RETURNING *',[owner,String(b.category).slice(0,60),String(b.preference).slice(0,1000),1,'user']);
   return res.status(201).json({preference:rows[0]});
  }
  if(type==='preference_suggestion'){
   const categories=['working_hours','routine','communication','priority'];
   const category=String(b.category||'');const preference=String(b.preference||'').trim();
   if(!categories.includes(category)||!preference||preference.length>1000)return res.status(400).json({error:'A supported preference category and value are required.'});
   const existing=await db.query('SELECT id FROM ultron_preferences WHERE owner_id=$1 AND category=$2 AND lower(preference)=lower($3) LIMIT 1',[owner,category,preference]);
   if(existing.rows[0])return res.json({suggested:false,duplicate:true,id:existing.rows[0].id,note:'This preference is already in your learning list.'});
   const {rows}=await db.query('INSERT INTO ultron_preferences(owner_id,category,preference,confidence,source,confirmed) VALUES($1,$2,$3,$4,$5,false) RETURNING id,category,preference,confirmed,source',[owner,category,preference,0.65,'conversation_suggestion']);
   return res.status(201).json({suggested:true,preference:rows[0],note:'Saved as a suggestion only. It will not guide ULTRON until you confirm it.'});
  }
  if(type==='research_plan'){
   if(!String(b.topic||'').trim())return res.status(400).json({error:'Research topic required.'});
   const freq=['daily','weekly','monthly'].includes(b.frequency)?b.frequency:'weekly';
   const {rows}=await db.query('INSERT INTO ultron_research_plans(owner_id,topic,frequency,boundary,enabled) VALUES($1,$2,$3,$4,$5) RETURNING *',[owner,String(b.topic).slice(0,240),freq,String(b.boundary||'').slice(0,1000),b.enabled===true]);
   return res.status(201).json({plan:rows[0],note:b.enabled===true?'Research authorized. ULTRON will pick this topic up on its next hourly research-pipeline run.':'Research plan saved paused; enable it to authorize scheduled runs.'});
  }
  if(type==='feedback'){
   if(!b.question||!['helpful','incorrect','incomplete'].includes(b.rating))return res.status(400).json({error:'Question and valid rating required.'});
   const {rows}=await db.query('INSERT INTO ultron_feedback(owner_id,question,response_excerpt,rating,correction,proposed_improvement) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[owner,String(b.question).slice(0,2000),String(b.response_excerpt||'').slice(0,3000),b.rating,String(b.correction||'').slice(0,3000),String(b.proposed_improvement||'').slice(0,1500)]);
   return res.status(201).json({feedback:rows[0]});
  }
  if(type==='skill'){
   if(!domains.includes(String(b.domain||''))||!b.title||!b.source_url)return res.status(400).json({error:'Choose a supported domain, title and trusted documentation URL.'});
   const {rows}=await db.query('INSERT INTO ultron_skill_modules(owner_id,domain,title,objective,source_url,source_name,lesson,test_json,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) RETURNING *',[owner,b.domain,String(b.title).slice(0,180),String(b.objective||'').slice(0,1000),String(b.source_url).slice(0,1000),String(b.source_name||'').slice(0,120),String(b.lesson||'').slice(0,5000),JSON.stringify(Array.isArray(b.test)?b.test.slice(0,20):[]),'draft']);
   return res.status(201).json({skill:rows[0]});
  }
  if(type==='graph'){
   if(!b.from||!b.to||!b.relation)return res.status(400).json({error:'Two topic labels and a relationship are required.'});
   const node=async label=>{const x=await db.query('INSERT INTO ultron_graph_nodes(owner_id,label,node_type) VALUES($1,$2,$3) ON CONFLICT(owner_id,label,node_type) DO UPDATE SET label=EXCLUDED.label RETURNING id',[owner,String(label).slice(0,180),'topic']);return x.rows[0].id};
   const from=await node(b.from),to=await node(b.to);
   const {rows}=await db.query('INSERT INTO ultron_graph_edges(owner_id,from_id,to_id,relation,evidence,source_url,confidence) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,from_id,to_id,relation) DO UPDATE SET evidence=EXCLUDED.evidence,source_url=EXCLUDED.source_url,confidence=EXCLUDED.confidence RETURNING *',[owner,from,to,String(b.relation).slice(0,120),String(b.evidence||'').slice(0,1000),String(b.source_url||'').slice(0,1000),Math.max(0,Math.min(1,Number(b.confidence)||0.5))]);
   return res.status(201).json({edge:rows[0]});
  }
  return res.status(400).json({error:'Unknown evolution record type.'});
 }
 if(req.method==='PUT'){
  if(b.type==='preference'&&b.id){const {rows}=await db.query('UPDATE ultron_preferences SET preference=$3,confirmed=true,source=$4,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *',[b.id,owner,String(b.preference||'').slice(0,1000),'user']);return res.json({preference:rows[0]||null});}
  if(b.type==='preference_confirm'&&b.id){const {rows}=await db.query('UPDATE ultron_preferences SET confirmed=true,source=$3,confidence=1,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *',[b.id,owner,'user']);return res.json({preference:rows[0]||null});}
  if(b.type==='research_plan'&&b.id){const {rows}=await db.query('UPDATE ultron_research_plans SET enabled=$3,frequency=COALESCE($4,frequency),boundary=COALESCE($5,boundary),updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *',[b.id,owner,b.enabled===true,['daily','weekly','monthly'].includes(b.frequency)?b.frequency:null,typeof b.boundary==='string'?b.boundary.slice(0,1000):null]);return res.json({plan:rows[0]||null});}
  if(b.type==='feedback'&&b.id){const {rows}=await db.query('UPDATE ultron_feedback SET status=$3 WHERE id=$1 AND owner_id=$2 RETURNING *',[b.id,owner,['accepted','dismissed','implemented'].includes(b.status)?b.status:'proposed']);return res.json({feedback:rows[0]||null});}
  if(b.type==='claim_review'&&b.id){const status=['accepted','rejected','corrected'].includes(b.status)?b.status:null;if(!status)return res.status(400).json({error:'Choose accepted, rejected or corrected.'});const correction=String(b.correction||'').trim().slice(0,3000),note=String(b.reviewer_note||'').trim().slice(0,2000);if(status==='corrected'&&!correction)return res.status(400).json({error:'Provide the corrected claim or explanation.'});const {rows}=await db.query("UPDATE ultron_claim_reviews SET review_status=$3,verification_state='human_reviewed',reviewer_note=$4,correction=$5,reviewed_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id,run_id,step_id,claim_text,assessment_status,assessment,review_status,verification_state,reviewed_at,correction,reviewer_note",[b.id,owner,status,note,correction]);const review=rows[0];if(!review)return res.status(404).json({error:'Claim review not found.'});let lesson=null;const learningSignal=status==='corrected'?correction:note;if(learningSignal.trim().length>=12){const sources=Array.isArray(review.assessment?.allSources)?review.assessment.allSources:[];const lessonText=status==='corrected'?'Case-specific correction: for the claim “'+review.claim_text.slice(0,500)+'”, the owner supplied this correction: “'+correction.slice(0,1500)+'”. Apply this correction only to this case unless later evidence supports a broader rule.':'Case-specific review: the owner marked the assessment for “'+review.claim_text.slice(0,500)+'” as '+status+' and provided this rationale: “'+note.slice(0,1500)+'”. Treat this as a case-specific human judgement, not a universal rule.';const evidence={kind:'human_claim_review',reviewId:review.id,runId:review.run_id,stepId:review.step_id,claim:review.claim_text,assessmentStatus:review.assessment_status,reviewStatus:status,reviewerNote:note,correction,sourceUrls:sources.map(x=>x.url).filter(Boolean),sourceHosts:sources.map(x=>x.host).filter(Boolean),machineVerified:false,humanReviewed:true};const saved=await db.query("INSERT INTO ultron_agent_lessons(owner_id,lesson_key,lesson,evidence,confidence,status) VALUES($1,$2,$3,$4::jsonb,0.7,'candidate') ON CONFLICT(owner_id,lesson_key) DO UPDATE SET lesson=EXCLUDED.lesson,evidence=EXCLUDED.evidence,confidence=EXCLUDED.confidence,status=CASE WHEN ultron_agent_lessons.status='approved' THEN 'approved' ELSE 'candidate' END RETURNING id,status",[owner,'claim-review:'+review.id,lessonText,JSON.stringify(evidence)]);lesson=saved.rows[0]||null;}return res.json({claimReview:review,learningCandidate:lesson,note:'Your review is recorded. A case-specific lesson candidate is created only when you provide a substantive correction or rationale. It remains unapproved until you approve it; human review does not prove machine-verified truth.'});}
  if(b.type==='agent_lesson'&&b.id){const status=['approved','dismissed'].includes(b.status)?b.status:null;if(!status)return res.status(400).json({error:'Choose approve or dismiss.'});const {rows}=await db.query("UPDATE ultron_agent_lessons SET status=$3,reviewed_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('candidate','approved') RETURNING id,status,reviewed_at",[b.id,owner,status]);return res.json({lesson:rows[0]||null,approved:status==='approved'});}
  if(b.type==='graph_suggestion'&&b.id){const status=['approved','rejected'].includes(b.status)?b.status:null;if(!status)return res.status(400).json({error:'Choose approve or reject.'});const s=await db.query("SELECT * FROM ultron_graph_suggestions WHERE id=$1 AND owner_id=$2 AND status='pending'",[b.id,owner]);if(!s.rows[0])return res.status(404).json({error:'Pending suggestion not found.'});const item=s.rows[0];if(status==='approved'){const ev=Array.isArray(item.evidence)?item.evidence:[];const evidence=String(item.rationale+' Evidence: '+ev.map(x=>(x.source||'Source')+': '+(x.excerpt||'')).join(' | ')).slice(0,1000);const sourceUrl=ev.map(x=>x.url).filter(Boolean).join(' | ').slice(0,1000);await db.query('INSERT INTO ultron_graph_edges(owner_id,from_id,to_id,relation,evidence,source_url,confidence) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner_id,from_id,to_id,relation) DO UPDATE SET evidence=EXCLUDED.evidence,source_url=EXCLUDED.source_url,confidence=EXCLUDED.confidence',[owner,item.from_id,item.to_id,item.relation,evidence,sourceUrl,Math.min(0.85,Number(item.evidence_strength)||0.7)]);}const updated=await db.query('UPDATE ultron_graph_suggestions SET status=$3,reviewed_at=now() WHERE id=$1 AND owner_id=$2 RETURNING id,status,reviewed_at',[b.id,owner,status]);return res.json({suggestion:updated.rows[0],promoted:status==='approved'});}
  return res.status(400).json({error:'Unsupported update.'});
 }
 const type=String(b.type||''),id=String(b.id||'');if(!id)return res.status(400).json({error:'Record id required.'});
 const tables={preference:'ultron_preferences',research_plan:'ultron_research_plans',feedback:'ultron_feedback',skill:'ultron_skill_modules',node:'ultron_graph_nodes',edge:'ultron_graph_edges'};
 const table=tables[type];if(!table)return res.status(400).json({error:'Unsupported record type.'});
 const {rowCount}=await db.query('DELETE FROM '+table+' WHERE id=$1 AND owner_id=$2',[id,owner]);return res.json({ok:rowCount>0});
}