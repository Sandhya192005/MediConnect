"use client";

import { useNotifications } from "@/lib/notifications";

/** Small pop-up in the corner when a new notification arrives live. */
export default function NotificationToast() {
  const { toast, dismissToast } = useNotifications();
  if (!toast) return null;
  return (
    <div role="status" className="fixed right-4 top-20 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-teal-200 bg-white p-4 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-800">{toast.title}</p>
          <p className="text-sm text-slate-600">{toast.message}</p>
        </div>
        <button onClick={dismissToast} aria-label="Dismiss" className="text-slate-400 hover:text-slate-600">
          ✕
        </button>
      </div>
    </div>
  );
}
