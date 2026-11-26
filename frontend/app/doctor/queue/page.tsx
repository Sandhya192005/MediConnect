"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Panel, SkeletonRows } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import PatientDetailsPanel from "@/components/PatientDetailsPanel";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtTime, type Appointment, type DoctorQueue } from "@/lib/types";

const REFRESH_MS = 30_000;

export default function DoctorQueuePage() {
  const [q, setQ] = useState<DoctorQueue | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(() => {
    api<DoctorQueue>("/api/appointments/queue/")
      .then((data) => {
        setQ(data);
        setError("");
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  // Load now, when a live notification arrives (a patient checked in), and every 30 s as a fallback.
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATION_EVENT, load);
    };
  }, [load]);

  async function act(a: Appointment, action: "check-in" | "call-in" | "complete") {
    setBusy(a.id);
    setError("");
    try {
      await api(`/api/appointments/${a.id}/${action}/`, { method: "POST" });
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  const current = q?.in_consultation[0];
  const next = q?.waiting[0];
  const today = q ? new Date(`${q.date}T00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : "";

  return (
    <RoleGuard role="doctor">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Patient queue</h1>
          <p className="page-subtitle text-sm">{today ? `${today} · ` : ""}Patients get a token when they check in. Call them in by token.</p>
        </div>
        {q && (
          <div className="flex flex-wrap gap-2 text-xs" aria-label="Queue summary">
            <Count label="Waiting" n={q.waiting.length} tone="bg-amber-50 text-amber-800" />
            <Count label="Not arrived" n={q.not_arrived.length} tone="bg-slate-100 text-slate-700" />
            <Count label="Done" n={q.done.length} tone="bg-emerald-50 text-emerald-800" />
          </div>
        )}
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {q === null ? (
        <SkeletonRows rows={4} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            {/* Now consulting */}
            <section aria-label="Now consulting" className="dash-card overflow-hidden">
              {current ? (
                <div className="flex flex-col gap-4 bg-gradient-to-br from-sky-50 to-white p-5 sm:flex-row sm:items-center">
                  <TokenBadge token={current.token} large tone="bg-sky-600 text-white" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-[650] uppercase tracking-wider text-sky-700">Now consulting</p>
                    <p className="truncate text-xl font-bold text-[#00295c]">{current.patient_name}</p>
                    <p className="truncate text-sm text-slate-500">
                      Booked {fmtTime(current.start)}
                      {current.reason && ` · ${current.reason}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {current.patient_id && (
                      <Link href={`/doctor/records?id=${current.patient_id}`} className="btn-outline px-3 py-2 text-xs">
                        <Icon name="file" className="h-4 w-4" /> Open records
                      </Link>
                    )}
                    <button onClick={() => act(current, "complete")} disabled={busy === current.id} className="btn-solid px-4 py-2">
                      <Icon name="check" className="h-4 w-4" /> Done
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                    <Icon name="stethoscope" className="h-7 w-7" />
                  </span>
                  <div className="flex-1">
                    <p className="font-[650] text-[#00295c]">No one in consultation</p>
                    <p className="text-sm text-slate-500">{next ? `Token ${next.token} (${next.patient_name}) is next.` : "Nobody is waiting right now."}</p>
                  </div>
                  {next && (
                    <button onClick={() => act(next, "call-in")} disabled={busy === next.id} className="btn-solid px-5 py-2.5">
                      Call next: token {next.token}
                    </button>
                  )}
                </div>
              )}
            </section>

            <Panel title={`Waiting (${q.waiting.length})`}>
              {q.waiting.length === 0 ? (
                <EmptyState icon="users" title="No one is waiting" text="Patients appear here when they check in." />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {q.waiting.map((a, i) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-4 py-3 first:pt-0 last:pb-0">
                      <TokenBadge token={a.token} tone={i === 0 ? "bg-amber-500 text-white" : "bg-amber-50 text-amber-800"} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-[650] text-[#00295c]">{a.patient_name}</p>
                        <p className="truncate text-xs text-slate-500">
                          Checked in {a.checked_in_at ? fmtTime(a.checked_in_at) : ""} · booked {fmtTime(a.start)}
                          {a.reason && ` · ${a.reason}`}
                        </p>
                      </div>
                      <button
                        onClick={() => act(a, "call-in")}
                        disabled={!!current || busy === a.id}
                        title={current ? "Mark the current patient done first" : undefined}
                        className="btn-outline px-3 py-1.5 text-xs"
                        aria-label={`Call in ${a.patient_name}`}
                      >
                        Call in
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <div className="space-y-6 lg:col-span-2">
            {current?.patient_id && (
              <PatientDetailsPanel key={current.id} patientId={current.patient_id} recordsHref={`/doctor/records?id=${current.patient_id}`} />
            )}
            <Panel title={`Not arrived yet (${q.not_arrived.length})`}>
              {q.not_arrived.length === 0 ? (
                <EmptyState icon="calendar" title="Everyone booked today has arrived" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {q.not_arrived.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="w-16 shrink-0 text-sm tabular-nums text-slate-500">{fmtTime(a.start)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm text-[#00295c]">{a.patient_name}</span>
                      <button
                        onClick={() => act(a, "check-in")}
                        disabled={busy === a.id}
                        className="btn-ghost px-2.5 py-1 text-xs"
                        aria-label={`Check in ${a.patient_name}`}
                      >
                        Check in
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={`Done today (${q.done.length})`}>
              {q.done.length === 0 ? (
                <p className="text-sm text-slate-500">No finished visits yet.</p>
              ) : (
                <ul className="space-y-2">
                  {q.done.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 text-sm">
                      <Icon name="check" className="h-4 w-4 shrink-0 text-emerald-600" />
                      <span className="min-w-0 flex-1 truncate text-slate-600">{a.patient_name}</span>
                      {a.token && <span className="text-xs text-slate-400">token {a.token}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </RoleGuard>
  );
}

function TokenBadge({ token, tone, large = false }: { token: number | null; tone: string; large?: boolean }) {
  return (
    <span
      aria-label={`Token ${token}`}
      className={`flex shrink-0 flex-col items-center justify-center rounded-2xl font-bold tabular-nums ${tone} ${large ? "h-16 w-16 text-2xl" : "h-11 w-11 text-base"}`}
    >
      <span className={`font-medium uppercase opacity-80 ${large ? "text-[10px]" : "text-[8px]"}`}>Token</span>
      {token}
    </span>
  );
}

function Count({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <span className={`rounded-full px-3 py-1 font-[650] ${tone}`}>
      {n} {label.toLowerCase()}
    </span>
  );
}
