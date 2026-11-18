"use client";

import { useEffect, useState } from "react";
import { EmptyState, Panel, SkeletonRows, StatCard } from "@/components/DashboardShell";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { fmtRupees, type StaffMember } from "@/lib/types";

type Row = { department: string; doctors: number; nurses: number; other: number; payroll: number };
const group = (kind: string) => (kind === "doctor" ? "doctors" : kind === "nurse" ? "nurses" : "other");

/** Monthly payroll of the staff working at the hospital now, in total and by department. */
export default function AdminSalaryPage() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<StaffMember[]>("/api/hospital-admin/staff/?status=active").then(setStaff).catch((e) => setError(errorMessage(e)));
  }, []);

  /** Payroll of everyone, or of one group: "doctors", "nurses" or "other" (every other kind of staff). */
  const inGroup = (g?: string) => (staff ?? []).filter((s) => !g || group(s.kind) === g);
  const total = (g?: string) => inGroup(g).reduce((sum, s) => sum + Number(s.monthly_salary), 0);

  const rows: Row[] = Object.values(
    (staff ?? []).reduce<Record<string, Row>>((acc, s) => {
      const key = s.department_name ?? "No department";
      acc[key] ??= { department: key, doctors: 0, nurses: 0, other: 0, payroll: 0 };
      acc[key][group(s.kind)] += 1;
      acc[key].payroll += Number(s.monthly_salary);
      return acc;
    }, {}),
  ).sort((a, b) => b.payroll - a.payroll);

  return (
    <RoleGuard role="admin">
      <div className="mb-6">
        <h1 className="page-title">Staff &amp; salary</h1>
        <p className="page-subtitle text-sm">Monthly payroll of the doctors, nurses and other staff working at your hospital now. Edit salaries on the Doctors, Nurses and Other staff pages.</p>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon="rupee" tone="teal" label="Monthly payroll" value={staff ? fmtRupees(total()) : "…"} detail={staff ? `${staff.length} staff` : undefined} />
        <StatCard icon="stethoscope" tone="blue" label="Doctors" value={staff ? fmtRupees(total("doctors")) : "…"}
                  detail={staff ? `${inGroup("doctors").length} doctors` : undefined} link={{ href: "/admin/doctors", label: "Manage doctors" }} />
        <StatCard icon="nurse" tone="rose" label="Nurses" value={staff ? fmtRupees(total("nurses")) : "…"}
                  detail={staff ? `${inGroup("nurses").length} nurses` : undefined} link={{ href: "/admin/nurses", label: "Manage nurses" }} />
        <StatCard icon="user" tone="orange" label="Other staff" value={staff ? fmtRupees(total("other")) : "…"}
                  detail={staff ? `${inGroup("other").length} staff` : undefined} link={{ href: "/admin/staff", label: "Manage staff" }} />
      </div>

      <Panel title="By department">
        {staff === null ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <EmptyState icon="rupee" title="No staff records yet" text="Add doctors, nurses and other staff with their salaries to see the payroll." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="pb-2 font-medium">Department</th>
                  <th className="pb-2 text-right font-medium">Doctors</th>
                  <th className="pb-2 text-right font-medium">Nurses</th>
                  <th className="pb-2 text-right font-medium">Other staff</th>
                  <th className="pb-2 text-right font-medium">Monthly payroll</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.department}>
                    <td className="py-2.5 text-[#0f2f3a]">{r.department}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">{r.doctors}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">{r.nurses}</td>
                    <td className="py-2.5 text-right tabular-nums text-slate-600">{r.other}</td>
                    <td className="py-2.5 text-right font-[650] tabular-nums text-[#0f2f3a]">{fmtRupees(r.payroll)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200">
                  <td className="pt-2.5 font-[650] text-[#0f2f3a]">Total</td>
                  <td className="pt-2.5 text-right tabular-nums">{rows.reduce((n, r) => n + r.doctors, 0)}</td>
                  <td className="pt-2.5 text-right tabular-nums">{rows.reduce((n, r) => n + r.nurses, 0)}</td>
                  <td className="pt-2.5 text-right tabular-nums">{rows.reduce((n, r) => n + r.other, 0)}</td>
                  <td className="pt-2.5 text-right font-[650] tabular-nums text-[#0f2f3a]">{fmtRupees(total())}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>
    </RoleGuard>
  );
}
