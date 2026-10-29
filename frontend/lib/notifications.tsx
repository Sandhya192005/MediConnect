"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, API_URL, tokens } from "./api";
import { useAuth } from "./auth";

export type Notification = {
  id: number;
  kind: string;
  title: string;
  message: string;
  link: string;
  appointment: number | null;
  is_read: boolean;
  created_at: string;
};

type State = {
  items: Notification[];
  unread: number;
  connected: boolean;
  toast: Notification | null;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismissToast: () => void;
};

const Ctx = createContext<State | null>(null);
const WS_URL = API_URL.replace(/^http/, "ws");

/** Other components (e.g. appointment lists) can listen for this to refresh themselves. */
export const NOTIFICATION_EVENT = "mc:notification";

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<Notification | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setUnread(0);
      return;
    }

    let stopped = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout>;
    let pingTimer: ReturnType<typeof setInterval>;

    api<{ unread: number; results: Notification[] }>("/api/notifications/").then((r) => {
      setItems(r.results);
      setUnread(r.unread);
    });

    const connect = () => {
      if (stopped || !tokens.access) return;
      const ws = new WebSocket(`${WS_URL}/ws/notifications/?token=${tokens.access}`);
      wsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        setConnected(true);
        pingTimer = setInterval(() => ws.send(JSON.stringify({ type: "ping" })), 25_000);
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "hello") setUnread(msg.unread);
        if (msg.type === "notification") {
          setItems((prev) => [msg.notification, ...prev].slice(0, 30));
          setUnread(msg.unread);
          setToast(msg.notification);
          window.dispatchEvent(new CustomEvent(NOTIFICATION_EVENT, { detail: msg.notification }));
        }
      };

      ws.onclose = async (e) => {
        setConnected(false);
        clearInterval(pingTimer);
        if (stopped) return;
        // 4401 = token expired/invalid: any API call refreshes it, then reconnect.
        if (e.code === 4401) await api("/api/auth/me/").catch(() => null);
        retry += 1;
        retryTimer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry)); // 2s, 4s, 8s … max 30s
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, [user]);

  // Hide the toast after a few seconds.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const markRead = useCallback(async (id: number) => {
    const r = await api<{ unread: number }>(`/api/notifications/${id}/read/`, { method: "POST" });
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnread(r.unread);
  }, []);

  const markAllRead = useCallback(async () => {
    await api("/api/notifications/read-all/", { method: "POST" });
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnread(0);
  }, []);

  return (
    <Ctx.Provider value={{ items, unread, connected, toast, markRead, markAllRead, dismissToast: () => setToast(null) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNotifications must be used inside <NotificationProvider>");
  return ctx;
}
