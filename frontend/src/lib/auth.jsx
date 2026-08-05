import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { apiFetch, clearSession, getToken, isAdminSession, setSession } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(getToken());
  const [isAdmin, setIsAdmin] = useState(isAdminSession());

  const login = useCallback(async (email, password) => {
    const data = await apiFetch('/api/login', { method: 'POST', body: { email, password }, auth: false });
    setSession({ token: data.token, isAdmin: data.isAdmin });
    setToken(data.token);
    setIsAdmin(!!data.isAdmin);
    return data;
  }, []);

  const signup = useCallback((payload) =>
    apiFetch('/api/signup', { method: 'POST', body: payload, auth: false }), []);

  const forgotPassword = useCallback((email) =>
    apiFetch('/api/forgot-password', { method: 'POST', body: { email }, auth: false }), []);

  const logout = useCallback(() => {
    clearSession();
    setToken(null);
    setIsAdmin(false);
  }, []);

  const value = useMemo(() => ({
    token, isAdmin, isAuthenticated: !!token, login, signup, forgotPassword, logout
  }), [token, isAdmin, login, signup, forgotPassword, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
