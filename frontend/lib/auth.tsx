"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, tokens, type Role, type User } from "./api";

type RegisterInput = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone?: string;
  role: "patient" | "doctor";
};

/** A hospital signing up: the hospital is the account (its own email and password); a private workspace until connected. */
export type HospitalRegisterInput = {
  email: string;
  password: string;
  hospital_name: string;
  hospital_city: string;
  hospital_phone?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  /** With `tab` (the login page's tab), an account of another kind is refused and nothing is saved. */
  login: (email: string, password: string, remember?: boolean, tab?: LoginTab) => Promise<User>;
  register: (input: RegisterInput) => Promise<User>;
  registerHospital: (input: HospitalRegisterInput) => Promise<User>;
  logout: () => void;
  /** Reload the logged-in user (e.g. after editing your name on Profile & settings). */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

/** Each role's home. Hospital accounts use the /admin pages (their hospital's management). */
export const dashboardFor = (role: Role) => (role === "hospital" ? "/admin" : `/${role}`);

/**
 * The four login tabs (owner requests 2026-11-18/19): Patient, Doctor, Hospital (role "hospital": the
 * hospital's own account) and Admin (role "admin": the MediConnect platform admin).
 */
export type LoginTab = "patient" | "doctor" | "hospital" | "admin";

/** Which tab an account belongs on. */
export function tabFor(user: User): LoginTab {
  return user.role;
}

/** May this account log in on this tab? */
export function fitsTab(user: User, tab: LoginTab): boolean {
  return user.role === tab;
}

/** The login page's tab didn't match the account (e.g. a patient account on the Doctor tab). */
export class WrongRoleError extends Error {
  constructor(public actual: LoginTab) {
    super(`This is a ${actual} account.`);
  }
}

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

  const login = useCallback(async (email: string, password: string, remember = true, tab?: LoginTab) => {
    const data = await api<{ access: string; refresh: string; user: User }>("/api/auth/login/", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    // Checked before the tokens are stored, so a refused login leaves the browser logged out.
    if (tab && !fitsTab(data.user, tab)) throw new WrongRoleError(tabFor(data.user));
    tokens.set(data.access, data.refresh, remember);
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

  const registerHospital = useCallback(
    async (input: HospitalRegisterInput) => {
      await api("/api/auth/register-hospital/", { method: "POST", body: JSON.stringify(input) });
      return login(input.email, input.password);
    },
    [login],
  );

  const refresh = useCallback(async () => {
    setUser(await api<User>("/api/auth/me/"));
  }, []);

  const logout = useCallback(() => {
    tokens.clear();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, registerHospital, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
