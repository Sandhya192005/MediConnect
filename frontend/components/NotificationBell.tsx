"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useNotifications, type Notification } from "@/lib/notifications";
import Icon from "./Icons";

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationBell() {
  const { items, unread, connected, markRead, markAllRead, remove, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close the dropdown when clicking outside it.
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function openItem(n: Notification) {
    if (!n.is_read) await markRead(n.id);
    setOpen(false);
    if (n.link) router.push(n.link);
  }

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
    } catch {
      setError("Couldn't update notifications. Please try again.");
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100"
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span data-testid="unread-count" className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        <span
          title={connected ? "Live" : "Reconnecting…"}
          className={`absolute bottom-1 right-1 h-2 w-2 rounded-full ring-2 ring-white ${connected ? "bg-green-500" : "bg-slate-300"}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-96 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-navy-900/10">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <span className="font-semibold text-navy-800">Notifications</span>
            <div className="flex items-center gap-3 text-xs font-semibold">
              {unread > 0 && (
                <button onClick={() => run(markAllRead)} className="text-teal-700 hover:underline">
                  Mark all read
                </button>
              )}
              {items.length > 0 && (
                <button
                  onClick={() => window.confirm("Delete all your notifications?") && run(clearAll)}
                  className="text-red-600 hover:underline"
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
          {error && <p role="alert" className="bg-red-50 px-4 py-2 text-xs text-red-700">{error}</p>}
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <li className="flex flex-col items-center px-4 py-8 text-center text-sm text-slate-500">
                <Icon name="bell" className="h-8 w-8 text-slate-300" />
                <span className="mt-2">No notifications yet.</span>
              </li>
            )}
            {items.map((n) => (
              <li key={n.id} className={`group flex items-start border-b border-slate-50 last:border-0 ${n.is_read ? "" : "bg-teal-50/60"}`}>
                <button onClick={() => openItem(n)} className="flex min-w-0 flex-1 gap-3 px-4 py-3 text-left hover:bg-slate-50">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.is_read ? "bg-transparent" : "bg-teal-600"}`} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-navy-800">{n.title}</span>
                    <span className="block text-sm text-slate-600">{n.message}</span>
                    <span className="block text-xs text-slate-400">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
                <button
                  onClick={() => run(() => remove(n.id))}
                  aria-label={`Delete notification: ${n.title}`}
                  title="Delete"
                  className="m-2 shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
