/** Palet warna gelap & terang (sama dengan versi web). */
export type Palette = {
  bg: string; surface: string; surface2: string; border: string; text: string; muted: string;
  accent: string; accent2: string; danger: string; ok: string; warn: string;
};
export const DARK: Palette = {
  bg: '#070b1d', surface: '#10162f', surface2: '#182042', border: '#263058', text: '#e8ebff', muted: '#9aa3c7',
  accent: '#8b6dff', accent2: '#22d3ee', danger: '#ff6b7d', ok: '#34d399', warn: '#fbbf24',
};
export const LIGHT: Palette = {
  bg: '#f3f5fc', surface: '#ffffff', surface2: '#e8ecf8', border: '#d9def0', text: '#151a33', muted: '#5d6688',
  accent: '#6d4dff', accent2: '#0891b2', danger: '#e11d48', ok: '#059669', warn: '#b45309',
};

export type Scheme = 'dark' | 'light';
/** Palet aktif. Diubah di tempat (Object.assign) saat tema berganti, lalu pohon layar dipasang ulang. */
export const C: Palette = { ...DARK };
let version = 0;
let scheme: Scheme = 'dark';
export const currentScheme = () => scheme;

export function applyTheme(next: Scheme) {
  if (next === scheme) return;
  scheme = next;
  Object.assign(C, next === 'light' ? LIGHT : DARK);
  version++;
}

/**
 * Gaya yang mengikuti tema: `const s = themed(() => StyleSheet.create({...}))`.
 * Dibuat ulang otomatis saat tema berganti (dibaca lewat Proxy, di-cache per versi tema).
 */
export function themed<T extends object>(factory: () => T): T {
  let cache: T | null = null;
  let v = -1;
  return new Proxy({} as T, {
    get(_t, key) {
      if (!cache || v !== version) { cache = factory(); v = version; }
      return (cache as any)[key];
    },
  });
}

/** Warna gradasi sederhana dari teks (untuk sampul lagu tanpa thumbnail). */
export function hueColor(seed: string): string {
  let x = 0;
  for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${x % 360}, 60%, 45%)`;
}

export function fmtDur(s?: number | null): string {
  if (s == null || !Number.isFinite(s)) return '';
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(sec).padStart(2, '0');
}

export const fmtSize = (b?: number | null) => (b == null ? '' : b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
