/** Pengaturan tampilan di HP: tema (sistem/gelap/terang) & bahasa (Indonesia/English). */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Appearance, AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { applyTheme, Scheme } from './theme';
import { applyLang, Lang } from './i18n';

export type ThemeMode = 'system' | 'dark' | 'light';
type Settings = { theme: ThemeMode; lang: Lang };
type Ctx = Settings & {
  scheme: Scheme;
  /** Berubah setiap tema/bahasa berganti → layar dipasang ulang dengan warna & teks baru. */
  renderKey: string;
  setTheme: (m: ThemeMode) => Promise<void>;
  setLang: (l: Lang) => Promise<void>;
};
const KEY = 'sw-settings';
const SettingsCtx = createContext<Ctx>(null as unknown as Ctx);
export const useSettings = () => useContext(SettingsCtx);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  // Tema sistem hanya diterapkan saat aplikasi aktif & stabil. iOS/Android bisa melaporkan perubahan tema sesaat
  // ketika aplikasi masuk latar belakang (snapshot app switcher, mode gelap otomatis malam hari); kalau diikuti,
  // semua layar dipasang ulang di latar belakang dan bisa kembali sebagai layar gelap kosong.
  const [system, setSystem] = useState(Appearance.getColorScheme());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { if (AppState.currentState === 'active') setSystem(Appearance.getColorScheme()); }, 400);
    };
    const a = Appearance.addChangeListener(apply);
    const b = AppState.addEventListener('change', (s2) => { if (s2 === 'active') apply(); });
    return () => { a.remove(); b.remove(); if (t) clearTimeout(t); };
  }, []);
  const [st, setSt] = useState<Settings | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(KEY)
      .then((v) => { const p = v ? JSON.parse(v) : {}; setSt({ theme: p.theme || 'system', lang: p.lang === 'en' ? 'en' : 'id' }); })
      .catch(() => setSt({ theme: 'system', lang: 'id' }));
  }, []);

  const save = useCallback(async (patch: Partial<Settings>) => {
    setSt((cur) => {
      const next = { ...(cur || { theme: 'system', lang: 'id' }), ...patch } as Settings;
      SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  if (!st) return null; // splash tetap tampil sampai pengaturan terbaca
  const scheme: Scheme = st.theme === 'system' ? (system === 'light' ? 'light' : 'dark') : st.theme;
  // Terapkan sebelum anak-anak dirender agar gaya & teks langsung memakai nilai baru
  applyTheme(scheme);
  applyLang(st.lang);

  return (
    <SettingsCtx.Provider value={{
      ...st, scheme, renderKey: `${scheme}-${st.lang}`,
      setTheme: (theme) => save({ theme }), setLang: (lang) => save({ lang }),
    }}>
      {children}
    </SettingsCtx.Provider>
  );
}
