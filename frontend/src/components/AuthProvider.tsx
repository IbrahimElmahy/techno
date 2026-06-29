import React, { createContext, useContext, useState, useEffect } from 'react';
import { Spin } from 'antd';

export type RoleName = 'system_admin' | 'branch_manager' | 'purchasing_manager' | 'sales_manager' | 'after_sales_staff' | 'sales_rep' | 'accountant';

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
    return () => {
      window.removeEventListener('api-unauthorized', handleUnauthorized);
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
