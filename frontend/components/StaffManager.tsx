"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, isoDate, OTHER_STAFF_KINDS, type Department, type DoctorAccount, type OtherStaffKind, type StaffKind, type StaffMember } from "@/lib/types";
import { EmptyState, IconTile, Panel, SkeletonRows } from "./DashboardShell";
import Icon from "./Icons";
import RoleGuard from "./RoleGuard";

/** The three staff pages: Doctors, Nurses and Other staff (every other kind, e.g. pharmacists). */
export type StaffPage = "doctor" | "nurse" | "other_staff";

// page = the heading, matching the sidebar (owner request 2026-11-18); many = the list's title.
export const WORDS: Record<StaffPage, { page: string; one: string; many: string; icon: string; designation: string }> = {
  doctor: { page: "Doctor management", one: "doctor", many: "Doctors", icon: "stethoscope", designation: "e.g. Senior Consultant" },
  nurse: { page: "Nurse management", one: "nurse", many: "Nurses", icon: "nurse", designation: "e.g. Staff Nurse" },
  other_staff: { page: "Staff management", one: "staff member", many: "Other staff", icon: "user", designation: "e.g. Senior Pharmacist" },
};
const ROLES = Object.entries(OTHER_STAFF_KINDS) as [OtherStaffKind, string][];

type Status = "active" | "left" | "";

/** Where a staff member's own page is (owner request 2026-11-22: Open, like Patient management). */
export function staffHref(page: StaffPage, id: number) {
  return page === "doctor" ? `/admin/doctors/staff/${id}` : page === "nurse" ? `/admin/nurses/${id}` : `/admin/staff/${id}`;
}

/** What a person does, without repeating the role ("Pharmacist · Pharmacist"); falls back to a linked doctor's specialization. */
export function roleLine(s: StaffMember, page: StaffPage) {
  const spec = s.specialization || s.doctor_profile?.specialization || "";
  return [
    page === "other_staff" && s.kind_label,
    !(page === "other_staff" && s.designation.trim().toLowerCase() === s.kind_label.toLowerCase()) && s.designation,
    spec,
  ].filter(Boolean).join(" · ");
}

/** The hospital admin's list of doctors, nurses or other staff, with add / edit / remove (Step 4). */
export default function StaffManager({ kind }: { kind: StaffPage }) {
  const w = WORDS[kind];
  const [role, setRole] = useState<OtherStaffKind | "">(""); // Other staff: one role or all
  const [items, setItems] = useState<StaffMember[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<Status>("active");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    const params = new URLSearchParams({ kind: role || kind, ...(q.trim() && { q: q.trim() }), ...(status && { status }) });
    api<StaffMember[]>(`/api/hospital-admin/staff/?${params}`).then(setItems).catch((e) => setError(errorMessage(e)));
  }, [kind, role, q, status]);

  useEffect(() => {
    const t = setTimeout(load, 250); // wait for typing to pause
    return () => clearTimeout(t);
  }, [load]);

  return (
    <RoleGuard role="hospital">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">{w.page}</h1>
          <p className="page-subtitle text-sm">
            {kind === "other_staff"
              ? "Lab technicians, pharmacists, receptionists, office, housekeeping, security and others"
              : `Your hospital's ${w.many.toLowerCase()}`}
            : department, join date and salary. Only your hospital&apos;s admins can see this.
          </p>
        </div>
        <button onClick={() => setAdding(true)} className="btn-solid rounded-xl px-4 py-2.5">
          <Icon name="user" className="h-4 w-4" /> Add {w.one}
        </button>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {adding && (
        <StaffForm
          kind={kind}
          member={null}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      {kind === "doctor" && <DoctorAccountsNotOnStaff />}

      <Panel title={`${w.many}${items ? ` (${items.length})` : ""}`}>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input className="input rounded-xl py-2" placeholder="Search by name, department, specialization, phone or email" aria-label={`Search ${w.many.toLowerCase()}`}
                 value={q} onChange={(e) => setQ(e.target.value)} />
          {kind === "other_staff" && (
            <select className="input rounded-xl py-2 sm:w-56" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as OtherStaffKind | "")}>
              <option value="">All roles</option>
              {ROLES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          )}
          <select className="input rounded-xl py-2 sm:w-56" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="active">Working here now</option>
            <option value="left">Left</option>
            <option value="">Everyone</option>
          </select>
        </div>
        {items === null ? (
          <SkeletonRows rows={4} />
        ) : items.length === 0 ? (
          <EmptyState icon={w.icon} title={q || role || status !== "active" ? `No ${w.many.toLowerCase()} match` : `No ${w.many.toLowerCase()} added yet`}
                      text={`Use "Add ${w.one}" to create the first record.`} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((s) => (
              // Name, role, department and working status only (owner requests 2026-11-22), laid out in columns like
              // Patient management; everything else is inside Open.
              <li key={s.id} aria-label={s.full_name} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <IconTile icon={w.icon} tone={kind === "doctor" ? "blue" : kind === "nurse" ? "rose" : "indigo"} size="sm" />
                  <p className="truncate text-sm font-[650] text-[#00295c]">{s.full_name}</p>
                </div>
                <dl className="grid grid-cols-3 gap-4 text-xs md:w-[30rem]">
                  <div><dt className="text-slate-400">Role</dt>
                    <dd className="font-[650] text-[#00295c]" data-testid="staff-role">{s.kind === "other" && s.designation ? s.designation : s.kind_label}</dd></div>
                  <div><dt className="text-slate-400">Department</dt>
                    <dd className={s.department_name ? "text-[#00295c]" : "text-slate-400"}>{s.department_name ?? "None"}</dd></div>
                  <div><dt className="text-slate-400">Status</dt>
                    <dd><span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-[650] ring-1 ${s.is_active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"}`}>
                      {s.is_active ? "Working here" : s.left_on ? `Left ${fmtDate(s.left_on)}` : "Not started yet"}
                    </span></dd></div>
                </dl>
                <Link href={staffHref(kind, s.id)} className="btn-outline shrink-0 self-start px-3 py-1.5 text-xs md:self-auto" aria-label={`Open ${s.full_name}`}>Open</Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </RoleGuard>
  );
}

export function StaffForm({ kind, member, onClose, onSaved }: { kind: StaffPage; member: StaffMember | null; onClose: () => void; onSaved: () => void }) {
  const w = WORDS[kind];
  // On the Other staff page the admin picks the role; on the other pages it's fixed.
  const [staffKind, setStaffKind] = useState<StaffKind | "">(member?.kind ?? (kind === "other_staff" ? "" : kind));
  const [departments, setDepartments] = useState<Department[]>([]);
  const [accounts, setAccounts] = useState<DoctorAccount[]>([]);
  const [f, setF] = useState({
    full_name: member?.full_name ?? "",
    doctor: member?.doctor ? String(member.doctor) : "",
    department: member?.department ? String(member.department) : "",
    designation: member?.designation ?? "",
    specialization: member?.specialization ?? "",
    qualification: member?.qualification ?? "",
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
      kind: staffKind,
      full_name: f.full_name,
      doctor: f.doctor ? Number(f.doctor) : null,
      department: f.department ? Number(f.department) : null,
      designation: f.designation,
      specialization: f.specialization,
      qualification: f.qualification,
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
        <h2 className="text-base text-[#00295c]">{member ? `Edit ${member.full_name}` : `Add a ${w.one}`}</h2>
        <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Close form"><Icon name="close" className="h-4 w-4" /></button>
      </div>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kind === "doctor" && (
          <label className={`${label} sm:col-span-2 lg:col-span-3`}>
            MediConnect account <span className="font-normal text-slate-400">(optional: doctors who have a MediConnect account)</span>
            <select className="input mt-1" value={f.doctor} onChange={pickAccount}>
              <option value="">No account: staff record only</option>
              {member?.doctor && <option value={member.doctor}>{member.full_name} ({member.doctor_email})</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
            </select>
          </label>
        )}
        {kind === "other_staff" && (
          <label className={label}>
            Role
            <select className="input mt-1" required value={staffKind} onChange={(e) => setStaffKind(e.target.value as StaffKind)}>
              <option value="" disabled>Choose a role</option>
              {ROLES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
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
        <label className={label}>
          {staffKind === "other" ? "Job title" : "Designation"}
          <input className="input mt-1" value={f.designation} onChange={set("designation")} maxLength={100} required={staffKind === "other"}
                 placeholder={staffKind === "other" ? "e.g. Ambulance driver" : w.designation} />
        </label>
        <label className={label}>
          Specialization <span className="font-normal text-slate-400">(optional)</span>
          <input className="input mt-1" value={f.specialization} onChange={set("specialization")} maxLength={120}
                 placeholder={kind === "doctor" ? "e.g. Cardiology" : kind === "nurse" ? "e.g. ICU nursing" : "e.g. Radiology"} />
        </label>
        <label className={label}>
          Qualification <span className="font-normal text-slate-400">(optional)</span>
          <input className="input mt-1" value={f.qualification} onChange={set("qualification")} maxLength={200}
                 placeholder={kind === "doctor" ? "e.g. MBBS, MD" : kind === "nurse" ? "e.g. B.Sc Nursing" : "e.g. Diploma in Pharmacy"} />
        </label>
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

/**
 * Doctors who chose this hospital in their MediConnect profile but aren't in the staff list yet (owner
 * question 2026-11-21: "where can I see the doctor?"). Their appointments page works already.
 */
function DoctorAccountsNotOnStaff() {
  const [accounts, setAccounts] = useState<DoctorAccount[]>([]);
  useEffect(() => {
    api<DoctorAccount[]>("/api/hospital-admin/doctor-accounts/").then(setAccounts).catch(() => {});
  }, []);
  if (accounts.length === 0) return null;
  return (
    <section aria-label="Doctor accounts not on your staff list" className="dash-card mb-6 border-l-4 border-l-amber-400 p-5">
      <p className="font-[650] text-[#00295c]">Doctors on MediConnect at your hospital, not on your staff list yet</p>
      <p className="text-sm text-slate-500">They chose your hospital in their profile. Use &quot;Add doctor&quot; and pick their MediConnect account to add them.</p>
      <ul className="mt-3 divide-y divide-slate-100">
        {accounts.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span><span className="font-[650] text-[#00295c]">{d.name}</span> <span className="text-slate-500">· {d.specialization || "No specialization"} · {d.email}</span></span>
            <Link href={`/admin/doctors/${d.id}`} className="btn-ghost px-3 py-1.5 text-xs" aria-label={`Appointments of ${d.name}`}>Appointments</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
