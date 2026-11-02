"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import type { AppointmentRequest } from "@/lib/types";

const STYLES: Record<AppointmentRequest["status"], string> = {
  pending: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  confirmed: "bg-teal-50 text-teal-800 ring-1 ring-teal-200",
  declined: "bg-red-50 text-red-700 ring-1 ring-red-200",
  cancelled: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
};

/** Patient view: requests to non-partner hospitals, always with a clear status. */
export default function RequestList() {
  const [items, setItems] = useState<AppointmentRequest[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<AppointmentRequest[]>("/api/appointment-requests/").then(setItems).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  async function cancel(id: number) {
    if (!window.confirm("Cancel this request?")) return;
    await api(`/api/appointment-requests/${id}/cancel/`, { method: "POST" }).catch((e) => setError(errorMessage(e)));
    load();
  }

  if (!items || items.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="section-title">Appointment requests</h2>
      <p className="mb-3 text-sm text-slate-500">Requests to hospitals that aren&apos;t MediConnect partners. These are not bookings until confirmed.</p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <ul className="space-y-3">
        {items.map((r) => (
          <li key={r.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-semibold text-navy-800">
                <Link href={`/hospitals/${r.hospital}`} className="hover:text-teal-700">{r.hospital_name}</Link>{" "}
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[r.status]}`}>{r.status_label}</span>
              </p>
              <p className="text-sm text-slate-600">
                {new Date(r.preferred_date + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · {r.preferred_time}
                {r.doctor_name ? ` · ${r.doctor_name}` : ""}
              </p>
              {r.admin_note && <p className="text-sm text-slate-500">Note: {r.admin_note}</p>}
            </div>
            {r.status === "pending" && (
              <button onClick={() => cancel(r.id)} className="btn border border-red-200 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50">Cancel</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
