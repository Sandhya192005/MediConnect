"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, type Appointment } from "@/lib/types";
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
      <div className="mb-4 flex gap-2">
        {(["upcoming", "past"] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWhen(w)}
            className={`rounded-md px-3 py-1.5 text-sm capitalize ${when === w ? "bg-teal-600 text-white" : "border border-slate-300 bg-white"}`}
          >
            {w}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
      {items === null ? (
        <p className="text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-slate-500">No {when} appointments.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const active = a.status === "booked" || a.status === "confirmed";
            return (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div>
                  <p className="font-medium">
                    {viewer === "patient" ? a.doctor_name : a.patient_name}{" "}
                    <StatusBadge status={a.status} />
                  </p>
                  <p className="text-sm text-slate-600">
                    {fmtDateTime(a.start)}
                    {viewer === "patient" ? ` · ${a.specialization} · ${a.hospital_name}` : ` · ${a.patient_email}`}
                  </p>
                  {a.reason && <p className="text-sm text-slate-500">Reason: {a.reason}</p>}
                </div>
                {active && when === "upcoming" && (
                  <div className="flex gap-2 text-sm">
                    {viewer === "doctor" && a.status === "booked" && (
                      <button onClick={() => act(a.id, "confirm")} className="rounded-md bg-teal-600 px-3 py-1.5 text-white">
                        Confirm
                      </button>
                    )}
                    {viewer === "doctor" && (
                      <button onClick={() => act(a.id, "complete")} className="rounded-md border border-slate-300 px-3 py-1.5">
                        Mark done
                      </button>
                    )}
                    <button onClick={() => act(a.id, "cancel")} className="rounded-md border border-red-300 px-3 py-1.5 text-red-700">
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
