"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtDateTime, timeAgo, type Appointment, type DoctorAppointments } from "@/lib/types";
import { EmptyState, Panel, pillFor, SkeletonRows, StatusPill } from "./DashboardShell";

type Tab = "accepted" | "rejected" | "waiting";

/**
 * One doctor's appointments at this hospital (booking flow, 2026-11-21): accepted, rejected (with the reason,
 * also after the hospital gave it to another doctor) and waiting for their answer. Used on the doctor's page in
 * Doctor management and on /admin/doctors/<id>.
 */
export default function DoctorAppointmentsPanel({ doctorId, onLoaded }: { doctorId: number | string; onLoaded?: (d: DoctorAppointments) => void }) {
  const [data, setData] = useState<DoctorAppointments | null>(null);
  const [tab, setTab] = useState<Tab>("accepted");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<DoctorAppointments>(`/api/hospital-admin/doctors/${doctorId}/appointments/`)
      .then((d) => { setData(d); onLoaded?.(d); })
      .catch((e) => setError(errorMessage(e)));
  }, [doctorId, onLoaded]);
  useEffect(() => {
    load();
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  if (error) return <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>;
  if (!data) return <SkeletonRows rows={3} />;

  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "accepted", label: "Accepted", n: data.counts.accepted },
    { key: "rejected", label: "Rejected", n: data.counts.rejected },
    { key: "waiting", label: "Waiting for answer", n: data.counts.waiting },
  ];
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Appointments" className="inline-flex flex-wrap rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${tab === t.key ? "bg-teal-600 font-[650] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {t.label}
            <span className={`rounded-full px-1.5 text-xs font-[650] ${tab === t.key ? "bg-white text-teal-700" : "bg-slate-100 text-slate-600"}`}>{t.n}</span>
          </button>
        ))}
      </div>

      {tab === "accepted" && (
        <Panel title="Accepted appointments">
          <AppointmentRows items={data.accepted} empty="No accepted appointments yet." />
        </Panel>
      )}
      {tab === "waiting" && (
        <Panel title="Waiting for the doctor's answer">
          <AppointmentRows items={data.waiting} empty="Nothing is waiting for this doctor." />
        </Panel>
      )}
      {tab === "rejected" && (
        <Panel title="Rejected appointments">
          {data.rejected.length === 0 ? (
            <EmptyState icon="calendar" title="No rejections" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.rejected.map((r) => (
                <li key={r.id} className="py-3 text-sm first:pt-0 last:pb-0">
                  <p className="flex flex-wrap items-center gap-2 font-[650] text-[#00295c]">
                    {r.patient_name}
                    {r.patient_id && <span className="font-mono text-xs font-normal text-slate-500">{r.patient_id}</span>}
                    <span className="font-normal text-slate-600">· {fmtDateTime(r.start)}</span>
                  </p>
                  <p className="text-rose-700">Reason: {r.reason}</p>
                  <p className="text-xs text-slate-500">
                    Rejected {timeAgo(r.at)}
                    {r.now_with ? ` · now with ${r.now_with}` : r.status === "cancelled" ? " · declined" : " · waiting for you to reassign"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

function AppointmentRows({ items, empty }: { items: Appointment[]; empty: string }) {
  if (items.length === 0) return <EmptyState icon="calendar" title={empty} />;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-3 py-3 text-sm first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-[650] text-[#00295c]">
              {a.patient_name}
              {a.patient_id && <span className="font-mono text-xs font-normal text-slate-500">{a.patient_id}</span>}
              <StatusPill status={pillFor(a)} />
            </p>
            <p className="text-slate-600">
              {fmtDateTime(a.start)} · {a.source === "hospital" ? "Through your hospital" : "Personal request"}
              {a.reason ? ` · ${a.reason}` : ""}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
