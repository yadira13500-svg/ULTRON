import { db } from 'hatchable';
export const access = 'admin';
export const methods = ['GET','DELETE'];
export default async function(req,res){
 const owner=String(req.member.id);
 if(req.method==='GET'){
  const q=String(req.query?.q||'').trim();
  const args=[owner];
  let where='owner_id=$1';
  if(q){args.push('%'+q.slice(0,100)+'%');where+=' AND (topic ILIKE $2 OR summary ILIKE $2)';}
  const {rows}=await db.query('SELECT id,topic,summary,source_url,source_name,published_at,created_at,last_checked_at,source_status,refresh_count,superseded_by FROM ultron_knowledge WHERE '+where+' ORDER BY created_at DESC LIMIT 100',args);
  return res.json({knowledge:rows,count:rows.length});
 }
 const id=String(req.body?.id||'');if(!id)return res.status(400).json({error:'Knowledge entry id required.'});
 const {rowCount}=await db.query('DELETE FROM ultron_knowledge WHERE id=$1 AND owner_id=$2',[id,owner]);return res.json({ok:rowCount>0});
}