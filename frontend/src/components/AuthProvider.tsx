import React, { createContext, useContext, useState, useEffect } from 'react';
import { Spin } from 'antd';
import { api } from '../api/client';

// A session that never interrupts work: the token is long-lived on the server, and we
// re-issue it on every app load and every few hours while the tab stays open. So anyone
// who keeps using the system stays signed in indefinitely.
const REFRESH_EVERY_MS = 6 * 60 * 60 * 1000;

export type RoleName = 'system_admin' | 'branch_manager' | 'purchasing_manager' | 'sales_manager' | 'after_sales_staff' | 'sales_rep' | 'accountant' | 'viewer';

export interface User {
  username: string;
  role: RoleName;
  branch_id?: number | null;
  name: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children, apiUrl }: { children: React.ReactNode; apiUrl: string }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    // Check local storage for existing session
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

    // Global listener for 401/403 auto-logout events (from Axios interceptor)
    const handleUnauthorized = () => {
      logout();
    };

    window.addEventListener('api-unauthorized', handleUnauthorized);

    // Slide the session forward: once now (so a tab reopened after days gets a fresh token)
    // and then on a timer while the app stays open.
    const renew = async () => {
      if (!localStorage.getItem('token')) return;
      try {
        const res = await api.post('/api/v1/auth/refresh');
        if (res.data?.access_token) {
          localStorage.setItem('token', res.data.access_token);
          setToken(res.data.access_token);
        }
      } catch {
        // A failed renewal is not a logout — the current token may still be valid, and the
        // 401 interceptor already handles the case where it isn't.
      }
    };
    renew();
    const timer = window.setInterval(renew, REFRESH_EVERY_MS);

    return () => {
      window.removeEventListener('api-unauthorized', handleUnauthorized);
      window.clearInterval(timer);
    };
  }, []);

  const login = (newToken: string, newUser: User) => {
    localStorage.setItem('token', newToken);
    localStorage.setItem('user', JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
    setIsAuthenticated(true);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    // Force redirect to login page via router navigation or window hash redirect
    window.location.hash = '/login';
  };

  if (isAuthenticating) {
    return <Spin size="large" tip="التحقق من الهوية..." fullscreen />;
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isAuthenticating, user, token, login, logout }}>
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
