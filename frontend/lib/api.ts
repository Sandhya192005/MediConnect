// Small fetch wrapper that attaches the JWT and refreshes it when it expires.

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Role = "patient" | "doctor" | "admin";

export type User = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  role: Role;
};

const ACCESS = "mc_access";
const REFRESH = "mc_refresh";

export const tokens = {
  get access() {
    return typeof window === "undefined" ? null : localStorage.getItem(ACCESS);
  },
  get refresh() {
    return typeof window === "undefined" ? null : localStorage.getItem(REFRESH);
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS, access);
    if (refresh) localStorage.setItem(REFRESH, refresh);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};

export class ApiError extends Error {
  constructor(public status: number, public data: unknown) {
    super(typeof data === "object" ? JSON.stringify(data) : String(data));
  }
}

async function refreshAccess(): Promise<boolean> {
  const refresh = tokens.refresh;
  if (!refresh) return false;
  const res = await fetch(`${API_URL}/api/auth/refresh/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) {
    tokens.clear();
    return false;
  }
  const data = await res.json();
  tokens.set(data.access);
  return true;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (tokens.access) headers.set("Authorization", `Bearer ${tokens.access}`);

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (res.status === 401 && retry && (await refreshAccess())) {
    return api<T>(path, options, false);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Turns a DRF error body into one readable line. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.data && typeof err.data === "object") {
    return Object.entries(err.data as Record<string, unknown>)
      .map(([k, v]) => `${k === "detail" ? "" : k + ": "}${Array.isArray(v) ? v.join(" ") : v}`)
      .join(" · ");
  }
  return "Something went wrong. Please try again.";
}
