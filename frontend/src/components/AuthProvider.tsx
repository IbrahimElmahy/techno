import React, { createContext, useContext, useState, useEffect } from 'react';
import { Spin } from 'antd';
import { api, clearApiCache, getApiBaseURL, getViewAs, setViewAs } from '../api/client';
import { startLive, stopLive } from '../utils/live';
import { syncPrefs } from '../utils/userPrefs';

const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;

export type RoleName = 'owner' | 'system_admin' | 'branch_manager' | 'purchasing_manager' | 'sales_manager' | 'after_sales_staff' | 'sales_rep' | 'accountant' | 'viewer' | 'rep_supervisor';

export function roleForAccess(role: RoleName | string | undefined | null): string {
  return role === 'owner' ? 'system_admin' : (role || '');
}

export interface User {
  username: string;
  role: RoleName;
  branch_id?: number | null;
  name: string;
  capabilities?: string[];
  pages_shown?: string[];
  pages_hidden?: string[];
  branch_ids?: number[];
}

interface AuthContextType {
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  can: (capability: string) => boolean;
  realUser: User | null;
  viewingAs: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children, apiUrl }: { children: React.ReactNode; apiUrl: string }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [realUser, setRealUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const viewingAs = !!getViewAs() && !!realUser && user !== realUser;

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        const stored = JSON.parse(storedUser);
        setRealUser(stored);
        setUser(stored);
        setIsAuthenticated(true);
      } catch (err) {
        console.error('Failed to parse stored user session:', err);
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setIsAuthenticating(false);

    const handleUnauthorized = () => {
      logout(false);
    };

    window.addEventListener('api-unauthorized', handleUnauthorized);

    const renew = async () => {
      if (!localStorage.getItem('token')) return;
      try {
        const res = await api.post('/api/v1/auth/refresh');
        if (res.data?.access_token) {
          localStorage.setItem('token', res.data.access_token);
          setToken(res.data.access_token);
        }
        const me = await api.get('/api/v1/auth/me');
        const stored = JSON.parse(localStorage.getItem('user') || 'null');
        if (getViewAs() && me.data && stored && me.data.username !== stored.username) {
          setUser({
            ...stored, username: me.data.username, role: me.data.role,
            name: me.data.full_name || me.data.username, branch_id: me.data.branch_id,
            capabilities: me.data.capabilities ?? [], pages_shown: me.data.pages_shown ?? [],
            pages_hidden: me.data.pages_hidden ?? [], branch_ids: me.data.branch_ids ?? [],
            id: me.data.id,
          } as any);
          return;
        }
        if (getViewAs()) setViewAs(null);
        if (me.data?.capabilities) {
          setUser((prev) => {
            if (!prev) return prev;
            const next = {
              ...prev, capabilities: me.data.capabilities,
              pages_shown: me.data.pages_shown ?? [], pages_hidden: me.data.pages_hidden ?? [],
              branch_ids: me.data.branch_ids ?? [],
            };
            localStorage.setItem('user', JSON.stringify(next));
            setRealUser(next);
            return next;
          });
        }
      } catch {
      }
    };
    renew();
    const timer = window.setInterval(renew, REFRESH_EVERY_MS);

    return () => {
      window.removeEventListener('api-unauthorized', handleUnauthorized);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (token) startLive();
    else stopLive();
  }, [token]);
  const prefsFor = React.useRef<string | null>(null);
  useEffect(() => {
    const who = token ? (user as any)?.username ?? 'me' : null;
    if (!who || prefsFor.current === who || getViewAs()) return;
    prefsFor.current = who;
    syncPrefs();
  }, [token, (user as any)?.username]);
  useEffect(() => () => stopLive(), []);

  const login = (newToken: string, newUser: User) => {
    clearApiCache();
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setViewAs(null);
    setToken(newToken);
    setRealUser(newUser);
    setUser(newUser);
    setIsAuthenticated(true);
  };

  const logout = (releaseDevice = true) => {
    const t = localStorage.getItem('token');
    setViewAs(null);
    if (releaseDevice) {
      try { sessionStorage.removeItem('techno.tabs'); } catch {}
    }
    if (releaseDevice && t) {
      fetch(`${getApiBaseURL()}/api/v1/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}` },
        keepalive: true,
      }).catch(() => {});
    }
    clearApiCache();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    window.location.hash = '/login';
  };

  if (isAuthenticating) {
    return <Spin size="large" tip="التحقق من الهوية..." fullscreen />;
  }

  return (
    <AuthContext.Provider value={{
      isAuthenticated, isAuthenticating, user, token, login, logout,
      can: (capability: string) => !!user?.capabilities?.includes(capability),
      realUser, viewingAs,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
