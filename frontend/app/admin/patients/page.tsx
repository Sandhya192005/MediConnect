"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, IconTile, Panel, SkeletonRows } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtMoney, isoDate, VISIT_STATUS, type HospitalPatient } from "@/lib/types";

/**
 * The hospital's Patient management (owner request 2026-11-21): every patient it added, plus everyone with a
 * visit here. Add patient (by patient ID, or a new patient), and open a patient to see and edit their details
 * and medical records — all in one place.
 */
export default function AdminPatientsPage() {
  const [rows, setRows] = useState<HospitalPatient[] | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
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
          <p className="page-subtitle text-sm">Every patient who visits your hospital: their details and medical records, in one place.</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn-solid rounded-xl px-4 py-2.5">
            <Icon name="user" className="h-4 w-4" /> Add patient
          </button>
        )}
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {adding && <AddPatient onClose={() => setAdding(false)} />}

      <Panel title={`Patients${rows ? ` (${rows.length})` : ""}`}>
        <input className="input mb-4 rounded-xl py-2" placeholder="Search by name, phone, email or patient ID" aria-label="Search patients"
               value={q} onChange={(e) => setQ(e.target.value)} />
        {rows === null ? (
          <SkeletonRows rows={4} />
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title={q ? "No patients match" : "No patients yet"}
                      text="Use “Add patient”, or patients appear here when they book a visit at your hospital." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((p) => (
              <li key={p.patient_id ?? p.name} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <IconTile icon="user" tone="teal" size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-[650] text-[#00295c]">
                      {p.name} <span className="ml-1 font-mono text-xs font-normal text-slate-500">{p.patient_id}</span>
                      {p.created_by_you && <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">Added by you</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500">{[p.phone, p.email ?? "No email"].filter(Boolean).join(" · ")}</p>
                  </div>
                </div>
                {/* Simple columns (owner requests 2026-11-22): Visit (editable inside), Visit status, our Records, Payment. */}
                <dl className="grid grid-cols-4 gap-4 text-xs md:w-[34rem]">
                  <div><dt className="text-slate-400">Visit</dt><dd className={p.visit_on ? "text-[#00295c]" : "text-slate-400"}>{p.visit_on ? fmtDate(p.visit_on) : "Not set"}</dd></div>
                  <div><dt className="text-slate-400">Visit status</dt>
                    <dd>{p.visit_status ? <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-[650] ring-1 ${VISIT_STATUS[p.visit_status].cls}`}>{VISIT_STATUS[p.visit_status].label}</span> : "—"}</dd></div>
                  <div><dt className="text-slate-400">Records</dt><dd className="font-[650] text-[#00295c]">{p.records}</dd></div>
                  <div><dt className="text-slate-400">Payment</dt>
                    <dd className={`font-[650] tabular-nums ${p.payment === "pending" ? "text-amber-800" : p.payment === "completed" ? "text-emerald-700" : "text-[#00295c]"}`}>
                      {p.payment === "pending" ? `Pending ${fmtMoney(p.pending_amount)}` : p.payment === "completed" ? "Completed" : "—"}
                    </dd></div>
                </dl>
                {/* Only Open here: editing is inside the patient's page (owner request 2026-11-22). */}
                {p.patient_id && (
                  <Link href={`/admin/patients/${p.patient_id}`} className="btn-outline shrink-0 px-3 py-1.5 text-xs" aria-label={`Open ${p.name}`}>
                    Open
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

/** Add a patient: someone already on MediConnect (by patient ID), or a new patient (no password, email optional). */
function AddPatient({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"id" | "new">("id");
  const [pid, setPid] = useState("");
  const [f, setF] = useState({ first_name: "", last_name: "", phone: "", email: "", date_of_birth: "", gender: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = mode === "id" ? { patient_id: pid.trim().toUpperCase() } : { ...f, date_of_birth: f.date_of_birth || null };
      const r = await api<{ patient_id: string; already: boolean }>("/api/hospital-admin/patients/add/", { method: "POST", body: JSON.stringify(body) });
      router.push(`/admin/patients/${r.patient_id}${r.already ? "" : "?added=1"}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const label = "block text-sm font-medium text-slate-700";
  return (
    <section aria-label="Add patient" className="dash-card mb-6 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-[650] text-[#00295c]">Add patient</h2>
        <div role="tablist" aria-label="How to add" className="inline-flex rounded-xl bg-slate-100 p-1">
          {([["id", "Has a patient ID"], ["new", "New patient"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => { setMode(k); setError(""); }}
                    className={`rounded-lg px-3 py-1.5 text-sm ${mode === k ? "bg-white font-[650] text-[#00295c] shadow-sm" : "text-slate-600"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        {mode === "id" ? (
          <>
            <p className="text-sm text-slate-500">The patient already uses MediConnect: their patient ID is on their profile (e.g. P483920).</p>
            <label className={`${label} sm:w-72`}>
              Patient ID
              <input className="input mt-1 font-mono uppercase" required maxLength={12} placeholder="e.g. P483920" value={pid} onChange={(e) => setPid(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              MediConnect gives the patient a patient ID. No password is needed: your hospital and doctors open their records with the ID.
              If you add an email, the patient can later sign in with &quot;Forgot password?&quot;.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className={label}>First name<input className="input mt-1" required maxLength={150} value={f.first_name} onChange={set("first_name")} /></label>
              <label className={label}>Last name<input className="input mt-1" maxLength={150} value={f.last_name} onChange={set("last_name")} /></label>
              <label className={label}>Phone<input className="input mt-1" required type="tel" maxLength={20} value={f.phone} onChange={set("phone")} /></label>
              <label className={label}>Email <span className="font-normal text-slate-400">(optional)</span><input className="input mt-1" type="email" value={f.email} onChange={set("email")} /></label>
              <label className={label}>Date of birth <span className="font-normal text-slate-400">(optional)</span><input className="input mt-1" type="date" max={isoDate(new Date())} value={f.date_of_birth} onChange={set("date_of_birth")} /></label>
              <label className={label}>
                Gender <span className="font-normal text-slate-400">(optional)</span>
                <select className="input mt-1" value={f.gender} onChange={set("gender")}>
                  <option value="">Prefer not to say</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>
          </>
        )}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Adding…" : mode === "id" ? "Add patient" : "Create patient"}</button>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </section>
  );
}
