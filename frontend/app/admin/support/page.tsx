"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, IconTile, SkeletonRows } from "@/components/DashboardShell";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { timeAgo, type SupportInboxItem } from "@/lib/types";

type Show = "open" | "answered" | "closed" | "";
const TABS: [Show, string][] = [["open", "Open"], ["answered", "Answered"], ["closed", "Closed"], ["", "All"]];
const ROLE: Record<string, string> = { patient: "Patient", doctor: "Doctor", hospital: "Hospital", admin: "Admin" };
const STATUS_STYLE: Record<SupportInboxItem["status"], string> = {
  open: "bg-amber-50 text-amber-700",
  answered: "bg-teal-50 text-teal-700",
  closed: "bg-slate-100 text-slate-500",
};

/**
 * Support inbox (owner request 2026-11-20): the platform admin reads the "Need help?" messages from patients,
 * doctors and hospitals and replies here (was Django admin). The sender gets a notification and sees the
 * reply on their Need help? page.
 */
export default function SupportInboxPage() {
  return (
    <RoleGuard role="admin">
      <SupportInbox />
    </RoleGuard>
  );
}

function SupportInbox() {
  const [show, setShow] = useState<Show>("open");
  const [items, setItems] = useState<SupportInboxItem[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<SupportInboxItem[]>(`/api/support/inbox/${show ? `?status=${show}` : ""}`)
      .then(setItems)
      .catch((e) => setError(errorMessage(e)));
  }, [show]);

  useEffect(() => {
    setItems(null);
    load();
    window.addEventListener(NOTIFICATION_EVENT, load); // a new message arrives as a notification
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Support inbox</h1>
          <p className="page-subtitle text-sm">Messages from patients, doctors and hospitals sent with &ldquo;Need help?&rdquo;. They get a notification when you reply.</p>
        </div>
        <div role="group" aria-label="Show" className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {TABS.map(([v, label]) => (
            <button key={label} onClick={() => setShow(v)} aria-pressed={show === v}
                    className={`rounded-lg px-3 py-1.5 text-sm ${show === v ? "bg-teal-600 font-[650] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {items === null ? (
        !error && <SkeletonRows rows={4} />
      ) : items.length === 0 ? (
        <EmptyState icon="check" title={show === "open" ? "No open messages" : "Nothing here"}
                    text={show === "open" ? "You've answered everyone." : undefined} />
      ) : (
        <ul className="space-y-3">
          {items.map((m) => <Message key={m.id} m={m} onChange={load} />)}
        </ul>
      )}
    </>
  );
}

function Message({ m, onChange }: { m: SupportInboxItem; onChange: () => void }) {
  const [reply, setReply] = useState(m.reply);
  const [open, setOpen] = useState(m.status === "open");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function post(path: string, body: object) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/support/inbox/${m.id}/${path}/`, { method: "POST", body: JSON.stringify(body) });
      if (path === "reply") setOpen(false);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li aria-label={m.subject} className="dash-card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <IconTile icon="chat" tone={m.status === "open" ? "orange" : "indigo"} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-[650] text-[#00295c]">{m.subject}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-[650] ${STATUS_STYLE[m.status]}`}>{m.status_label}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {ROLE[m.sender_role] ?? m.sender_role} · {m.sender_name}{m.sender_name !== m.sender_email && ` <${m.sender_email}>`}
            {" · "}{m.topic_label} · {timeAgo(m.created_at)}
          </p>
          <p className="mt-3 whitespace-pre-line text-sm text-slate-700">{m.message}</p>
          {m.reply && !open && (
            <p className="mt-3 rounded-xl bg-teal-50 px-3 py-2 text-sm text-slate-700">
              <span className="font-[650] text-[#00295c]">Your reply: </span><span className="whitespace-pre-line">{m.reply}</span>
            </p>
          )}
        </div>
        {!open && (
          <div className="flex gap-2">
            <button onClick={() => setOpen(true)} className="btn-outline px-3 py-1.5 text-sm">{m.reply ? "Edit reply" : "Reply"}</button>
            {m.status === "closed"
              ? <button onClick={() => post("status", { status: "open" })} disabled={busy} className="btn-ghost px-3 py-1.5 text-sm">Reopen</button>
              : <button onClick={() => post("status", { status: "closed" })} disabled={busy} className="btn-ghost px-3 py-1.5 text-sm">Close</button>}
          </div>
        )}
      </div>

      {open && (
        <form onSubmit={(e) => { e.preventDefault(); post("reply", { reply }); }} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <label className="block text-sm font-medium text-slate-700">Reply to {m.sender_name}
            <textarea className="input mt-1 min-h-24" required maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-solid rounded-xl px-4 py-2 text-sm" disabled={busy}>{busy ? "Sending…" : "Send reply"}</button>
            <button type="button" onClick={() => post("reply", { reply, close: true })} disabled={busy || !reply.trim()}
                    className="btn-outline px-4 py-2 text-sm">Send and close</button>
            {/* Some messages need no answer (spam, "thanks", already solved): close them straight away (2026-11-21). */}
            {m.status === "open" && (
              <button type="button" onClick={() => post("status", { status: "closed" })} disabled={busy}
                      className="btn-ghost px-4 py-2 text-sm text-slate-600">Close without reply</button>
            )}
            {m.status !== "open" && (
              <button type="button" onClick={() => { setOpen(false); setReply(m.reply); setError(""); }} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
            )}
          </div>
        </form>
      )}
      {error && !open && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </li>
  );
}
