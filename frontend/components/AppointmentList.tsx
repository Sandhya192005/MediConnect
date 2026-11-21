"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtDateTime, type Appointment } from "@/lib/types";
import HospitalPlace from "./HospitalPlace";
import Icon from "./Icons";
import { Avatar } from "./PageHeader";
import StatusBadge from "./StatusBadge";
import { TreatmentNoteForm } from "./TreatmentNotes";

type Viewer = "patient" | "doctor";

const endOfToday = () => {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};

/** Upcoming/past appointment list with the actions each role is allowed. */
export default function AppointmentList({ viewer, extraQuery = "" }: { viewer: Viewer; extraQuery?: string }) {
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [error, setError] = useState("");
  const [noteFor, setNoteFor] = useState<number | null>(null); // the visit whose note form is open
  const [rejectFor, setRejectFor] = useState<number | null>(null); // the request whose Reject form is open
  const [rejectReason, setRejectReason] = useState("");

  // Only the newest request may fill the list: several reloads can overlap (a tab switch plus live
  // notifications), and an older "upcoming" answer arriving last must not replace the "past" list.
  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    setItems(null);
    api<Appointment[]>(`/api/appointments/?when=${when}${extraQuery}`)
      .then((list) => { if (mine === latest.current) setItems(list); })
      .catch((e) => { if (mine === latest.current) setError(errorMessage(e)); });
  }, [when, extraQuery]);

  useEffect(load, [load]);

  // Reload when a live notification arrives (e.g. a doctor confirms, a patient books).
  useEffect(() => {
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  type Action = "cancel" | "confirm" | "complete" | "no-show" | "undo-no-show" | "doctor-accept" | "doctor-reject";
  async function act(id: number, action: Action, body: object = {}) {
    if (action === "cancel" && !window.confirm("Cancel this appointment?")) return;
    setError("");
    try {
      await api(`/api/appointments/${id}/${action}/`, { method: "POST", body: JSON.stringify(body) });
      if (action === "doctor-reject") { setRejectFor(null); setRejectReason(""); }
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div>
      <div className="mb-4 inline-flex rounded-xl bg-slate-100 p-1">
        {(["upcoming", "past"] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWhen(w)}
            aria-pressed={when === w}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold capitalize transition ${when === w ? "bg-white text-navy-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            {w}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {items === null ? (
        <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="card h-24 animate-pulse bg-slate-100/60" />)}</div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon name="calendar" /></span>
          <p className="mt-3 font-medium text-navy-800">No {when} appointments.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const active = a.status === "booked" || a.status === "confirmed";
            const pending = a.status === "booked" && (a.awaiting_hospital || a.awaiting_doctor); // not accepted yet
            const toAnswer = viewer === "doctor" && a.status === "booked" && a.awaiting_doctor;
            const d = new Date(a.start);
            const who = viewer === "patient" ? a.doctor_name : a.patient_name;
            return (
              <li key={a.id} aria-label={`${who}, ${fmtDateTime(a.start)}`}
                  className={`card flex flex-wrap items-center gap-4 p-4 ${a.status === "cancelled" ? "opacity-70" : ""} ${toAnswer ? "ring-2 ring-amber-200" : ""}`}>
                <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-teal-50 py-2 text-teal-800">
                  <span className="text-[10px] font-semibold uppercase">{d.toLocaleDateString(undefined, { month: "short" })}</span>
                  <span className="text-xl font-bold leading-none">{d.getDate()}</span>
                  <span className="text-[10px] text-teal-700">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={who} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-800">
                      {who} <StatusBadge status={a.status} awaiting={a.awaiting_hospital} awaitingDoctor={a.awaiting_doctor} />
                    </p>
                    <p className="text-sm text-slate-600">
                      {fmtDateTime(a.start)}
                      {viewer === "patient" ? ` · ${a.specialization} · ${a.hospital_name}` : ` · ${a.patient_email}`}
                    </p>
                    {a.reason && <p className="text-sm text-slate-500">Reason: {a.reason}</p>}
                    {a.awaiting_hospital && a.status === "booked" && (
                      <p className="text-sm text-orange-800">Your time is held. The hospital will accept it and assign a doctor.</p>
                    )}
                    {a.awaiting_doctor && a.status === "booked" && (
                      <p className="text-sm text-amber-800">
                        {viewer === "doctor"
                          ? `${a.source === "hospital" ? `Assigned to you by ${a.hospital_name}` : "Personal request to you"}: accept or reject it.`
                          : "Your time is held. Waiting for the doctor to accept."}
                      </p>
                    )}
                    {a.cancelled_by === "doctor" && a.cancel_reason && (
                      <p className="text-sm text-slate-600">Declined by the doctor: {a.cancel_reason}</p>
                    )}
                    {a.cancelled_by === "system" && (
                      <p className="text-sm text-slate-600">Not confirmed before the appointment time.</p>
                    )}
                    {a.status === "no_show" && (
                      <p className="text-sm text-rose-700">
                        {viewer === "patient" ? "You didn't come to this visit" : "The patient didn't come"}
                        {a.no_show_by && ` (marked by the ${a.no_show_by})`}.
                      </p>
                    )}
                    {a.cancelled_by === "hospital" && a.cancel_reason && (
                      <p className="text-sm text-slate-600">Declined by the hospital: {a.cancel_reason}</p>
                    )}
                    {viewer === "patient" && a.hospital && a.status !== "cancelled" && (
                      <HospitalPlace name={a.hospital_name ?? ""} place={a.hospital} />
                    )}
                  </div>
                </div>
                {/* Booking flow (2026-11-21): the doctor accepts or rejects (with a reason) a request given to them. */}
                {toAnswer && rejectFor !== a.id && (
                  <div className="flex gap-2 text-sm">
                    <button onClick={() => act(a.id, "doctor-accept")} className="btn-solid px-3 py-1.5">
                      Accept<span className="sr-only"> {a.patient_name}</span>
                    </button>
                    <button onClick={() => { setRejectFor(a.id); setRejectReason(""); }}
                            className="btn border border-red-200 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50">
                      Reject<span className="sr-only"> {a.patient_name}</span>
                    </button>
                  </div>
                )}
                {toAnswer && rejectFor === a.id && (
                  <form className="flex w-full flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); act(a.id, "doctor-reject", { reason: rejectReason }); }}>
                    <input className="input flex-1" maxLength={300} required autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                           aria-label={`Reason for rejecting ${a.patient_name}`}
                           placeholder={a.source === "hospital" ? "Reason (the hospital sees it, e.g. \"On leave that day\")" : "Reason (the patient sees it)"} />
                    <button className="btn border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50">Reject</button>
                    <button type="button" onClick={() => setRejectFor(null)} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
                  </form>
                )}
                {active && !toAnswer && when === "upcoming" && (
                  <div className="flex gap-2 text-sm">
                    {viewer === "doctor" && !pending && a.status === "booked" && (
                      <button onClick={() => act(a.id, "confirm")} className="btn-solid px-3 py-1.5">
                        Confirm
                      </button>
                    )}
                    {viewer === "doctor" && !pending && (
                      <button onClick={() => act(a.id, "complete")} className="btn-outline px-3 py-1.5">
                        Mark done
                      </button>
                    )}
                    <button onClick={() => act(a.id, "cancel")} className="btn border border-red-200 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50">
                      Cancel
                    </button>
                  </div>
                )}
                {/* No-show (2026-11-20): the server says when it's allowed (visit started, ≤ 7 days, never checked in). */}
                {viewer === "doctor" && a.can_mark_no_show && (
                  <button onClick={() => act(a.id, "no-show")} className="btn border border-rose-200 bg-white px-3 py-1.5 text-sm text-rose-700 hover:bg-rose-50">
                    Didn&apos;t come<span className="sr-only"> for {a.patient_name}</span>
                  </button>
                )}
                {viewer === "doctor" && a.can_undo_no_show && (
                  <button onClick={() => act(a.id, "undo-no-show")} className="btn-ghost px-3 py-1.5 text-sm">
                    Undo missed<span className="sr-only"> for {a.patient_name}</span>
                  </button>
                )}
                {/* Treatment note (reference design, Part 3): on the day of the visit or after it. */}
                {viewer === "doctor" && a.status !== "cancelled" && a.status !== "no_show" && !pending && new Date(a.start) <= endOfToday() && noteFor !== a.id && (
                  <button onClick={() => setNoteFor(a.id)} className={`${a.treatment_note ? "btn-ghost" : "btn-outline"} px-3 py-1.5 text-sm`}>
                    <Icon name="file" className="h-4 w-4" /> {a.treatment_note ? "Edit note" : "Write note"}
                  </button>
                )}
                {noteFor === a.id && (
                  <div className="w-full rounded-xl border border-slate-100 bg-white p-4">
                    <p className="mb-3 text-sm font-[650] text-[#00295c]">Treatment note · {a.patient_name}</p>
                    <TreatmentNoteForm appointmentId={a.id} noteId={a.treatment_note}
                                       onCancel={() => setNoteFor(null)} onSaved={() => { setNoteFor(null); load(); }} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
