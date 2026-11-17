"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtRupees, isoDate, type Department, type DoctorAccount, type StaffKind, type StaffMember } from "@/lib/types";
import { EmptyState, IconTile, Panel, SkeletonRows } from "./DashboardShell";
import Icon from "./Icons";
import RoleGuard from "./RoleGuard";

const WORDS: Record<StaffKind, { one: string; many: string; icon: string; designation: string }> = {
  doctor: { one: "doctor", many: "Doctors", icon: "stethoscope", designation: "e.g. Senior Consultant" },
  nurse: { one: "nurse", many: "Nurses", icon: "nurse", designation: "e.g. Staff Nurse" },
};

type Status = "active" | "left" | "";

/** The hospital admin's list of doctors or nurses, with add / edit / remove (Step 4). */
export default function StaffManager({ kind }: { kind: StaffKind }) {
  const w = WORDS[kind];
  const [items, setItems] = useState<StaffMember[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [editing, setEditing] = useState<StaffMember | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ kind, ...(q.trim() && { q: q.trim() }), ...(status && { status }) });
    api<StaffMember[]>(`/api/hospital-admin/staff/?${params}`).then(setItems).catch((e) => setError(errorMessage(e)));
  }, [kind, q, status]);

  useEffect(() => {
    const t = setTimeout(load, 250); // wait for typing to pause
    return () => clearTimeout(t);
  }, [load]);

  async function remove(s: StaffMember) {
    if (!window.confirm(`Delete the staff record for ${s.full_name}? Use "Left on" instead to keep their history.`)) return;
    try {
      await api(`/api/hospital-admin/staff/${s.id}/`, { method: "DELETE" });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <RoleGuard role="admin">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">{w.many}</h1>
          <p className="page-subtitle text-sm">Your hospital&apos;s {w.many.toLowerCase()}: department, join date and salary. Only your hospital&apos;s admins can see this.</p>
        </div>
        <button onClick={() => setEditing("new")} className="btn-solid rounded-xl px-4 py-2.5">
          <Icon name="user" className="h-4 w-4" /> Add {w.one}
        </button>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {editing && (
        <StaffForm
          kind={kind}
          member={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <Panel title={`${w.many}${items ? ` (${items.length})` : ""}`}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input className="input rounded-xl py-2" placeholder="Search by name, designation or email" aria-label={`Search ${w.many.toLowerCase()}`}
                 value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input rounded-xl py-2 sm:w-56" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="active">Working here now</option>
            <option value="left">Left</option>
            <option value="">Everyone</option>
          </select>
        </div>
        {items === null ? (
          <SkeletonRows rows={4} />
        ) : items.length === 0 ? (
          <EmptyState icon={w.icon} title={q || status !== "active" ? `No ${w.many.toLowerCase()} match` : `No ${w.many.toLowerCase()} added yet`}
                      text={`Use "Add ${w.one}" to create the first record.`} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <IconTile icon={w.icon} tone={kind === "doctor" ? "blue" : "rose"} size="sm" />
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-[650] text-[#0f2f3a]">
                      {s.full_name}
                      {s.doctor && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700">MediConnect account</span>}
                      {!s.is_active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">{s.left_on ? `Left ${fmtDate(s.left_on)}` : "Not started yet"}</span>}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {[s.designation, s.department_name].filter(Boolean).join(" · ") || "No department"} · joined {fmtDate(s.join_date)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 md:justify-end">
                  <span className="text-sm font-[650] tabular-nums text-[#0f2f3a]" title="Monthly salary">{fmtRupees(s.monthly_salary)}<span className="text-xs font-normal text-slate-400">/month</span></span>
                  <button onClick={() => setEditing(s)} className="btn-outline px-3 py-1.5 text-xs" aria-label={`Edit ${s.full_name}`}>Edit</button>
                  <button onClick={() => remove(s)} className="btn border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50" aria-label={`Delete ${s.full_name}`}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </RoleGuard>
  );
}

function StaffForm({ kind, member, onClose, onSaved }: { kind: StaffKind; member: StaffMember | null; onClose: () => void; onSaved: () => void }) {
  const w = WORDS[kind];
  const [departments, setDepartments] = useState<Department[]>([]);
  const [accounts, setAccounts] = useState<DoctorAccount[]>([]);
  const [f, setF] = useState({
    full_name: member?.full_name ?? "",
    doctor: member?.doctor ? String(member.doctor) : "",
    department: member?.department ? String(member.department) : "",
    designation: member?.designation ?? "",
    phone: member?.phone ?? "",
    email: member?.email ?? "",
    join_date: member?.join_date ?? isoDate(new Date()),
    left_on: member?.left_on ?? "",
    monthly_salary: member ? String(Number(member.monthly_salary)) : "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Department[]>("/api/departments/").then(setDepartments).catch(() => {});
    if (kind === "doctor") api<DoctorAccount[]>("/api/hospital-admin/doctor-accounts/").then(setAccounts).catch(() => {});
  }, [kind]);

  const set = (key: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [key]: e.target.value });

  function pickAccount(e: React.ChangeEvent<HTMLSelectElement>) {
    const acc = accounts.find((a) => String(a.id) === e.target.value);
    setF({
      ...f,
      doctor: e.target.value,
      full_name: acc && !f.full_name ? acc.name : f.full_name,
      email: acc && !f.email ? acc.email : f.email,
      department: acc?.department && !f.department ? String(acc.department) : f.department,
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      kind,
      full_name: f.full_name,
      doctor: f.doctor ? Number(f.doctor) : null,
      department: f.department ? Number(f.department) : null,
      designation: f.designation,
      phone: f.phone,
      email: f.email,
      join_date: f.join_date,
      left_on: f.left_on || null,
      monthly_salary: f.monthly_salary,
    };
    try {
      await api(member ? `/api/hospital-admin/staff/${member.id}/` : "/api/hospital-admin/staff/", {
        method: member ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "block text-sm font-medium text-slate-700";
  return (
    <section aria-label={member ? `Edit ${member.full_name}` : `Add ${w.one}`} className="dash-card mb-6 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base text-[#0f2f3a]">{member ? `Edit ${member.full_name}` : `Add a ${w.one}`}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close form"><Icon name="close" className="h-4 w-4" /></button>
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kind === "doctor" && (
          <label className={`${label} sm:col-span-2 lg:col-span-3`}>
            MediConnect account <span className="font-normal text-slate-400">(optional: doctors who take bookings here)</span>
            <select className="input mt-1" value={f.doctor} onChange={pickAccount}>
              <option value="">No account: staff record only</option>
              {member?.doctor && <option value={member.doctor}>{member.full_name} ({member.doctor_email})</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
            </select>
          </label>
        )}
        <label className={label}>Full name<input className="input mt-1" value={f.full_name} onChange={set("full_name")} maxLength={150} required={!f.doctor} /></label>
        <label className={label}>
          Department
          <select className="input mt-1" value={f.department} onChange={set("department")}>
            <option value="">None</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className={label}>Designation<input className="input mt-1" value={f.designation} onChange={set("designation")} maxLength={100} placeholder={w.designation} /></label>
        <label className={label}>Join date<input className="input mt-1" type="date" value={f.join_date} onChange={set("join_date")} required /></label>
        <label className={label}>
          Monthly salary (₹)
          <input className="input mt-1" type="number" min={0} step="1" inputMode="numeric" value={f.monthly_salary} onChange={set("monthly_salary")} required />
        </label>
        {member && <label className={label}>Left on <span className="font-normal text-slate-400">(if they left)</span><input className="input mt-1" type="date" value={f.left_on} onChange={set("left_on")} /></label>}
        <label className={label}>Phone<input className="input mt-1" value={f.phone} onChange={set("phone")} maxLength={20} /></label>
        <label className={label}>Email<input className="input mt-1" type="email" value={f.email} onChange={set("email")} /></label>
        {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2 lg:col-span-3">{error}</p>}
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : member ? "Save changes" : `Add ${w.one}`}</button>
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2.5">Cancel</button>
        </div>
      </form>
    </section>
  );
}
