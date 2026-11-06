import { db } from 'hatchable';
export const access = 'admin';
export const methods = ['GET','POST','PUT','DELETE'];
const domains=['science','coding','business','world affairs','education'];
export default async function(req,res){
 const owner=String(req.member.id), b=req.body||{};
 if(req.method==='GET'){
  const [p,n,e,r,f,s]=await Promise.all([
   db.query('SELECT id,category,preference,confidence,source,confirmed,updated_at FROM ultron_preferences WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,label,node_type,description FROM ultron_graph_nodes WHERE owner_id=$1 ORDER BY label LIMIT 200',[owner]),
   db.query('SELECT id,from_id,to_id,relation,evidence,source_url,confidence FROM ultron_graph_edges WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 300',[owner]),
   db.query('SELECT id,topic,frequency,boundary,enabled,last_run_at FROM ultron_research_plans WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,question,response_excerpt,rating,correction,proposed_improvement,status,created_at FROM ultron_feedback WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner]),
   db.query('SELECT id,domain,title,objective,source_url,source_name,lesson,test_json,status,content_excerpt,ingested_at,last_error,created_at FROM ultron_skill_modules WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner])
  ]);
  return res.json({preferences:p.rows,nodes:n.rows,edges:e.rows,researchPlans:r.rows,feedback:f.rows,skills:s.rows,domains});
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
  if(type==='preference'){
   if(!b.category||!b.preference)return res.status(400).json({error:'Category and preference required.'});
   const {rows}=await db.query('INSERT INTO ultron_preferences(owner_id,category,preference,confidence,source,confirmed) VALUES($1,$2,$3,$4,$5,true) RETURNING *',[owner,String(b.category).slice(0,60),String(b.preference).slice(0,1000),1,'user']);
   return res.status(201).json({preference:rows[0]});
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
  if(b.type==='research_plan'&&b.id){const {rows}=await db.query('UPDATE ultron_research_plans SET enabled=$3,frequency=COALESCE($4,frequency),boundary=COALESCE($5,boundary),updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *',[b.id,owner,b.enabled===true,['daily','weekly','monthly'].includes(b.frequency)?b.frequency:null,typeof b.boundary==='string'?b.boundary.slice(0,1000):null]);return res.json({plan:rows[0]||null});}
  if(b.type==='feedback'&&b.id){const {rows}=await db.query('UPDATE ultron_feedback SET status=$3 WHERE id=$1 AND owner_id=$2 RETURNING *',[b.id,owner,['accepted','dismissed','implemented'].includes(b.status)?b.status:'proposed']);return res.json({feedback:rows[0]||null});}
  return res.status(400).json({error:'Unsupported update.'});
 }
 const type=String(b.type||''),id=String(b.id||'');if(!id)return res.status(400).json({error:'Record id required.'});
 const tables={preference:'ultron_preferences',research_plan:'ultron_research_plans',feedback:'ultron_feedback',skill:'ultron_skill_modules',node:'ultron_graph_nodes',edge:'ultron_graph_edges'};
 const table=tables[type];if(!table)return res.status(400).json({error:'Unsupported record type.'});
 const {rowCount}=await db.query('DELETE FROM '+table+' WHERE id=$1 AND owner_id=$2',[id,owner]);return res.json({ok:rowCount>0});
}