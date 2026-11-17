"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Panel, SkeletonRows } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { timeAgo } from "@/lib/types";

type SupportRequest = {
  id: number;
  topic: string;
  topic_label: string;
  subject: string;
  message: string;
  status: "open" | "answered" | "closed";
  status_label: string;
  reply: string;
  created_at: string;
};

const TOPICS = [
  ["account", "My account / login"],
  ["appointment", "Appointments"],
  ["records", "Medical records"],
  ["hospital", "Hospital information"],
  ["other", "Something else"],
] as const;

const STATUS_STYLE: Record<SupportRequest["status"], string> = {
  open: "bg-amber-50 text-amber-700",
  answered: "bg-teal-50 text-teal-700",
  closed: "bg-slate-100 text-slate-500",
};

/** "Need help? Contact support": send a message and see the answers (for every role). */
export default function SupportPage() {
  const [items, setItems] = useState<SupportRequest[] | null>(null);
  const [f, setF] = useState({ topic: "appointment", subject: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<SupportRequest[]>("/api/support/").then(setItems).catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(NOTIFICATION_EVENT, load); // a reply arrives as a notification
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOk("");
    setError("");
    try {
      await api("/api/support/", { method: "POST", body: JSON.stringify(f) });
      setF({ ...f, subject: "", message: "" });
      setOk("Sent. We'll reply here and send you a notification.");
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RoleGuard>
      <div className="mb-6">
        <h1 className="page-title">Need help?</h1>
        <p className="page-subtitle text-sm">Send a message to MediConnect support. We answer here, and you get a notification.</p>
      </div>
      <p className="mb-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <Icon name="siren" className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          In a medical emergency, call <a href="tel:112" className="font-[650] underline">112</a> or an ambulance on{" "}
          <a href="tel:108" className="font-[650] underline">108</a>. Support can&apos;t help with emergencies.
        </span>
      </p>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Contact support" className="lg:col-span-2">
          <form onSubmit={submit} className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Topic
              <select className="input mt-1" value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })}>
                {TOPICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Subject
              <input className="input mt-1" required maxLength={150} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Message
              <textarea className="input mt-1" rows={5} required minLength={10} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
            </label>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            {ok && <p role="status" className="text-sm text-teal-700">{ok}</p>}
            <button className="btn-primary rounded-xl" disabled={busy}>{busy ? "Sending…" : "Send message"}</button>
          </form>
        </Panel>

        <Panel title="Your messages" className="lg:col-span-3">
          {items === null ? (
            <SkeletonRows rows={3} />
          ) : items.length === 0 ? (
            <EmptyState icon="chat" title="No messages yet" text="Your questions and our answers will appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {items.map((r) => (
                <li key={r.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-[650] text-[#0f2f3a]">{r.subject}</p>
                      <p className="text-xs text-slate-500">{r.topic_label} · {timeAgo(r.created_at)}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-[650] ${STATUS_STYLE[r.status]}`}>{r.status_label}</span>
                  </div>
                  <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{r.message}</p>
                  {r.reply && (
                    <div className="mt-2 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900">
                      <span className="block text-xs font-[650] text-teal-700">Support replied</span>
                      <span className="whitespace-pre-line">{r.reply}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </RoleGuard>
  );
}
