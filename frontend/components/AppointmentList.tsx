"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtDateTime, type Appointment } from "@/lib/types";
import Icon from "./Icons";
import { Avatar } from "./PageHeader";
import StatusBadge from "./StatusBadge";

type Viewer = "patient" | "doctor";

/** Upcoming/past appointment list with the actions each role is allowed. */
export default function AppointmentList({ viewer, extraQuery = "" }: { viewer: Viewer; extraQuery?: string }) {
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setItems(null);
    api<Appointment[]>(`/api/appointments/?when=${when}${extraQuery}`)
      .then(setItems)
      .catch((e) => setError(errorMessage(e)));
  }, [when, extraQuery]);

  useEffect(load, [load]);

  // Reload when a live notification arrives (e.g. a doctor confirms, a patient books).
  useEffect(() => {
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  async function act(id: number, action: "cancel" | "confirm" | "complete") {
    if (action === "cancel" && !window.confirm("Cancel this appointment?")) return;
    try {
      await api(`/api/appointments/${id}/${action}/`, { method: "POST" });
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
            const d = new Date(a.start);
            const who = viewer === "patient" ? a.doctor_name : a.patient_name;
            return (
              <li key={a.id} className={`card flex flex-wrap items-center gap-4 p-4 ${a.status === "cancelled" ? "opacity-70" : ""}`}>
                <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-teal-50 py-2 text-teal-800">
                  <span className="text-[10px] font-semibold uppercase">{d.toLocaleDateString(undefined, { month: "short" })}</span>
                  <span className="text-xl font-bold leading-none">{d.getDate()}</span>
                  <span className="text-[10px] text-teal-700">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={who} />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-800">
                      {who} <StatusBadge status={a.status} />
                    </p>
                    <p className="text-sm text-slate-600">
                      {fmtDateTime(a.start)}
                      {viewer === "patient" ? ` · ${a.specialization} · ${a.hospital_name}` : ` · ${a.patient_email}`}
                    </p>
                    {a.reason && <p className="text-sm text-slate-500">Reason: {a.reason}</p>}
                  </div>
                </div>
                {active && when === "upcoming" && (
                  <div className="flex gap-2 text-sm">
                    {viewer === "doctor" && a.status === "booked" && (
                      <button onClick={() => act(a.id, "confirm")} className="btn-solid px-3 py-1.5">
                        Confirm
                      </button>
                    )}
                    {viewer === "doctor" && (
                      <button onClick={() => act(a.id, "complete")} className="btn-outline px-3 py-1.5">
                        Mark done
                      </button>
                    )}
                    <button onClick={() => act(a.id, "cancel")} className="btn border border-red-200 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50">
                      Cancel
                    </button>
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
