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

export async function checkSourceFreshness(value, fetchImpl = fetch) {
  let url = safeUrl(value);
  if (!url) return { status: 'blocked', httpStatus: 0, checkedUrl: '' };
  const headers = { 'User-Agent': 'ULTRON-Research/1.0' };
  let response = await fetchImpl(url.toString(), { method: 'HEAD', redirect: 'manual', timeout_ms: 8000, headers });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    const next = location ? safeUrl(new URL(String(location), url.toString()).toString()) : null;
    if (!next) return { status: 'redirected', httpStatus: response.status, checkedUrl: url.toString() };
    url = next;
    response = await fetchImpl(url.toString(), { method: 'HEAD', redirect: 'manual', timeout_ms: 8000, headers });
  }
  if (response.status === 405 || response.status === 501) {
    response = await fetchImpl(url.toString(), {
      method: 'GET', redirect: 'manual', timeout_ms: 8000,
      headers: { ...headers, Range: 'bytes=0-0', Accept: 'text/html,text/plain,application/pdf,*/*' }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const next = location ? safeUrl(new URL(String(location), url.toString()).toString()) : null;
      if (!next) return { status: 'redirected', httpStatus: response.status, checkedUrl: url.toString() };
      url = next;
      response = await fetchImpl(url.toString(), {
        method: 'GET', redirect: 'manual', timeout_ms: 8000,
        headers: { ...headers, Range: 'bytes=0-0', Accept: 'text/html,text/plain,application/pdf,*/*' }
      });
    }
  }
  let status = 'available';
  if (response.status === 404 || response.status === 410) status = 'unavailable';
  else if (response.status >= 300 && response.status < 400) status = 'redirected';
  else if (response.status >= 400) status = 'check_failed';
  return { status, httpStatus: response.status, checkedUrl: url.toString() };
}