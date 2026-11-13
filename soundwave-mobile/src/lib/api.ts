/**
 * Klien API SoundWave. Memakai server & akun yang sama dengan versi web.
 * Token sesi disimpan di SecureStore; dikirim sebagai "Authorization: Bearer".
 */
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { T } from './i18n';

const KEY_SERVER = 'sw_server';
const KEY_TOKEN = 'sw_token';

export const DEFAULT_SERVER = process.env.EXPO_PUBLIC_API_URL || 'https://vr.ti.fts.uika-bogor.ac.id/soundwave';

let server = DEFAULT_SERVER;
let token: string | null = null;
let media: { token: string; exp: number } | null = null;
let onUnauthorized: (() => void) | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}

/* ---------- Status koneksi ----------
 * "Offline" = server SoundWave tidak terjangkau (tanpa internet, atau server mati). Ditentukan dari hasil
 * permintaan API; selama offline aplikasi mengecek /api/ping tiap 10 detik dan saat kembali ke layar. */
let online = true;
const netSubs = new Set<(v: boolean) => void>();
let probe: ReturnType<typeof setInterval> | null = null;
export const isOnline = () => online;
export function subscribeOnline(fn: (v: boolean) => void) { netSubs.add(fn); return () => { netSubs.delete(fn); }; }
export function markOnline(v: boolean) {
  if (v === online) return;
  online = v;
  netSubs.forEach((f) => f(v));
  if (!v && !probe) probe = setInterval(ping, 10000);
  if (v && probe) { clearInterval(probe); probe = null; }
}
export async function ping() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(`${server}/api/ping`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    markOnline(r.ok);
  } catch { markOnline(false); } finally { clearTimeout(timer); }
  return online;
}
AppState.addEventListener('change', (st) => { if (st === 'active' && !online) ping(); });

/** Pesan galat yang aman ditampilkan: tanpa alamat server/link (mis. saat offline). */
export function errText(e: any, fallback = 'Terjadi kesalahan. Coba lagi.') {
  if (e?.status === 0 || /network request failed|failed to fetch|aborted|timeout|unable to resolve host|ECONN|ENOTFOUND|UnknownHost|SocketTimeout/i.test(String(e?.message || ''))) {
    return T(OFFLINE_MSG);
  }
  const m = String(e?.message || e || '').replace(/(https?|file|content):\/\/\S+/gi, '').replace(/\s{2,}/g, ' ').replace(/[:\s]+$/, '').trim();
  return m || T(fallback);
}
export const OFFLINE_MSG = 'Sedang offline — tidak dapat terhubung ke server SoundWave. Periksa koneksi internet.';

export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };
export const getServer = () => server;
export const hasToken = () => Boolean(token);

export async function loadSession() {
  server = (await SecureStore.getItemAsync(KEY_SERVER)) || DEFAULT_SERVER;
  token = await SecureStore.getItemAsync(KEY_TOKEN);
}

export async function setServer(url: string) {
  server = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(server)) server = `http://${server}`;
  await SecureStore.setItemAsync(KEY_SERVER, server);
}

export async function setToken(t: string | null, mediaToken?: string) {
  token = t;
  media = mediaToken ? { token: mediaToken, exp: Date.now() + 11 * 3600 * 1000 } : null;
  if (t) await SecureStore.setItemAsync(KEY_TOKEN, t);
  else await SecureStore.deleteItemAsync(KEY_TOKEN);
}

type Opts = { method?: string; body?: unknown; signal?: AbortSignal; timeout?: number };

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 30000);
  opts.signal?.addEventListener('abort', () => ctrl.abort());
  let res: Response;
  try {
    res = await fetch(server + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    });
  } catch (e: any) {
    if (opts.signal?.aborted) throw e;
    markOnline(false);
    // Jangan tampilkan alamat server/link di pesan galat
    throw new ApiError(T(OFFLINE_MSG), 0, 'OFFLINE');
  } finally {
    clearTimeout(timer);
  }
  markOnline(true);
  const data: any = await res.json().catch(() => ({}));
  // Sesi berakhir atau akun dinonaktifkan admin → keluar
  if (res.status === 401 && (data.code === 'UNAUTHENTICATED' || data.code === 'ACCOUNT_DISABLED')) onUnauthorized?.();
  if (!res.ok) throw new ApiError(data.error || `Kesalahan ${res.status}`, res.status, data.code);
  return data as T;
}

export const get = <T = any>(p: string, o?: Opts) => api<T>(p, o);
export const post = <T = any>(p: string, body: unknown = {}, o: Omit<Opts, 'method' | 'body'> = {}) => api<T>(p, { method: 'POST', body, ...o });
export const put = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PUT', body });
export const patch = <T = any>(p: string, body: unknown = {}) => api<T>(p, { method: 'PATCH', body });
export const del = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'DELETE', body });

/** Token pendek untuk URL streaming/unduh (dipakai pemutar & unduhan offline). */
export async function mediaToken(): Promise<string> {
  if (media && media.exp > Date.now()) return media.token;
  const r = await get<{ token: string; expiresIn: number }>('/api/auth/media-token');
  media = { token: r.token, exp: Date.now() + (r.expiresIn - 600) * 1000 };
  return r.token;
}

export async function streamUrl(fileId: string) {
  return `${server}/api/library/stream/${encodeURIComponent(fileId)}?t=${encodeURIComponent(await mediaToken())}`;
}
export async function jobFileUrl(jobId: string) {
  return `${server}/api/jobs/${encodeURIComponent(jobId)}/file?t=${encodeURIComponent(await mediaToken())}`;
}
export const embedUrl = (videoId: string) => `${server}/embed/${encodeURIComponent(videoId)}`;
export const ytThumb = (ytId?: string | null, hq = false) => (ytId ? `https://i.ytimg.com/vi/${ytId}/${hq ? 'hqdefault' : 'mqdefault'}.jpg` : null);
