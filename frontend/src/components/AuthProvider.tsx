import React, { createContext, useContext, useState, useEffect } from 'react';
import { Spin } from 'antd';
import { api, clearApiCache, getApiBaseURL } from '../api/client';
import { startLive, stopLive } from '../utils/live';

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
}

interface AuthContextType {
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
  can: (capability: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children, apiUrl }: { children: React.ReactNode; apiUrl: string }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
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
        if (me.data?.capabilities) {
          setUser((prev) => {
            if (!prev) return prev;
            const next = {
              ...prev, capabilities: me.data.capabilities,
              pages_shown: me.data.pages_shown ?? [], pages_hidden: me.data.pages_hidden ?? [],
            };
            localStorage.setItem('user', JSON.stringify(next));
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
  useEffect(() => () => stopLive(), []);

  const login = (newToken: string, newUser: User) => {
    clearApiCache();
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    setIsAuthenticated(true);
  };

  const logout = (releaseDevice = true) => {
    const t = localStorage.getItem('token');
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
