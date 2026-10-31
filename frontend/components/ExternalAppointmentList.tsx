"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDateTime, type ExternalAppointment } from "@/lib/types";
import ExternalAppointmentForm from "./ExternalAppointmentForm";

/** Appointments the patient booked directly with hospitals (reminders only). */
export default function ExternalAppointmentList() {
  const [items, setItems] = useState<ExternalAppointment[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<ExternalAppointment[]>("/api/external-appointments/?when=upcoming").then(setItems).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  async function remove(id: number) {
    if (!window.confirm("Remove this appointment from MediConnect? (It won't cancel it with the hospital.)")) return;
    await api(`/api/external-appointments/${id}/`, { method: "DELETE" }).catch((e) => setError(errorMessage(e)));
    load();
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Booked directly with hospitals</h2>
          <p className="text-sm text-slate-500">Appointments you made on a hospital&apos;s website or by phone. We only send reminders.</p>
        </div>
        <button onClick={() => setAdding(!adding)} className="rounded-md border border-teal-600 px-3 py-1.5 text-sm text-teal-700 hover:bg-teal-50">
          {adding ? "Close" : "+ Add one"}
        </button>
      </div>
      {adding && <div className="mt-3"><ExternalAppointmentForm onSaved={load} /></div>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {items && items.length > 0 && (
        <ul className="mt-3 space-y-3">
          {items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4">
              <div>
                <p className="font-medium">
                  {e.hospital ? <Link href={`/hospitals/${e.hospital}`} className="hover:text-teal-700">{e.display_hospital}</Link> : e.display_hospital}
                  {e.doctor_name ? ` · ${e.doctor_name}` : ""}
                </p>
                <p className="text-sm text-slate-600">{fmtDateTime(e.start)}{e.booking_reference ? ` · Ref ${e.booking_reference}` : ""}</p>
                <p className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{e.label}</p>
              </div>
              <button onClick={() => remove(e.id)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-600">Remove</button>
            </li>
          ))}
        </ul>
      )}
      {items && items.length === 0 && !adding && <p className="mt-3 text-sm text-slate-500">None yet.</p>}
    </section>
  );
}
