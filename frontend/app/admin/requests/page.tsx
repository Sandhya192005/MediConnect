"use client";

import PageHeader from "@/components/PageHeader";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import type { AppointmentRequest } from "@/lib/types";

function Requests() {
  const [items, setItems] = useState<AppointmentRequest[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<AppointmentRequest[]>("/api/appointment-requests/?status=pending").then(setItems).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  async function act(id: number, action: "confirm" | "decline") {
    try {
      await api(`/api/appointment-requests/${id}/${action}/`, { method: "POST", body: JSON.stringify({ note: notes[id] ?? "" }) });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!items) return <p className="text-slate-500">Loading…</p>;
  return (
    <>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {items.length === 0 ? (
        <p className="card p-6 text-center text-slate-500">No pending requests.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <li key={r.id} className="card p-4">
              <p className="font-medium">
                <Link href={`/hospitals/${r.hospital}`} className="hover:text-teal-700">{r.hospital_name}</Link>
                {r.doctor_name ? ` · ${r.doctor_name}` : ""}
              </p>
              <p className="text-sm text-slate-600">
                {r.patient_email}{r.phone ? ` · ${r.phone}` : ""} · {r.preferred_date} · {r.preferred_time}
              </p>
              {r.reason && <p className="text-sm text-slate-500">Reason: {r.reason}</p>}
              <p className="mt-1 text-xs text-slate-400">Confirm only after the hospital has agreed (e.g. by phone: {r.hospital_phone || "no phone saved"}).</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input className="input max-w-xs" placeholder="Note to patient (e.g. come at 10 am)" value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                <button onClick={() => act(r.id, "confirm")} className="btn-solid px-3 py-1.5">Confirm</button>
                <button onClick={() => act(r.id, "decline")} className="btn border border-red-200 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50">Decline</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function AdminRequestsPage() {
  return (
    <RoleGuard role="admin">
      <div className="mb-6"><PageHeader icon="chat" title="Appointment requests" subtitle="Requests to non-partner hospitals. Confirm only after checking with the hospital." /></div>
      <Requests />
    </RoleGuard>
  );
}
