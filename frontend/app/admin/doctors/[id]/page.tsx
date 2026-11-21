"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, IconTile, Panel, pillFor, SkeletonRows, StatusPill } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtDateTime, timeAgo, type Appointment, type DoctorAppointments } from "@/lib/types";

type Tab = "accepted" | "rejected" | "waiting";

/**
 * One doctor's appointments for the hospital's Doctor management (booking flow, owner decision 2026-11-21):
 * what they accepted, what they rejected (and why, also after the hospital gave it to another doctor),
 * and what still waits for their answer.
 */
export default function DoctorAppointmentsPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DoctorAppointments | null>(null);
  const [tab, setTab] = useState<Tab>("accepted");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<DoctorAppointments>(`/api/hospital-admin/doctors/${id}/appointments/`).then(setData).catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(() => {
    load();
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  const d = data?.doctor;
  const tabs: { key: Tab; label: string; n: number }[] = [
    { key: "accepted", label: "Accepted", n: data?.counts.accepted ?? 0 },
    { key: "rejected", label: "Rejected", n: data?.counts.rejected ?? 0 },
    { key: "waiting", label: "Waiting for answer", n: data?.counts.waiting ?? 0 },
  ];

  return (
    <RoleGuard role="hospital">
      <Link href="/admin/doctors" className="dash-link mb-3">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Doctor management
      </Link>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {!data ? (
        !error && <SkeletonRows rows={5} />
      ) : (
        <div className="space-y-6">
          <section aria-label="Doctor" className="dash-card flex flex-wrap items-center gap-4 p-5">
            <IconTile icon="stethoscope" tone="blue" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-[#00295c]">{d!.name}</h1>
              <p className="text-sm text-slate-600">{[d!.specialization, d!.department].filter(Boolean).join(" · ") || "No specialization yet"} · {d!.email}</p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-[650] ring-1 ${d!.is_bookable ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
              {d!.is_bookable ? "Taking bookings" : "Not bookable yet"}
            </span>
          </section>

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
                        <span className="text-slate-600 font-normal">· {fmtDateTime(r.start)}</span>
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
      )}
    </RoleGuard>
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
