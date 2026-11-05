import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { get, loadSession, post, setServer, setToken, setUnauthorizedHandler, hasToken } from './api';
import type { User } from './types';

type AuthCtx = {
  ready: boolean;
  user: User | null;
  setUser: (u: User) => void;
  login: (server: string, email: string, password: string) => Promise<void>;
  register: (server: string, name: string, email: string, password: string) => Promise<void>;
  logout: (all?: boolean) => Promise<void>;
  refreshUser: () => Promise<User | null>;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);
export const useAuth = () => useContext(Ctx);

type AuthResponse = { user: User; token: string; mediaToken: string };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<User | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const r = await get<{ user: User }>('/api/auth/me');
      setUserState(r.user);
      return r.user;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUserState(null); });
    (async () => {
      await loadSession();
      if (hasToken()) await refreshUser();
      setReady(true);
    })();
  }, [refreshUser]);

  const finish = async (r: AuthResponse) => {
    await setToken(r.token, r.mediaToken);
    setUserState(r.user);
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
  };

  return (
    <Ctx.Provider value={{ ready, user, setUser: setUserState, login, register, logout, refreshUser }}>
      {children}
    </Ctx.Provider>
  );
}
