import { db } from 'hatchable';
import { searchOpenKnowledge } from 'lib/open-knowledge.js';
export const access='admin';
export const methods=['GET','POST'];
export default async function(req,res){
 const owner=String(req.member.id);
 if(req.method==='GET'){
  const q=String(req.query?.q||'').trim();
  if(!q||q.length>180)return res.status(400).json({error:'Enter a research query up to 180 characters.'});
  try{return res.json(await searchOpenKnowledge(q));}
  catch(e){return res.status(502).json({error:'Open research indexes are temporarily unavailable.',detail:String(e?.message||e).slice(0,120)});}
 }
 const b=req.body||{};
 if(b.confirm_save!==true)return res.status(400).json({error:'Confirm that you want to save this source to your private knowledge library.'});
 const title=String(b.title||'').trim().slice(0,300),summary=String(b.summary||'').trim().slice(0,1800),source=String(b.source||'Open research index').trim().slice(0,120),url=String(b.url||'').trim(),published=String(b.published_at||'').slice(0,40);
 if(!title||!url||!summary)return res.status(400).json({error:'A title, HTTPS source URL and summary are required.'});
 let parsed;try{parsed=new URL(url)}catch{return res.status(400).json({error:'Invalid source URL.'});}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password)return res.status(400).json({error:'Only public HTTPS source URLs can be saved.'});
 const {rows}=await db.query('INSERT INTO ultron_knowledge (owner_id,topic,summary,source_url,source_name,published_at,source_status) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (SELECT 1 FROM ultron_knowledge WHERE owner_id=$1 AND source_url=$4 AND topic=$2) RETURNING id,topic,summary,source_url,source_name,published_at,created_at,source_status',[owner,title,summary,url,source,published,'unchecked']);
 if(!rows.length)return res.json({saved:false,duplicate:true,note:'This source is already saved for your account.'});
 return res.status(201).json({saved:true,knowledge:rows[0]});
}