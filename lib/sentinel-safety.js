// ULTRON SENTINEL: conservative policy gate for authorized, non-lethal observation analysis.
// This module does not connect to sensors or control devices. It only validates analysis requests.
const SOURCE_TYPES = new Set(['uploaded_image','camera_snapshot','drone_image','drone_video_clip','drone_telemetry']);
const SOURCE_MODES = new Set(['user_upload','authorized_export']);
const ANALYSIS_OPERATIONS = new Set(['analyze_image','summarize_video','summarize_telemetry','compare_scene','create_incident_report']);
const PROHIBITED_OPERATIONS = new Set([
  'identify_person','face_recognition','biometric_identification','track_person',
  'select_target','target_selection','weapon_control','fire_control',
  'autonomous_flight','pilot_drone','bypass_access','covert_capture'
]);

export function evaluateSentinelRequest(input = {}) {
  const sourceType = String(input.sourceType || '');
  const sourceMode = String(input.sourceMode || '');
  const operation = String(input.operation || '');
  if (PROHIBITED_OPERATIONS.has(operation)) {
    return { allowed:false, code:'prohibited_operation', reason:'Identity recognition, person tracking, targeting, weapon control, autonomous flight and covert capture are outside Sentinel scope.' };
  }
  if (!SOURCE_TYPES.has(sourceType)) {
    return { allowed:false, code:'unsupported_source_type', reason:'Only an uploaded image, authorized camera snapshot, or authorized drone media/telemetry export is supported.' };
  }
  if (!SOURCE_MODES.has(sourceMode)) {
    return { allowed:false, code:'unsupported_source_mode', reason:'Use a user-uploaded file or an explicitly authorized export. Direct camera discovery and covert/live access are not supported.' };
  }
  if (input.consent !== true || input.sourceAuthorization !== true) {
    return { allowed:false, code:'authorization_required', reason:'Explicit consent and confirmation of authority to provide the source are required.' };
  }
  if (!ANALYSIS_OPERATIONS.has(operation)) {
    return { allowed:false, code:'unsupported_operation', reason:'Sentinel supports observation analysis and reporting only.' };
  }
  return {
    allowed:true,
    code:'authorized_analysis_only',
    sourceType,
    sourceMode,
    operation,
    humanReviewRequired:true,
    actionExecution:false,
    identityRecognition:false,
    targeting:false,
    deviceControl:false,
    factualCertaintyClaimed:false
  };
}

export function sentinelSafetySelfTest() {
  const good = evaluateSentinelRequest({sourceType:'uploaded_image',sourceMode:'user_upload',operation:'analyze_image',consent:true,sourceAuthorization:true});
  const camera = evaluateSentinelRequest({sourceType:'camera_snapshot',sourceMode:'authorized_export',operation:'compare_scene',consent:true,sourceAuthorization:true});
  const drone = evaluateSentinelRequest({sourceType:'drone_telemetry',sourceMode:'authorized_export',operation:'summarize_telemetry',consent:true,sourceAuthorization:true});
  const noConsent = evaluateSentinelRequest({sourceType:'camera_snapshot',sourceMode:'authorized_export',operation:'analyze_image',consent:false,sourceAuthorization:true});
  const noAuthority = evaluateSentinelRequest({sourceType:'drone_image',sourceMode:'authorized_export',operation:'analyze_image',consent:true,sourceAuthorization:false});
  const live = evaluateSentinelRequest({sourceType:'camera_snapshot',sourceMode:'live_stream',operation:'analyze_image',consent:true,sourceAuthorization:true});
  const identity = evaluateSentinelRequest({sourceType:'uploaded_image',sourceMode:'user_upload',operation:'identify_person',consent:true,sourceAuthorization:true});
  const targeting = evaluateSentinelRequest({sourceType:'drone_image',sourceMode:'authorized_export',operation:'select_target',consent:true,sourceAuthorization:true});
  const control = evaluateSentinelRequest({sourceType:'drone_telemetry',sourceMode:'authorized_export',operation:'autonomous_flight',consent:true,sourceAuthorization:true});
  const allowed = [good,camera,drone].every(x=>x.allowed && x.humanReviewRequired && x.actionExecution===false);
  const blocked = [noConsent,noAuthority,live,identity,targeting,control].every(x=>!x.allowed);
  return {ok:allowed&&blocked,allowedExamples:3,blockedExamples:6,humanReviewRequired:true,deviceControl:false,identityRecognition:false,targeting:false,detail:allowed&&blocked?'Authorized uploaded/exported observation analysis is allowed; missing authorization, direct live access, identity recognition, targeting and device control are blocked.':'A Sentinel authorization or prohibited-operation boundary regressed.'};
}