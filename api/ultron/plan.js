import { planMission } from 'lib/mission-plan.js';

export const access = 'admin';
export const methods = ['POST'];

export default async function(req,res) {
  const body=req.body||{};
  const objective=String(body.objective||'').trim().slice(0,2000);
  if(!objective)return res.status(400).json({error:'Provide a mission objective under 2,000 characters.'});
  const sourceUrls=Array.isArray(body.source_urls)?body.source_urls:[];
  if(sourceUrls.length>4)return res.status(400).json({error:'Provide no more than four source URLs.'});
  const plan=planMission(objective,sourceUrls);
  return res.json({...plan,previewOnly:true,auditRecorded:false});
}