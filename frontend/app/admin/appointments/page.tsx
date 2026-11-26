"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Panel, pillFor, SkeletonRows, StatusPill } from "@/components/DashboardShell";
import HospitalRequests from "@/components/HospitalRequests";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { DATE_PRESETS, NO_DATE_FILTER, inDateFilter, type DateFilter, type DatePreset } from "@/lib/dateFilter";
import { fmtDateTime, isoDate, timeAgo, type Appointment, type AssignableDoctor } from "@/lib/types";

type Tab = "to_confirm" | "waiting_doctor" | "today" | "upcoming" | "past" | "cancelled";
const TABS: { key: Tab; label: string; query: string }[] = [
  { key: "to_confirm", label: "To assign", query: "awaiting=1" },
  { key: "waiting_doctor", label: "Waiting for doctors", query: "awaiting=doctor" },
  { key: "today", label: "Today", query: `date=${isoDate(new Date())}` },
  { key: "upcoming", label: "Upcoming", query: "when=upcoming" },
  { key: "past", label: "Past", query: "when=past" },
  { key: "cancelled", label: "Cancelled", query: "status=cancelled" },
];

/**
 * The hospital's appointments. Booking flow (owner decisions 2026-11-21): a patient who books through the
 * hospital's page sends a hospital request. It waits here ("To assign"): Accept & assign gives it to the
 * doctor the patient chose or another free doctor, who then accepts or rejects it; a rejection comes back
 * here to reassign or decline. Personal requests (the patient found the doctor directly) go straight to the
 * doctor and are listed here for information.
 */
export default function HospitalAppointmentsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("to_confirm");
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [doctor, setDoctor] = useState("");
  const [dates, setDates] = useState<DateFilter>(NO_DATE_FILTER); // date filter (owner request 2026-11-24)
  const [counts, setCounts] = useState<{ assign: number; doctor: number }>({ assign: 0, doctor: 0 });
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  // Only the newest request may fill the list (a tab switch and live notifications can overlap).
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    const q = TABS.find((t) => t.key === tab)!.query;
    api<Appointment[]>(`/api/appointments/?${q}`)
      .then((list) => {
        if (mine !== latest.current) return;
        // Upcoming and Today show active visits; Cancelled has its own tab.
        setItems(tab === "upcoming" || tab === "today" ? list.filter((a) => a.status !== "cancelled") : list);
      })
      .catch((e) => setError(errorMessage(e)));
    Promise.all([api<Appointment[]>("/api/appointments/?awaiting=1"), api<Appointment[]>("/api/appointments/?awaiting=doctor")])
      .then(([a, d]) => setCounts({ assign: a.length, doctor: d.length }))
      .catch(() => {});
  }, [tab]);

  // Depend on the hospital's id, not the object: the user is re-fetched when notifications arrive, and a new
  // object would wipe the list (and a doctor just picked in an Assign box) for no reason.
  const hospitalId = user?.admin_hospital?.id;
  useEffect(() => {
    if (!hospitalId) return;
    setItems(null);
    load();
  }, [load, hospitalId]);

  // A new booking or a doctor's answer arrives as a live notification: refresh the list.
  useEffect(() => {
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  const doctors = useMemo(() => [...new Set((items ?? []).map((a) => a.doctor_name))].sort(), [items]);
  const shown = (items ?? []).filter((a) => (!doctor || a.doctor_name === doctor) && inDateFilter(a.start, dates));
  const filtered = !!doctor || dates.preset !== "any";

  /** No-show (2026-11-20): "Didn't come", or Undo for a wrong click. The server checks the rules. */
  async function markMissed(a: Appointment, action: "no-show" | "undo-no-show") {
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

  return (
    <RoleGuard role="hospital">
      {!user?.admin_hospital ? (
        <EmptyState icon="calendar" title="Appointments are for a hospital's admins" />
      ) : (
        <>
          <div className="mb-6">
            <h1 className="page-title">Appointments</h1>
            <p className="page-subtitle text-sm">Every booking with your hospital&apos;s doctors.</p>
          </div>
          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

          {/* Requests for doctors the hospital added itself (no online booking; 2026-11-26). Hidden until there are any. */}
          <HospitalRequests />

          <section aria-label="How bookings work" className="dash-card mb-6 p-5 text-sm text-slate-600">
            <p className="font-[650] text-[#00295c]">How bookings reach your doctors</p>
            <ul className="mt-2 space-y-1">
              <li><span className="font-[650] text-[#00295c]">Booked through your hospital&apos;s page:</span> it waits in <b>To assign</b>. Accept it and choose the doctor, then the doctor accepts or rejects it. A rejection comes back here.</li>
              <li><span className="font-[650] text-[#00295c]">Booked with a doctor directly:</span> a personal request; the doctor answers it. You see it here for information.</li>
            </ul>
          </section>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Appointments" className="inline-flex flex-wrap rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              {TABS.map((t) => {
                const n = t.key === "to_confirm" ? counts.assign : t.key === "waiting_doctor" ? counts.doctor : 0;
                return (
                  <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${tab === t.key ? "bg-teal-600 font-[650] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                    {t.label}
                    {n > 0 && (
                      <span className={`rounded-full px-1.5 text-xs font-[650] ${tab === t.key ? "bg-white text-teal-700" : "bg-orange-100 text-orange-800"}`}>{n}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto rounded-xl py-2" aria-label="Doctor" value={doctor} onChange={(e) => setDoctor(e.target.value)}>
                <option value="">All doctors</option>
                {doctors.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <select className="input w-auto rounded-xl py-2" aria-label="Date" value={dates.preset}
                      onChange={(e) => setDates({ ...dates, preset: e.target.value as DatePreset })}>
                {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              {dates.preset === "on" && (
                <input type="date" className="input w-auto rounded-xl py-2" aria-label="On date"
                       value={dates.on} onChange={(e) => setDates({ ...dates, on: e.target.value })} />
              )}
              {dates.preset === "between" && (
                <>
                  <input type="date" className="input w-auto rounded-xl py-2" aria-label="From date"
                         value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} />
                  <span className="text-sm text-slate-500">to</span>
                  <input type="date" className="input w-auto rounded-xl py-2" aria-label="To date"
                         value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} />
                </>
              )}
              {filtered && (
                <button type="button" className="btn-ghost rounded-xl px-3 py-2 text-sm"
                        onClick={() => { setDoctor(""); setDates(NO_DATE_FILTER); }}>
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <Panel title={`${TABS.find((t) => t.key === tab)!.label}${items ? ` (${shown.length})` : ""}`}>
            {items === null ? (
              <SkeletonRows rows={4} />
            ) : shown.length === 0 ? (
              filtered && (items?.length ?? 0) > 0 ? (
                <EmptyState icon="calendar" title="No appointments match these filters" text="Change the doctor or date, or clear the filters." />
              ) : (
                <EmptyState icon="calendar" title={tab === "to_confirm" ? "Nothing to assign" : "No appointments here"}
                            text={tab === "to_confirm" ? "Bookings made through your hospital's page appear here." : undefined} />
              )
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
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-600">
                            {a.source === "hospital" ? "Through your hospital" : "Personal request"}
                          </span>
                        </p>
                        <p className="text-sm text-slate-600">
                          <Link href={`/admin/doctors/${a.doctor}`} className="hover:underline">{a.doctor_name}</Link>
                          {" · "}{a.specialization} · {fmtDateTime(a.start)}
                        </p>
                        <p className="text-xs text-slate-500">
                          {a.reason ? `Reason: ${a.reason} · ` : ""}booked {timeAgo(a.created_at)}
                          {a.cancelled_by && ` · ${a.cancelled_by === "system" ? "not confirmed in time" : `cancelled by the ${a.cancelled_by}`}`}
                          {a.cancel_reason && a.cancelled_by !== "system" && `: ${a.cancel_reason}`}
                          {a.status === "no_show" && ` · didn't come${a.no_show_by ? ` (marked by the ${a.no_show_by})` : ""}`}
                        </p>
                      </div>
                      {a.can_mark_no_show && (
                        <button onClick={() => markMissed(a, "no-show")} disabled={busy === a.id}
                                className="btn border border-rose-200 bg-white px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">
                          Didn&apos;t come<span className="sr-only"> for {a.patient_name}</span>
                        </button>
                      )}
                      {a.can_undo_no_show && (
                        <button onClick={() => markMissed(a, "undo-no-show")} disabled={busy === a.id} className="btn-ghost px-3 py-1.5 text-sm">
                          Undo missed<span className="sr-only"> for {a.patient_name}</span>
                        </button>
                      )}
                    </div>
                    {a.awaiting_hospital && a.status === "booked" && <AssignBox a={a} onDone={load} onError={setError} />}
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

/** Accept & assign (choose the doctor) or Decline with a reason, for one request waiting for the hospital. */
function AssignBox({ a, onDone, onError }: { a: Appointment; onDone: () => void; onError: (e: string) => void }) {
  const [options, setOptions] = useState<AssignableDoctor[] | null>(null);
  const [pick, setPick] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true; // a late answer from an older load must not touch the box (React runs this twice in dev)
    api<AssignableDoctor[]>(`/api/appointments/${a.id}/assignable-doctors/`)
      .then((list) => {
        if (!current) return;
        setOptions(list);
        // Default: the doctor the patient chose, unless they rejected it; otherwise the first free doctor.
        // Never replace a doctor the hospital has already picked.
        const first = list.find((d) => d.chosen_by_patient && d.free) ?? list.find((d) => d.free && !d.rejected);
        setPick((p) => p || (first ? String(first.id) : ""));
      })
      .catch((e) => { if (current) onError(errorMessage(e)); });
    return () => { current = false; };
  }, [a.id, onError]);

  async function send(action: "hospital-confirm" | "hospital-decline") {
    setBusy(true);
    onError("");
    try {
      const body = action === "hospital-confirm" ? { doctor: Number(pick) } : { reason };
      await api(`/api/appointments/${a.id}/${action}/`, { method: "POST", body: JSON.stringify(body) });
      onDone();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const label = (d: AssignableDoctor) =>
    `${d.name}${d.specialization ? ` · ${d.specialization}` : ""}${d.chosen_by_patient ? " (patient's choice)" : ""}`
    + (d.rejected ? " — rejected it" : !d.free ? " — not free then" : "");

  return (
    <div className="mt-3 space-y-2 rounded-xl bg-slate-50 p-3">
      {a.last_rejection && (
        <p className="text-sm text-rose-700">
          {a.last_rejection.doctor_name} rejected it: {a.last_rejection.reason}. Assign another doctor or decline.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select className="input flex-1 py-2" aria-label={`Doctor for ${a.patient_name}`} value={pick} onChange={(e) => setPick(e.target.value)}
                disabled={options === null}>
          {options === null && <option value="">Loading doctors…</option>}
          {options?.length === 0 && <option value="">No doctors yet</option>}
          {/* Nothing picked yet (e.g. after a rejection): say so, instead of showing a doctor who isn't selected. */}
          {!!options?.length && <option value="" disabled>Choose a doctor…</option>}
          {options?.map((d) => (
            <option key={d.id} value={d.id} disabled={!d.free}>{label(d)}</option>
          ))}
        </select>
        <button onClick={() => send("hospital-confirm")} disabled={busy || !pick} className="btn-solid px-4 py-2">
          {a.last_rejection ? "Reassign" : "Accept & assign"}
        </button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input className="input flex-1 py-2" maxLength={300} aria-label={`Reason if declining ${a.patient_name}`}
               placeholder="Reason, if you decline (the patient sees it)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button onClick={() => send("hospital-decline")} disabled={busy}
                className="btn border border-red-200 bg-white px-4 py-2 text-red-700 hover:bg-red-50">Decline</button>
      </div>
    </div>
  );
}
