/** Palet warna — sama dengan tema gelap versi web. */
export const C = {
  bg: '#070b1d',
  surface: '#10162f',
  surface2: '#182042',
  border: '#263058',
  text: '#e8ebff',
  muted: '#9aa3c7',
  accent: '#8b6dff',
  accent2: '#22d3ee',
  danger: '#ff6b7d',
  ok: '#34d399',
  warn: '#fbbf24',
};

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
