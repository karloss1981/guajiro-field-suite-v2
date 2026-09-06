import React, { createContext, useContext, useState } from 'react';
import type { AuthState } from '../types/auth';
import { AUTH_STORAGE_KEY } from '../config/constants';

interface AuthContextValue {
  auth: AuthState | null;
  login: (state: AuthState) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadPersistedAuth(): AuthState | null {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(loadPersistedAuth);

  const login = (state: AuthState) => {
    setAuth(state);
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(state));
  };

  const logout = () => {
    setAuth(null);
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  };

  return React.createElement(AuthContext.Provider, { value: { auth, login, logout } }, children);
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
