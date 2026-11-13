/**
 * Salinan data di HP untuk dipakai saat offline (daftar playlist, isi playlist, playlist Quran).
 * Disimpan sebagai JSON di folder dokumen aplikasi; dihapus saat keluar akun.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { get } from './api';

const dir = () => {
  const d = new Directory(Paths.document, 'data-cache');
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  return d;
};
const fileOf = (key: string) => new File(dir(), `${key.replace(/[^\w.-]+/g, '_').slice(0, 120)}.json`);

export function readCache<T>(key: string): T | null {
  try { const f = fileOf(key); return f.exists ? (JSON.parse(f.textSync()) as T) : null; } catch { return null; }
}
export function writeCache(key: string, data: unknown) {
  try { const f = fileOf(key); if (!f.exists) f.create(); f.write(JSON.stringify(data)); } catch { /* abaikan */ }
}
export function clearCache() {
  try { const d = new Directory(Paths.document, 'data-cache'); if (d.exists) d.delete(); } catch { /* abaikan */ }
}

/**
 * Ambil dari server dan simpan salinannya. Bila server tak terjangkau (offline), pakai salinan terakhir.
 * `stale: true` berarti data dari salinan offline.
 */
export async function getCached<T>(key: string, path: string, opts?: { timeout?: number }): Promise<{ data: T; stale: boolean }> {
  try {
    const data = await get<T>(path, opts);
    writeCache(key, data);
    return { data, stale: false };
  } catch (e: any) {
    if (e?.status === 0) {
      const c = readCache<T>(key);
      if (c) return { data: c, stale: true };
    }
    throw e;
  }
}
