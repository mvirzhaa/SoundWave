/** Pembungkus fetch: sesi cookie + header CSRF, error dalam bahasa Indonesia. */
const listeners = new Set();
export const onUnauthorized = (fn) => listeners.add(fn);

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const opts = { method, credentials: 'same-origin', signal, headers: { 'X-SW-CSRF': '1' } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(path, opts); } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Tidak dapat terhubung ke server.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'UNAUTHENTICATED') listeners.forEach((fn) => fn());
  if (!res.ok) throw new ApiError(data.error || `Kesalahan ${res.status}`, res.status, data.code);
  return data;
}

export const get = (p, o) => api(p, o);
export const post = (p, body) => api(p, { method: 'POST', body: body ?? {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body ?? {} });
export const patch = (p, body) => api(p, { method: 'PATCH', body: body ?? {} });
export const del = (p) => api(p, { method: 'DELETE' });
