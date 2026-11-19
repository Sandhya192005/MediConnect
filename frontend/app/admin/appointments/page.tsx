"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, Panel, pillFor, SkeletonRows, StatusPill } from "@/components/DashboardShell";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtDateTime, isoDate, timeAgo, type Appointment } from "@/lib/types";

type Tab = "to_confirm" | "today" | "upcoming" | "past" | "cancelled";
const TABS: { key: Tab; label: string; query: string }[] = [
  { key: "to_confirm", label: "To confirm", query: "awaiting=1" },
  { key: "today", label: "Today", query: `date=${isoDate(new Date())}` },
  { key: "upcoming", label: "Upcoming", query: "when=upcoming" },
  { key: "past", label: "Past", query: "when=past" },
  { key: "cancelled", label: "Cancelled", query: "status=cancelled" },
];

/**
 * The hospital's appointments (owner request 2026-11-18). With "Confirm bookings first" on, a new booking
 * holds the slot and waits here: Confirm sends it to the doctor and tells the patient; Decline (with a
 * reason) frees the slot and tells the patient why.
 */
export default function HospitalAppointmentsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("to_confirm");
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [doctor, setDoctor] = useState("");
  const [toConfirm, setToConfirm] = useState<number | null>(null);
  const [confirmFirst, setConfirmFirst] = useState<boolean | null>(null);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const q = TABS.find((t) => t.key === tab)!.query;
    api<Appointment[]>(`/api/appointments/?${q}`)
      .then((list) => {
        // Upcoming and Today show active visits; Cancelled has its own tab.
        setItems(tab === "upcoming" || tab === "today" ? list.filter((a) => a.status !== "cancelled") : list);
      })
      .catch((e) => setError(errorMessage(e)));
    api<Appointment[]>("/api/appointments/?awaiting=1").then((l) => setToConfirm(l.length)).catch(() => {});
  }, [tab]);

  useEffect(() => {
    if (!user?.admin_hospital) return;
    setItems(null);
    load();
  }, [load, user?.admin_hospital]);

  useEffect(() => {
    if (!user?.admin_hospital) return;
    api<{ confirm_bookings: boolean }>("/api/hospital-admin/booking-settings/").then((s) => setConfirmFirst(s.confirm_bookings)).catch(() => {});
  }, [user?.admin_hospital]);

  // A new booking arrives as a live notification: refresh the list.
  useEffect(() => {
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  const doctors = useMemo(() => [...new Set((items ?? []).map((a) => a.doctor_name))].sort(), [items]);
  const shown = (items ?? []).filter((a) => !doctor || a.doctor_name === doctor);

  async function decide(a: Appointment, action: "hospital-confirm" | "hospital-decline") {
    setBusy(a.id);
    setError("");
    try {
      await api(`/api/appointments/${a.id}/${action}/`, { method: "POST", body: JSON.stringify({ reason: reasons[a.id] ?? "" }) });
      load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggle() {
    if (confirmFirst === null) return;
    try {
      const s = await api<{ confirm_bookings: boolean }>("/api/hospital-admin/booking-settings/", {
        method: "PATCH", body: JSON.stringify({ confirm_bookings: !confirmFirst }),
      });
      setConfirmFirst(s.confirm_bookings);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <RoleGuard role="admin">
      {!user?.admin_hospital ? (
        <EmptyState icon="calendar" title="Appointments are for a hospital's admins" />
      ) : (
        <>
          <div className="mb-6">
            <h1 className="page-title">Appointments</h1>
            <p className="page-subtitle text-sm">Every booking with your hospital&apos;s doctors. New bookings wait here for your Confirm.</p>
          </div>
          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

          <section aria-label="Booking settings" className="dash-card mb-6 flex flex-wrap items-center gap-4 p-5">
            <div className="min-w-0 flex-1">
              <p className="font-[650] text-[#00295c]">Confirm bookings before they reach doctors</p>
              <p className="text-sm text-slate-500">
                {confirmFirst === false
                  ? "Off: new bookings go straight to the doctor, as confirmed slots."
                  : "On: a new booking holds the slot and waits for your Confirm. The doctor sees it after you confirm."}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!confirmFirst}
              aria-label="Confirm bookings before they reach doctors"
              onClick={toggle}
              disabled={confirmFirst === null}
              className={`relative h-7 w-12 shrink-0 rounded-full transition ${confirmFirst ? "bg-teal-600" : "bg-slate-300"}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${confirmFirst ? "left-6" : "left-1"}`} />
            </button>
          </section>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Appointments" className="inline-flex flex-wrap rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              {TABS.map((t) => (
                <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${tab === t.key ? "bg-teal-600 font-[650] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  {t.label}
                  {t.key === "to_confirm" && !!toConfirm && (
                    <span className={`rounded-full px-1.5 text-xs font-[650] ${tab === t.key ? "bg-white text-teal-700" : "bg-orange-100 text-orange-800"}`}>{toConfirm}</span>
                  )}
                </button>
              ))}
            </div>
            <select className="input w-auto rounded-xl py-2" aria-label="Doctor" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
              <option value="">All doctors</option>
              {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>

          <Panel title={`${TABS.find((t) => t.key === tab)!.label}${items ? ` (${shown.length})` : ""}`}>
            {items === null ? (
              <SkeletonRows rows={4} />
            ) : shown.length === 0 ? (
              <EmptyState icon="calendar" title={tab === "to_confirm" ? "Nothing to confirm" : "No appointments here"}
                          text={tab === "to_confirm" ? "New bookings appear here as soon as patients book." : undefined} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {shown.map((a) => (
                  <li key={a.id} aria-label={`${a.patient_name} with ${a.doctor_name}`} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 text-sm font-[650] text-[#00295c]">
                          {a.patient_name}
                          {a.patient_id && <span className="font-mono text-xs font-normal text-slate-500">{a.patient_id}</span>}
                          <StatusPill status={pillFor(a)} />
                        </p>
                        <p className="text-sm text-slate-600">{a.doctor_name} · {a.specialization} · {fmtDateTime(a.start)}</p>
                        <p className="text-xs text-slate-500">
                          {a.reason ? `Reason: ${a.reason} · ` : ""}booked {timeAgo(a.created_at)}
                          {a.cancelled_by && ` · cancelled by the ${a.cancelled_by}`}
                          {a.cancel_reason && `: ${a.cancel_reason}`}
                        </p>
                      </div>
                    </div>
                    {a.awaiting_hospital && a.status === "booked" && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input className="input flex-1" maxLength={300} aria-label={`Reason if declining ${a.patient_name}`}
                               placeholder="Reason, if you decline (the patient sees it)"
                               value={reasons[a.id] ?? ""} onChange={(e) => setReasons({ ...reasons, [a.id]: e.target.value })} />
                        <button onClick={() => decide(a, "hospital-confirm")} disabled={busy === a.id} className="btn-solid px-4 py-2">Confirm</button>
                        <button onClick={() => decide(a, "hospital-decline")} disabled={busy === a.id}
                                className="btn border border-red-200 bg-white px-4 py-2 text-red-700 hover:bg-red-50">Decline</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </RoleGuard>
  );
}
