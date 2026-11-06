/**
 * Terjemahan sederhana: teks sumber bahasa Indonesia, kamus bahasa Inggris di bawah.
 * `T('Teks {n} lagu', { n: 3 })` → teks sesuai bahasa aktif, placeholder {nama} diganti.
 */
import { EN } from './i18n-en';

export type Lang = 'id' | 'en';
let lang: Lang = 'id';
export const currentLang = () => lang;
export function applyLang(l: Lang) { lang = l; }

export function T(text: string, vars?: Record<string, string | number>): string {
  let out = lang === 'en' ? EN[text] ?? text : text;
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}
