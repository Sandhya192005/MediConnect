"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BarChart, LineChart } from "@/components/Charts";
import { EmptyState, Panel, SkeletonRows, StatCard } from "@/components/DashboardShell";
import HospitalReports from "@/components/HospitalReports";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, type PlatformReports } from "@/lib/types";

const RANGES = [6, 12, 24];
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * /admin/reports: each account sees its own reports. A hospital account sees its hospital's reports
 * (HospitalReports, 2026-11-20); the platform admin sees the platform's.
 */
export default function ReportsPage() {
  const { user } = useAuth();
  return (
    <RoleGuard role={["hospital", "admin"]}>
      {user?.role === "hospital" ? <HospitalReports /> : <PlatformReportsPage />}
    </RoleGuard>
  );
}

/**
 * Reports & analytics for the platform admin: how patients and doctors use MediConnect month by month,
 * and how the platform grows as more hospitals connect. Data from /api/platform/reports/.
 */
function PlatformReportsPage() {
  const { user } = useAuth();
  const [months, setMonths] = useState(12);
  const [r, setR] = useState<PlatformReports | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.is_platform_admin) return;
    setR(null);
    api<PlatformReports>(`/api/platform/reports/?months=${months}`).then(setR).catch((e) => setError(errorMessage(e)));
  }, [months, user?.is_platform_admin]);

  return (
    <>
      {!user?.is_platform_admin ? (
        <EmptyState icon="chart" title="Platform reports are for the MediConnect platform admin" />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="page-title">Reports &amp; analytics</h1>
              <p className="page-subtitle text-sm">How patients and doctors use MediConnect, and how it grows as hospitals connect.</p>
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

          {r === null ? <SkeletonRows rows={6} /> : <Reports r={r} months={months} />}
        </>
      )}
    </>
  );
}

function Reports({ r, months }: { r: PlatformReports; months: number }) {
  const u = r.usage, g = r.growth;
  const period = `last ${months} months`;
  return (
    <div className="space-y-10">
      {/* ---- Platform usage ---- */}
      <section aria-labelledby="usage-h" className="space-y-6">
        <h2 id="usage-h" className="text-lg text-[#00295c]">Platform usage</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon="users" tone="teal" label="New patient accounts" value={sum(u.new_patients)} detail={period} />
          <StatCard icon="stethoscope" tone="blue" label="New doctor accounts" value={sum(u.new_doctors)} detail={period} />
          <StatCard icon="calendar" tone="indigo" label="Appointments booked" value={sum(u.appointments_booked)} detail={`${sum(u.appointments_completed)} completed`} />
          <StatCard icon="folder" tone="orange" label="Records uploaded" value={sum(u.records_uploaded)} detail={`${sum(u.check_ins)} queue check-ins`} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="New sign-ups">
            <LineChart ariaLabel={`New patient and doctor sign-ups per month, ${period}`} labels={r.months}
                       series={[{ label: "Patients", values: u.new_patients }, { label: "Doctors", values: u.new_doctors }]} />
          </Panel>
          <Panel title="Active users">
            <p className="-mt-2 mb-3 text-xs text-slate-500">With at least one appointment that month.</p>
            <LineChart ariaLabel={`Active patients and doctors per month, ${period}`} labels={r.months}
                       series={[{ label: "Patients", values: u.active_patients }, { label: "Doctors", values: u.active_doctors }]} />
          </Panel>
          <Panel title="Appointments">
            <LineChart ariaLabel={`Appointments booked and completed per month, ${period}`} labels={r.months}
                       series={[{ label: "Booked", values: u.appointments_booked }, { label: "Completed", values: u.appointments_completed }]} />
          </Panel>
          <Panel title="Medical records uploaded">
            <BarChart ariaLabel={`Medical records uploaded per month, ${period}`} labels={r.months}
                      series={{ label: "Records", values: u.records_uploaded }} />
          </Panel>
        </div>
      </section>

      {/* ---- Hospital growth ---- */}
      <section id="growth" aria-labelledby="growth-h" className="space-y-6">
        <div>
          <h2 id="growth-h" className="text-lg text-[#00295c]">Hospital growth</h2>
          <p className="text-sm text-slate-500">How MediConnect grows as more hospitals connect. Each chart has its own scale.</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Connected hospitals">
            <p className="-mt-2 mb-3 text-xs text-slate-500">Total at the end of each month.</p>
            <LineChart ariaLabel={`Connected hospitals at the end of each month, ${period}`} labels={r.months}
                       series={[{ label: "Hospitals", values: g.total_hospitals }]} />
          </Panel>
          <Panel title="New hospitals connected">
            <BarChart ariaLabel={`Hospitals connected each month, ${period}`} labels={r.months}
                      series={{ label: "New hospitals", values: g.new_hospitals }} />
          </Panel>
          <Panel title="Connected vs hospital accounts" className="lg:col-span-2">
            <p className="-mt-2 mb-3 text-xs text-slate-500">
              Connected = patients can book there. Hospital account = the hospital also runs its staff and patient records on MediConnect.
            </p>
            <LineChart ariaLabel={`Connected hospitals and hospital accounts at the end of each month, ${period}`} labels={r.months}
                       series={[{ label: "Connected", values: g.total_hospitals }, { label: "Accounts", values: g.total_hospital_accounts }]} />
          </Panel>
          <Panel title="People on the platform" className="lg:col-span-2">
            <p className="-mt-2 mb-3 text-xs text-slate-500">Total patient and doctor accounts at the end of each month, growing alongside the hospitals above.</p>
            <LineChart ariaLabel={`Total patients and doctors at the end of each month, ${period}`} labels={r.months}
                       series={[{ label: "Patients", values: g.total_patients }, { label: "Doctors", values: g.total_doctors }]} />
          </Panel>
        </div>

        <Panel title={`Connected hospitals (${r.hospitals.length})`}>
          {r.hospitals.length === 0 ? (
            <EmptyState icon="hospital" title="No hospitals connected yet">
              <Link href="/admin/connections" className="dash-link mt-3">Connection requests</Link>
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-slate-400">
                  <tr>
                    <th className="pb-2 font-medium">Hospital</th>
                    <th className="pb-2 font-medium">Connected</th>
                    <th className="pb-2 font-medium">Hospital account</th>
                    <th className="pb-2 text-right font-medium">Staff</th>
                    <th className="pb-2 text-right font-medium">Doctors</th>
                    <th className="pb-2 text-right font-medium">Patients</th>
                    <th className="pb-2 text-right font-medium">Appointments</th>
                    <th className="pb-2 text-right font-medium">Last 30 days</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {r.hospitals.map((h) => (
                    <tr key={h.id}>
                      <td className="py-2.5"><span className="font-[650] text-[#00295c]">{h.name}</span><span className="text-slate-500"> · {h.city}</span></td>
                      <td className="py-2.5 text-slate-600">
                        {h.connected_on ? fmtDate(h.connected_on) : "—"}
                        {h.estimated && <span className="ml-1 text-xs text-slate-400" title="Connected before approval dates were recorded: this is the date it was added">(approx.)</span>}
                      </td>
                      <td className="py-2.5">
                        {h.has_account
                          ? <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-[650] text-teal-700">Yes</span>
                          : <span className="text-xs text-slate-400">No</span>}
                      </td>
                      <td className="py-2.5 text-right tabular-nums">{h.staff}</td>
                      <td className="py-2.5 text-right tabular-nums">{h.doctors}</td>
                      <td className="py-2.5 text-right tabular-nums">{h.patients}</td>
                      <td className="py-2.5 text-right tabular-nums">{h.appointments}</td>
                      <td className="py-2.5 text-right tabular-nums">{h.appointments_30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </section>
    </div>
  );
}
