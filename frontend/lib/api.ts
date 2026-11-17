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
  /** Patients only: the ID they share with a doctor to open their records (null for doctors/admins). */
  patient_id: string | null;
};

const ACCESS = "mc_access";
const REFRESH = "mc_refresh";

/**
 * Login tokens. "Remember me" keeps them in localStorage (survives closing the browser);
 * without it they live in sessionStorage and are gone when the browser closes.
 */
const read = (key: string) =>
  typeof window === "undefined" ? null : sessionStorage.getItem(key) ?? localStorage.getItem(key);

export const tokens = {
  get access() {
    return read(ACCESS);
  },
  get refresh() {
    return read(REFRESH);
  },
  /** `remember` is given at login; a refresh keeps the tokens wherever they already are. */
  set(access: string, refresh?: string, remember?: boolean) {
    const keep = remember ?? sessionStorage.getItem(REFRESH) === null;
    if (remember !== undefined) tokens.clear();
    const store = keep ? localStorage : sessionStorage;
    store.setItem(ACCESS, access);
    if (refresh) store.setItem(REFRESH, refresh);
  },
  clear() {
    for (const store of [localStorage, sessionStorage]) {
      store.removeItem(ACCESS);
      store.removeItem(REFRESH);
    }
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
  // File uploads (FormData): the browser sets the multipart Content-Type itself.
  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
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

/**
 * Downloads a protected file (e.g. a medical record) with the login token and saves it.
 * A plain <a href> can't send the token, so the file is fetched and handed to the browser as a blob.
 */
export async function downloadFile(path: string, filename: string, retry = true): Promise<void> {
  const headers = new Headers();
  if (tokens.access) headers.set("Authorization", `Bearer ${tokens.access}`);
  const res = await fetch(`${API_URL}${path}`, { headers });
  if (res.status === 401 && retry && (await refreshAccess())) return downloadFile(path, filename, false);
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text ? JSON.parse(text) : null);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
