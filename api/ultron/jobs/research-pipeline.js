import { db } from 'hatchable';
import { searchPublicWeb } from 'lib/search.js';

export const access = 'scheduler';
export const methods = ['POST'];

const safeUrl = value => {
  try {
    const u = new URL(String(value || ''));
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') ||
        /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === '::1' || h.startsWith('[')) return null;
    return u;
  } catch { return null; }
};
const clean = html => String(html || '')
 .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi,' ')
 .replace(/<br\s*\/?>|<\/p>|<\/h[1-6]>/gi,'\n')
 .replace(/<[^>]+>/g,' ')
 .replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"')
 .replace(/&#39;/g,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
 .replace(/[ \t\r]+/g,' ').replace(/\n\s*\n+/g,'\n').trim().slice(0,14000);

async function ingestSkill(row) {
  const u=safeUrl(row.source_url);
  if(!u) {
    await db.query("UPDATE ultron_skill_modules SET status='blocked',last_error='Only public HTTPS documentation URLs are accepted.' WHERE id=$1 AND owner_id=$2",[row.id,row.owner_id]);
    return 'blocked';
  }
  try {
    const response=await fetch(u.toString(),{redirect:'manual',timeout_ms:12000,headers:{'Accept':'text/html, text/plain, application/xhtml+xml','User-Agent':'ULTRON-Research/1.0'}});
    if(!response.ok) throw new Error('Source returned HTTP '+response.status);
    const type=String(response.headers.get('content-type')||'').toLowerCase();
    if(type && !/(text\/html|text\/plain|application\/xhtml\+xml)/.test(type)) throw new Error('Source is not an HTML or text documentation page.');
    const raw=await response.text();
    const excerpt=clean(raw);
    if(excerpt.length<250) throw new Error('The page did not expose enough readable documentation text.');
    const lesson=(row.lesson ? row.lesson+'\n\n' : '')+'Extracted documentation notes (source page; review before relying on them):\n'+excerpt;
    const sentences=excerpt.split(/\n|(?<=[.!?])\s+/).map(x=>x.trim()).filter(x=>x.length>=45&&x.length<=700).slice(0,10);
    const concepts=sentences.map((sentence,i)=>({id:'concept_'+(i+1),title:sentence.split(/\s+/).slice(0,8).join(' ').replace(/[,:;.]$/,''),summary:sentence,source_url:u.toString(),evidence_type:'source_excerpt',review_status:'proposed'}));
    const objectives=concepts.map(c=>({concept_id:c.id,objective:'Explain '+c.title.toLowerCase()+' in your own words, identify when it applies, and demonstrate it in a practical example.',assessment_signal:'A correct explanation plus a separate practical demonstration',status:'proposed'}));
    const tests=(Array.isArray(row.test_json)?row.test_json:[]).map((q,i)=>({...q,concept_id:concepts.length?concepts[i%concepts.length].id:''}));
    await db.query("UPDATE ultron_skill_modules SET content_excerpt=$3,lesson=$4,concepts_json=$5::jsonb,objectives_json=$6::jsonb,test_json=$7::jsonb,ingested_at=now(),status='ready',last_error='' WHERE id=$1 AND owner_id=$2",[row.id,row.owner_id,excerpt,lesson.slice(0,19000),JSON.stringify(concepts),JSON.stringify(objectives),JSON.stringify(tests)]);
    return 'ingested';
  } catch(e) {
    await db.query("UPDATE ultron_skill_modules SET status='needs_review',last_error=$3 WHERE id=$1 AND owner_id=$2",[row.id,row.owner_id,String(e?.message||e).slice(0,240)]);
    return 'needs_review';
  }
}

export default async function(req,res) {
  let researchPlans=0, researchSources=0, refreshed=0, skillsIngested=0, skillsReview=0;
  const now=Date.now();
  const due=(await db.query("SELECT id,owner_id,topic,frequency,boundary,last_run_at FROM ultron_research_plans WHERE enabled=true AND (last_run_at IS NULL OR (frequency='daily' AND last_run_at < now()-interval '23 hours') OR (frequency='weekly' AND last_run_at < now()-interval '6 days 23 hours') OR (frequency='monthly' AND last_run_at < now()-interval '29 days')) ORDER BY last_run_at NULLS FIRST LIMIT 8")).rows;
  for(const plan of due) {
    try {
      const query=plan.boundary ? plan.topic+' '+plan.boundary : plan.topic;
      const result=await searchPublicWeb(query,'US');
      const entries=(result.results||[]).filter(x=>x?.title&&x?.url&&safeUrl(x.url)).slice(0,5);
      for(const item of entries) {
        const summary=String(item.snippet||item.description||item.title).replace(/<[^>]*>/g,'').slice(0,1200);
        const source=new URL(item.url).hostname.slice(0,160);
        const saved=await db.query("INSERT INTO ultron_knowledge(owner_id,topic,summary,source_url,source_name,published_at,source_status,last_checked_at) SELECT $1,$2,$3,$4,$5,$6,'available',now() WHERE NOT EXISTS (SELECT 1 FROM ultron_knowledge WHERE owner_id=$1 AND topic=$2 AND source_url=$4) RETURNING id",[plan.owner_id,plan.topic.slice(0,240),summary,String(item.url).slice(0,1000),source,String(item.published_at||'').slice(0,120)]);
        researchSources+=saved.rowCount||0;
      }
      await db.query('UPDATE ultron_research_plans SET last_run_at=now(),updated_at=now() WHERE id=$1 AND owner_id=$2',[plan.id,plan.owner_id]);
      researchPlans++;
    } catch(e) { console.error('ULTRON scheduled research failed',plan.id,String(e?.message||e).slice(0,160)); }
  }

  const old=(await db.query("SELECT id,owner_id,topic,source_url FROM ultron_knowledge WHERE source_url<>'' AND (last_checked_at IS NULL OR last_checked_at < now()-interval '7 days') ORDER BY last_checked_at NULLS FIRST,created_at ASC LIMIT 8")).rows;
  for(const item of old) {
    const u=safeUrl(item.source_url);
    if(!u) {
      await db.query("UPDATE ultron_knowledge SET source_status='blocked',last_checked_at=now() WHERE id=$1 AND owner_id=$2",[item.id,item.owner_id]);
      continue;
    }
    try {
      let r=await fetch(u.toString(),{method:'HEAD',redirect:'manual',timeout_ms:8000,headers:{'User-Agent':'ULTRON-Research/1.0'}});
      if(r.status>=300&&r.status<400) {
        const location=r.headers.get('location');
        const next=location?safeUrl(new URL(location,u).toString()):null;
        if(next) r=await fetch(next.toString(),{method:'HEAD',redirect:'manual',timeout_ms:8000,headers:{'User-Agent':'ULTRON-Research/1.0'}});
      }
      let status='available';
      if(r.status===404||r.status===410) status='unavailable';
      else if(r.status>=300&&r.status<400) status='redirected';
      else if(r.status>=400) status='check_failed';
      await db.query('UPDATE ultron_knowledge SET source_status=$3,last_checked_at=now(),refresh_count=refresh_count+1 WHERE id=$1 AND owner_id=$2',[item.id,item.owner_id,status]);
      if(status==='unavailable'||status==='redirected') {
        const replacement=await searchPublicWeb(item.topic,'US');
        const candidate=(replacement.results||[]).find(x=>x?.url&&safeUrl(x.url)&&String(x.url)!==item.source_url);
        if(candidate) {
          const inserted=await db.query("INSERT INTO ultron_knowledge(owner_id,topic,summary,source_url,source_name,published_at,source_status,last_checked_at) SELECT $1,$2,$3,$4,$5,$6,'available',now() WHERE NOT EXISTS (SELECT 1 FROM ultron_knowledge WHERE owner_id=$1 AND topic=$2 AND source_url=$4) RETURNING id",[item.owner_id,item.topic,String(candidate.snippet||candidate.title).slice(0,1200),String(candidate.url).slice(0,1000),new URL(candidate.url).hostname.slice(0,160),String(candidate.published_at||'').slice(0,120)]);
          if(inserted.rows[0]?.id) await db.query('UPDATE ultron_knowledge SET superseded_by=$3 WHERE id=$1 AND owner_id=$2',[item.id,item.owner_id,inserted.rows[0].id]);
        }
      }
      refreshed++;
    } catch {
      await db.query("UPDATE ultron_knowledge SET source_status='check_failed',last_checked_at=now(),refresh_count=refresh_count+1 WHERE id=$1 AND owner_id=$2",[item.id,item.owner_id]);
      refreshed++;
    }
  }

  const pending=(await db.query("SELECT id,owner_id,domain,title,objective,source_url,source_name,lesson,test_json FROM ultron_skill_modules WHERE status='draft' AND source_url<>'' ORDER BY created_at ASC LIMIT 3")).rows;
  for(const skill of pending) {
    const state=await ingestSkill(skill);
    if(state==='ingested') skillsIngested++;
    if(state==='needs_review'||state==='blocked') skillsReview++;
  }
  return res.json({ok:true,researchPlansRun:researchPlans,researchSourcesSaved:researchSources,sourcesChecked:refreshed,skillsIngested,skillsNeedingReview:skillsReview,checkedAt:new Date(now).toISOString(),note:'Free public web search and direct public documentation fetch only. No model inference, embeddings, or paid provider calls.'});
}