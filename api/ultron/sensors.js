import { db } from 'hatchable';
import { buildSensorAssessment } from 'lib/sensor-intelligence.js';
import { evaluateSentinelRequest } from 'lib/sentinel-safety.js';

export const access = 'admin';
export const methods = ['GET','POST'];

export default async function(req,res) {
  const owner=String(req.member.id);
  if(req.method==='GET') {
    const {rows}=await db.query('SELECT id,source_type,source_label,captured_at,assessment,review_status,created_at FROM ultron_sensor_observations WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100',[owner]);
    return res.json({observations:rows,deviceConnections:'not_configured',note:'Only owner-supplied authorised exports are supported. No live device connection is active.'});
  }
  const body=req.body||{};
  if(body.consent!==true || body.source_authorization!==true) return res.status(400).json({error:'Explicit consent and confirmation of authority to provide this export are required.'});
  if(typeof body.payload!=='object' || !body.payload || Array.isArray(body.payload) || JSON.stringify(body.payload).length>24000) return res.status(400).json({error:'Provide a JSON object no larger than 24 KB.'});
  const sourceType=String(body.source_type||'');
  const capturedAt=body.captured_at ? (Number.isNaN(Date.parse(body.captured_at)) ? null : new Date(body.captured_at).toISOString()) : null;
  if(body.captured_at && !capturedAt) return res.status(400).json({error:'Capture time must be a valid date/time.'});
  const policy=evaluateSentinelRequest({sourceType,sourceMode:'authorized_export',operation:sourceType==='aircraft_maintenance'?'assess_equipment_condition':'summarize_telemetry',consent:true,sourceAuthorization:true});
  if(!policy.allowed) return res.status(400).json({error:policy.reason,policy_code:policy.code});
  let assessment;
  try {
    assessment=buildSensorAssessment({sourceType,sourceLabel:body.source_label,capturedAt,payload:body.payload});
  } catch(error) { return res.status(400).json({error:String(error.message||error).slice(0,240)}); }
  const {rows}=await db.query('INSERT INTO ultron_sensor_observations (owner_id,source_type,source_label,captured_at,payload,assessment) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING id,source_type,source_label,captured_at,assessment,review_status,created_at',[owner,sourceType,assessment.source.label,capturedAt,JSON.stringify(assessment.fields),JSON.stringify(assessment)]);
  return res.status(201).json({observation:rows[0],saved:true});
}