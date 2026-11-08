/** Pembungkus fetch: sesi cookie + header CSRF, error dalam bahasa Indonesia. */
const listeners = new Set();
export const onUnauthorized = (fn) => listeners.add(fn);

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

// Deteksi subpath secara otomatis, misal /soundwave bila di-host di https://domain.com/soundwave/
export const BASE_PATH = (typeof window !== 'undefined' && window.location)
  ? window.location.pathname
      .replace(/\/admin(\.html)?\/?$/, '')
      .replace(/\/index\.html$/, '')
      .replace(/\/+$/, '')
  : '';

export const apiUrl = (p) => {
  if (!p || /^https?:\/\//i.test(p)) return p;
  const path = p.startsWith('/') ? p : '/' + p;
  return `${BASE_PATH}${path}`;
};

/** Batas waktu bawaan: permintaan yang tidak dijawab server tidak boleh membuat halaman menunggu selamanya. */
const DEFAULT_TIMEOUT = 60000;

export async function api(path, { method = 'GET', body, signal, timeout = DEFAULT_TIMEOUT } = {}) {
  const sig = signal || (timeout ? AbortSignal.timeout(timeout) : undefined);
  const opts = { method, credentials: 'same-origin', signal: sig, headers: { 'X-SW-CSRF': '1' } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(apiUrl(path), opts); } catch (e) {
    if (e.name === 'TimeoutError' && !signal) throw new ApiError('Server terlalu lama menjawab. Periksa koneksi lalu coba lagi.', 0, 'TIMEOUT');
    if (e.name === 'AbortError' || e.name === 'TimeoutError') throw e;
    throw new ApiError('Tidak dapat terhubung ke server.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.code === 'UNAUTHENTICATED') listeners.forEach((fn) => fn());
  if (!res.ok) throw new ApiError(data.error || `Kesalahan ${res.status}`, res.status, data.code);
  return data;
}

export const get = (p, o) => api(p, o);
export const post = (p, body, o = {}) => api(p, { method: 'POST', body: body ?? {}, ...o });
export const put = (p, body) => api(p, { method: 'PUT', body: body ?? {} });
export const patch = (p, body) => api(p, { method: 'PATCH', body: body ?? {} });
export const del = (p) => api(p, { method: 'DELETE' });
