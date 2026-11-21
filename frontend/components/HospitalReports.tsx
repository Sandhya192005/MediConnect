"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LineChart } from "./Charts";
import { EmptyState, Panel, SkeletonRows, StatCard } from "./DashboardShell";
import { api, errorMessage } from "@/lib/api";
import type { HospitalReports as Reports } from "@/lib/types";

const RANGES = [6, 12, 24];
const pct = (part: number, whole: number) => (whole ? `${Math.round((part * 100) / whole)}%` : "—");

/**
 * The hospital account's Reports page (owner request 2026-11-20): its own appointments, patients, doctors and
 * departments over 6 / 12 / 24 months, all counted from real appointments (/api/hospital-admin/reports/).
 * No-shows ("Missed") are visits the doctor or hospital marked "Didn't come" (since 2026-11-20).
 */
export default function HospitalReports() {
  const [months, setMonths] = useState(12);
  const [r, setR] = useState<Reports | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setR(null);
    setError("");
    api<Reports>(`/api/hospital-admin/reports/?months=${months}`).then(setR).catch((e) => setError(errorMessage(e)));
  }, [months]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle text-sm">Your hospital&apos;s appointments, patients and doctors, month by month.</p>
        </div>
        <div role="group" aria-label="Period" className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {RANGES.map((m) => (
            <button key={m} onClick={() => setMonths(m)} aria-pressed={months === m}
                    className={`rounded-lg px-3 py-1.5 text-sm ${months === m ? "bg-teal-600 font-[650] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
              {m} months
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {r === null ? (!error && <SkeletonRows rows={6} />) : <Body r={r} months={months} />}
    </>
  );
}

function Body({ r, months }: { r: Reports; months: number }) {
  const t = r.totals;
  const period = `last ${months} months`;
  const cancelled = t.cancelled_by_patient + t.cancelled_by_doctor + t.declined_by_hospital;

  if (t.appointments === 0 && cancelled === 0) {
    return (
      <EmptyState icon="chart" title={`No appointments in the ${period}`}
                  text="Reports fill in as patients book your doctors. Doctors need a MediConnect account at your hospital and working hours, and your hospital must be connected.">
        <Link href="/admin" className="dash-link mt-3">Back to the dashboard</Link>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="calendar" tone="teal" label="Appointments" value={t.appointments} detail={`${t.upcoming} still upcoming · ${period}`} />
        <StatCard icon="check" tone="blue" label="Completed visits" value={t.completed} detail={`${pct(t.completed, t.appointments)} of appointments · ${t.no_show} missed (no-show)`} />
        <StatCard icon="users" tone="indigo" label="Patients" value={r.patients.unique} detail={`with an appointment · ${r.patients.new_total} new to your hospital`} />
        <StatCard icon="close" tone="rose" label="Cancelled" value={cancelled}
                  detail={`${t.cancelled_by_patient} by patients · ${t.cancelled_by_doctor} by doctors · ${t.declined_by_hospital} declined by you`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Appointments per month">
          <p className="-mt-2 mb-3 text-xs text-slate-500">By visit date, not counting cancelled ones. Booked includes visits already completed.</p>
          <LineChart ariaLabel={`Appointments and completed visits per month, ${period}`} labels={r.months}
                     series={[{ label: "Booked", values: r.appointments.booked }, { label: "Completed", values: r.appointments.completed }]} />
        </Panel>
        <Panel title="Patients per month">
          <p className="-mt-2 mb-3 text-xs text-slate-500">New = their first visit at your hospital. Returning = they visited before.</p>
          <LineChart ariaLabel={`New and returning patients per month, ${period}`} labels={r.months}
                     series={[{ label: "New", values: r.patients.new }, { label: "Returning", values: r.patients.returning }]} />
        </Panel>
      </div>

      <Panel title="Doctors">
        <Table
          label={`Appointments per doctor, ${period}`}
          first="Doctor"
          rows={r.doctors.map((d) => ({
            ...d,
            key: `d${d.id}`,
            name: <><span className="font-[650] text-[#00295c]">{/^dr\.?\s/i.test(d.name) ? d.name : `Dr. ${d.name}`}</span><span className="text-slate-500">{d.specialization && ` · ${d.specialization}`}</span></>,
            extra: d.department || "—",
          }))}
          extraHead="Department"
          empty="No doctor accounts at your hospital yet."
        />
      </Panel>

      <Panel title="Departments">
        <Table
          label={`Appointments per department, ${period}`}
          first="Department"
          rows={r.departments.map((d) => ({
            ...d,
            key: `p${d.name}`,
            name: <span className="font-[650] text-[#00295c]">{d.name || "No department"}</span>,
            extra: String(d.doctors),
          }))}
          extraHead="Doctors"
          extraRight
          empty="No departments yet."
        />
      </Panel>
      <p className="text-xs text-slate-500">
        Counted from your hospital&apos;s appointments on MediConnect. Missed = marked &quot;Didn&apos;t come&quot; by the doctor or your
        hospital (since 20 Nov 2026); earlier missed visits were counted as completed.
      </p>
    </div>
  );
}

type Row = { key: string; name: React.ReactNode; extra: string; appointments: number; completed: number; cancelled: number; no_show: number; patients: number };

function Table({ label, first, rows, extraHead, extraRight = false, empty }: {
  label: string; first: string; rows: Row[]; extraHead: string; extraRight?: boolean; empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  const num = "py-2.5 text-right tabular-nums";
  return (
    <div className="overflow-x-auto">
      <table aria-label={label} className="w-full min-w-[700px] text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-slate-400">
          <tr>
            <th className="pb-2 font-medium">{first}</th>
            <th className={`pb-2 font-medium ${extraRight ? "text-right" : ""}`}>{extraHead}</th>
            <th className="pb-2 text-right font-medium">Appointments</th>
            <th className="pb-2 text-right font-medium">Completed</th>
            <th className="pb-2 text-right font-medium">Missed</th>
            <th className="pb-2 text-right font-medium">Cancelled</th>
            <th className="pb-2 text-right font-medium">Patients</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((x) => (
            <tr key={x.key}>
              <td className="py-2.5">{x.name}</td>
              <td className={`py-2.5 text-slate-600 ${extraRight ? "text-right tabular-nums" : ""}`}>{x.extra}</td>
              <td className={num}>{x.appointments}</td>
              <td className={num}>{x.completed}</td>
              <td className={num}>{x.no_show}</td>
              <td className={num}>{x.cancelled}</td>
              <td className={num}>{x.patients}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
