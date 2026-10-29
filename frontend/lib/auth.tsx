"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, tokens, type Role, type User } from "./api";

type RegisterInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role: Exclude<Role, "admin">;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  logout: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export const dashboardFor = (role: Role) => `/${role}`;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On page load, restore the session from the stored token.
  useEffect(() => {
    if (!tokens.access) {
      setLoading(false);
      return;
    }
    api<User>("/api/auth/me/")
      .then(setUser)
      .catch(() => tokens.clear())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<{ access: string; refresh: string; user: User }>("/api/auth/login/", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    tokens.set(data.access, data.refresh);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(
    async (input: RegisterInput) => {
      await api("/api/auth/register/", { method: "POST", body: JSON.stringify(input) });
      return login(input.email, input.password);
    },
    [login],
  );

  const logout = useCallback(() => {
    tokens.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
