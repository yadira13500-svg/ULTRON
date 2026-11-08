function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export async function sha256Hex(value) {
  const bytes=new TextEncoder().encode(typeof value==='string'?value:canonical(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function importHmacKey(secret) {
  if(typeof secret!=='string'||secret.length<32) throw new Error('Signing key is not configured or is too short.');
  return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}

export async function signAttestation(payload,secret) {
  const key=await importHmacKey(secret);
  return Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(canonical(payload)))).toString('base64url');
}

export async function verifyAttestation(payload,signature,secret) {
  try {
    const key=await importHmacKey(secret);
    const bytes=new Uint8Array(Buffer.from(String(signature),'base64url'));
    return await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(canonical(payload)));
  } catch {
    return false;
  }
}

export function isAttestationCurrent(record,now=Date.now()) {
  const expires=Date.parse(record?.expires_at||'');
  const completed=Date.parse(record?.completed_at||'');
  return Number.isFinite(expires)&&Number.isFinite(completed)&&expires>now&&completed<=now;
}