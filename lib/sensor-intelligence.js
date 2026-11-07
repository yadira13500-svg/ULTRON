// Deterministic structuring for owner-supplied, authorised sensor and aviation exports.
// This is not a flight-control, threat-detection, or airworthiness system.
const ALLOWED_TYPES = new Set(['camera_snapshot','drone_telemetry','aircraft_telemetry','aircraft_maintenance','site_sensor']);
const NUMERIC_FIELDS = new Set(['latitude','longitude','altitude_m','speed_mps','heading_deg','battery_pct','temperature_c','pressure_hpa','voltage_v','current_a','flight_time_s','signal_strength']);
const TEXT_FIELDS = new Set(['status','gps_fix','mode','manufacturer','model','aircraft_type','drone_type','serial_label','maintenance_note','operator_note']);
const ARRAY_FIELDS = new Set(['warnings','fault_codes','maintenance_items']);
function boundedText(value, max=500) { return typeof value === 'string' ? value.trim().slice(0,max) : ''; }
export function buildSensorAssessment(input={}) {
  const sourceType=String(input.sourceType||'');
  if(!ALLOWED_TYPES.has(sourceType)) throw new Error('Unsupported sensor source type.');
  const sourceLabel=boundedText(input.sourceLabel,120);
  if(!sourceLabel) throw new Error('A source label is required.');
  const source=input.payload;
  if(!source || typeof source!=='object' || Array.isArray(source)) throw new Error('Provide a JSON object containing the authorised export.');
  const payload={};
  for(const [key,value] of Object.entries(source).slice(0,60)) {
    if(NUMERIC_FIELDS.has(key)) {
      if(value===null || value==='') continue;
      const n=Number(value);
      if(!Number.isFinite(n)) throw new Error('Telemetry field '+key+' must be numeric.');
      if(key==='latitude' && (n < -90 || n > 90)) throw new Error('Latitude is outside the valid range.');
      if(key==='longitude' && (n < -180 || n > 180)) throw new Error('Longitude is outside the valid range.');
      if(key==='battery_pct' && (n < 0 || n > 100)) throw new Error('Battery percentage must be between 0 and 100.');
      payload[key]=n;
    } else if(TEXT_FIELDS.has(key)) {
      const v=boundedText(value,1000); if(v) payload[key]=v;
    } else if(ARRAY_FIELDS.has(key) && Array.isArray(value)) {
      payload[key]=value.slice(0,30).map(x=>boundedText(x,240)).filter(Boolean);
    }
  }
  const warnings=[];
  const suppliedWarnings=Array.isArray(payload.warnings)?payload.warnings:[];
  if(suppliedWarnings.length) warnings.push(...suppliedWarnings.map(x=>'Source-reported warning: '+x));
  if(sourceType.includes('telemetry') && !('capturedAt' in input)) warnings.push('Capture time was not supplied; timing and freshness cannot be established.');
  if(!Object.keys(payload).length) warnings.push('No recognised telemetry fields were supplied; only source metadata will be retained.');
  return {
    schema:'ultron.sensor.assessment.v1',
    status:'pending_human_review',
    source:{type:sourceType,label:sourceLabel,capturedAt:input.capturedAt||null,mode:'authorized_export'},
    fields:payload,
    dataQuality:{recognisedFieldCount:Object.keys(payload).length,unrecognisedFields:Math.max(0,Object.keys(source).length-Object.keys(payload).length),warnings},
    interpretation:'Structured source-supplied values only. No independent validation, flight-safety determination, threat inference, or operational recommendation has been performed.',
    controls:{humanReviewRequired:true,deviceControl:false,flightControl:false,autonomousAction:false,identityRecognition:false,targeting:false}
  };
}
export function sensorAssessmentSelfTest() {
  const good=buildSensorAssessment({sourceType:'drone_telemetry',sourceLabel:'Test drone export',capturedAt:'2026-11-07T12:00:00Z',payload:{latitude:40.7,longitude:-74,battery_pct:82,altitude_m:50,warnings:['GPS intermittent'],secret:'discard'}});
  let invalidBattery=false,invalidLatitude=false,emptySource=false;
  try{buildSensorAssessment({sourceType:'drone_telemetry',sourceLabel:'x',payload:{battery_pct:140}})}catch{invalidBattery=true}
  try{buildSensorAssessment({sourceType:'aircraft_telemetry',sourceLabel:'x',payload:{latitude:120}})}catch{invalidLatitude=true}
  try{buildSensorAssessment({sourceType:'camera_snapshot',sourceLabel:'',payload:{}})}catch{emptySource=true}
  const ok=good.fields.battery_pct===82&&!('secret' in good.fields)&&good.controls.deviceControl===false&&good.controls.flightControl===false&&good.controls.humanReviewRequired&&invalidBattery&&invalidLatitude&&emptySource;
  return {ok,recognizedFields:Object.keys(good.fields).length,unknownFieldsDiscarded:!('secret' in good.fields),invalidBatteryRejected:invalidBattery,invalidLatitudeRejected:invalidLatitude,emptySourceRejected:emptySource,noDeviceOrFlightControl:good.controls.deviceControl===false&&good.controls.flightControl===false};
}