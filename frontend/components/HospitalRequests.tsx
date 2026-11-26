"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import type { AppointmentRequest, StaffMember } from "@/lib/types";

const fmtDay = (iso: string) => new Date(iso + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const fmtTime = (hms: string) => new Date(`2000-01-01T${hms}`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const MIN_REASON = 5;

/**
 * Requests for the doctors the hospital added itself (no online booking; owner request 2026-11-26).
 * Confirm with the doctor asked for or another one (same department first), with a date and time,
 * or decline with a reason the patient reads.
 */
export default function HospitalRequests() {
  const [items, setItems] = useState<AppointmentRequest[] | null>(null);
  const [doctors, setDoctors] = useState<StaffMember[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<AppointmentRequest[]>("/api/appointment-requests/").then(setItems).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    load();
    api<StaffMember[]>("/api/hospital-admin/staff/?kind=doctor").then((l) => setDoctors(l.filter((d) => d.is_active))).catch(() => {});
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  if (!items || items.length === 0) return null; // nothing asked yet: keep the page as it was
  const pending = items.filter((r) => r.status === "pending");
  const answered = items.filter((r) => r.status !== "pending").slice(0, 10);

  return (
    <section id="requests" aria-label="Appointment requests" className="dash-card mb-6 scroll-mt-24 p-5">
      <h2 className="text-lg font-[650] text-[#00295c]">
        Appointment requests {pending.length > 0 && <span className="ml-1 rounded-full bg-orange-100 px-2 text-sm text-orange-800">{pending.length} waiting</span>}
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        For doctors you added in Doctor management (they have no free slots online). Confirm a time with the doctor asked for,
        give the visit to another doctor (same department first), or decline with a reason.
      </p>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {pending.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">No requests waiting.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {pending.map((r) => <RequestCard key={r.id} r={r} doctors={doctors} onDone={load} onError={setError} />)}
        </ul>
      )}

      {answered.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-teal-700">Answered recently ({answered.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {answered.map((r) => (
              <li key={r.id} className="py-2">
                <span className="font-medium text-[#00295c]">{r.patient_name}</span> · {r.doctor_name} · {r.status_label}
                {r.status === "confirmed" && r.confirmed_date && r.confirmed_time &&
                  ` · ${r.assigned_doctor_name}, ${fmtDay(r.confirmed_date)} ${fmtTime(r.confirmed_time)}`}
                {r.status === "declined" && r.admin_note && ` · Reason: ${r.admin_note}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function RequestCard({ r, doctors, onDone, onError }: {
  r: AppointmentRequest; doctors: StaffMember[]; onDone: () => void; onError: (e: string) => void;
}) {
  const [doctor, setDoctor] = useState(r.staff_doctor ? String(r.staff_doctor) : "");
  const [day, setDay] = useState(r.preferred_date);
  const [time, setTime] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const dept = r.doctor_department ?? "";
  const deptOf = (d: StaffMember) => d.department_name || d.specialization || "General";
  const same = doctors.filter((d) => deptOf(d) === dept);
  const others = doctors.filter((d) => deptOf(d) !== dept);
  const label = (d: StaffMember) => `Dr. ${d.full_name.replace(/^dr\.?\s+/i, "")}${d.id === r.staff_doctor ? " (asked for)" : ""}`;

  async function send(action: "hospital-confirm" | "hospital-decline") {
    setBusy(true);
    onError("");
    try {
      const body = action === "hospital-confirm" ? { doctor: Number(doctor), date: day, time, note } : { reason };
      await api(`/api/appointment-requests/${r.id}/${action}/`, { method: "POST", body: JSON.stringify(body) });
      onDone();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-slate-200 p-4" aria-label={`Request from ${r.patient_name}`}>
      <p className="font-[650] text-[#00295c]">
        {r.patient_name}{r.patient_id && <span className="ml-2 text-xs font-normal text-slate-500">{r.patient_id}</span>}
      </p>
      <p className="text-sm text-slate-600">
        Asked for <b>{r.doctor_name}</b>{dept && ` (${dept})`} · {fmtDay(r.preferred_date)}, {r.preferred_time || "any time"}
      </p>
      {r.reason && <p className="text-sm text-slate-500">Reason: {r.reason}</p>}
      {r.phone && <p className="text-sm text-slate-500">Phone: <a href={`tel:${r.phone}`} className="text-teal-700 hover:underline">{r.phone}</a></p>}

      <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <label className="text-xs text-slate-600">Doctor
          <select className="input mt-1 py-2" value={doctor} onChange={(e) => setDoctor(e.target.value)} aria-label={`Doctor for ${r.patient_name}`}>
            {same.length > 0 && (
              <optgroup label={`${dept || "Same department"} doctors`}>
                {same.map((d) => <option key={d.id} value={d.id}>{label(d)}</option>)}
              </optgroup>
            )}
            {others.length > 0 && (
              <optgroup label="Other doctors">
                {others.map((d) => <option key={d.id} value={d.id}>{label(d)} · {deptOf(d)}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <label className="text-xs text-slate-600">Date
          <input type="date" className="input mt-1 py-2" value={day} onChange={(e) => setDay(e.target.value)} aria-label={`Date for ${r.patient_name}`} />
        </label>
        <label className="text-xs text-slate-600">Time
          <input type="time" className="input mt-1 py-2" value={time} onChange={(e) => setTime(e.target.value)} aria-label={`Time for ${r.patient_name}`} />
        </label>
        <button onClick={() => send("hospital-confirm")} disabled={busy || !doctor || !time} className="btn-solid px-4 py-2">Confirm</button>
        <input className="input py-2 sm:col-span-4" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)}
               placeholder="Note for the patient (optional), e.g. come 15 minutes early" aria-label={`Note for ${r.patient_name}`} />
      </div>
      {same.length <= 1 && dept && (
        <p className="mt-2 text-xs text-slate-500">No other {dept} doctor in your Doctor management. If the doctor asked for isn&apos;t free, decline with a reason.</p>
      )}

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input className="input flex-1 py-2" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
               placeholder={`Reason, if you decline (the patient sees it), e.g. no ${dept || "doctor"} available that week`}
               aria-label={`Reason if declining ${r.patient_name}`} />
        <button onClick={() => send("hospital-decline")} disabled={busy || reason.trim().length < MIN_REASON}
                className="btn border border-red-200 bg-white px-4 py-2 text-red-700 hover:bg-red-50">Decline</button>
      </div>
    </li>
  );
}
