"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, IconTile, Panel, SkeletonRows } from "@/components/DashboardShell";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, type HospitalPatient } from "@/lib/types";

/** The hospital admin's patient list: everyone with a visit booked or done at this hospital. */
export default function AdminPatientsPage() {
  const [rows, setRows] = useState<HospitalPatient[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      const query = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      api<HospitalPatient[]>(`/api/hospital-admin/patients/${query}`).then(setRows).catch((e) => setError(errorMessage(e)));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <RoleGuard role="hospital">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Patient management</h1>
          <p className="page-subtitle text-sm">Patients with a visit booked or completed at your hospital. Open a patient to see their records.</p>
        </div>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <Panel title={`Patients${rows ? ` (${rows.length})` : ""}`}>
        <input className="input mb-4 rounded-xl py-2" placeholder="Search by name, email or patient ID" aria-label="Search patients"
               value={q} onChange={(e) => setQ(e.target.value)} />
        {rows === null ? (
          <SkeletonRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title={q ? "No patients match" : "No patients yet"} text="Patients appear here once they book a visit at your hospital." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => (
              <li key={p.patient_id ?? p.email} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <IconTile icon="user" tone="teal" size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-[650] text-[#00295c]">
                      {p.name} <span className="ml-1 font-mono text-xs font-normal text-slate-500">{p.patient_id}</span>
                    </p>
                    <p className="truncate text-xs text-slate-500">{[p.email, p.phone].filter(Boolean).join(" · ")}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-3 gap-4 text-xs md:w-[26rem]">
                  <div><dt className="text-slate-400">Visits</dt><dd className="font-[650] text-[#00295c]">{p.visits}</dd></div>
                  <div><dt className="text-slate-400">Last visit</dt><dd className="text-[#00295c]">{p.last_visit ? fmtDate(p.last_visit) : "—"}</dd></div>
                  <div><dt className="text-slate-400">Next visit</dt><dd className="text-[#00295c]">{p.next_visit ? fmtDate(p.next_visit) : "—"}</dd></div>
                </dl>
                {p.patient_id && (
                  <Link href={`/admin/patients/records?id=${p.patient_id}`} className="btn-outline shrink-0 px-3 py-1.5 text-xs" aria-label={`Records of ${p.name}`}>
                    Records ({p.records})
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </RoleGuard>
  );
}
