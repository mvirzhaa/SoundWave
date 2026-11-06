import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { get, loadSession, post, setServer, setToken, setUnauthorizedHandler, hasToken } from './api';
import type { User } from './types';

type AuthCtx = {
  ready: boolean;
  user: User | null;
  setUser: (u: User) => void;
  login: (server: string, email: string, password: string) => Promise<void>;
  register: (server: string, name: string, email: string, password: string) => Promise<void>;
  logout: (all?: boolean) => Promise<void>;
  refreshUser: (timeout?: number) => Promise<User | null>;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

type AuthResponse = { user: User; token: string; mediaToken: string };

// Data akun terakhir disimpan di HP: aplikasi tetap bisa dibuka (lagu HP/offline, jadwal sholat) tanpa internet
const KEY_USER = 'sw-user';
const saveUser = (u: User | null) => (u ? SecureStore.setItemAsync(KEY_USER, JSON.stringify(u)) : SecureStore.deleteItemAsync(KEY_USER)).catch(() => {});
async function cachedUser(): Promise<User | null> {
  try { const v = await SecureStore.getItemAsync(KEY_USER); return v ? JSON.parse(v) : null; } catch { return null; }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<User | null>(null);

  const refreshUser = useCallback(async (timeout?: number) => {
    try {
      const r = await get<{ user: User }>('/api/auth/me', { timeout });
      setUserState(r.user);
      saveUser(r.user);
      return r.user;
    } catch (e: any) {
      // Server tidak terjangkau (status 0) → pakai data akun terakhir; sesi ditolak → keluar (ditangani onUnauthorized)
      if (e?.status === 0) { const u = await cachedUser(); if (u) setUserState(u); return u; }
      return null;
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUserState(null); saveUser(null); });
    (async () => {
      try {
        await loadSession();
        // Maks. 8 detik: jaringan lambat tidak membuat aplikasi tertahan di logo
        if (hasToken()) await refreshUser(8000);
      } finally { setReady(true); }
    })();
  }, [refreshUser]);

  const finish = async (r: AuthResponse) => {
    await setToken(r.token, r.mediaToken);
    setUserState(r.user);
    saveUser(r.user);
  };

  const login = async (server: string, email: string, password: string) => {
    await setServer(server);
    await finish(await post<AuthResponse>('/api/auth/login', { email, password }));
  };
  const register = async (server: string, name: string, email: string, password: string) => {
    await setServer(server);
    await finish(await post<AuthResponse>('/api/auth/register', { name, email, password }));
  };
  const logout = async (all = false) => {
    try { if (all) await post('/api/auth/logout-all'); } catch { /* abaikan */ }
    await setToken(null);
    setUserState(null);
    saveUser(null);
  };

  return (
    <Ctx.Provider value={{ ready, user, setUser: (u: User) => { setUserState(u); saveUser(u); }, login, register, logout, refreshUser }}>
      {children}
    </Ctx.Provider>
  );
}
