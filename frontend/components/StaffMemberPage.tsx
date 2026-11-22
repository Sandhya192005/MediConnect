"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fmtDate, fmtRupees, type StaffMember } from "@/lib/types";
import { EmptyState, IconTile, SkeletonRows } from "./DashboardShell";
import DoctorAppointmentsPanel from "./DoctorAppointmentsPanel";
import Icon from "./Icons";
import RoleGuard from "./RoleGuard";
import { roleLine, StaffForm, WORDS, type StaffPage } from "./StaffManager";

const LIST: Record<StaffPage, string> = { doctor: "/admin/doctors", nurse: "/admin/nurses", other_staff: "/admin/staff" };

/** "2 years 3 months" between two dates (a person's time at the hospital). */
function tenure(from: string, to: Date) {
  const a = new Date(from);
  let months = (to.getFullYear() - a.getFullYear()) * 12 + (to.getMonth() - a.getMonth());
  if (to.getDate() < a.getDate()) months -= 1;
  if (months < 1) return "Less than a month";
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} year${y === 1 ? "" : "s"}`, m && `${m} month${m === 1 ? "" : "s"}`].filter(Boolean).join(" ");
}

/**
 * One doctor, nurse or staff member (owner request 2026-11-22: like Patient management, the list shows each
 * person with their department and "Open" shows all their details). Edit and Delete live here. A doctor with
 * a MediConnect account also shows their profile and their accepted / rejected appointments.
 */
export default function StaffMemberPage({ page }: { page: StaffPage }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const w = WORDS[page];
  const [s, setS] = useState<StaffMember | null>(null);
  const [state, setState] = useState<"loading" | "done" | "notfound">("loading");
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<StaffMember>(`/api/hospital-admin/staff/${id}/`)
      .then((m) => { setS(m); setState("done"); })
      .catch((e) => { if (e instanceof ApiError && e.status === 404) setState("notfound"); else setError(errorMessage(e)); });
  }, [id]);
  useEffect(load, [load]);

  async function remove() {
    if (!s || !window.confirm(`Delete the staff record for ${s.full_name}? Use "Left on" instead to keep their history.`)) return;
    try {
      await api(`/api/hospital-admin/staff/${s.id}/`, { method: "DELETE" });
      router.push(LIST[page]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const spec = s ? s.specialization || s.doctor_profile?.specialization || "" : "";
  const qual = s ? s.qualification || s.doctor_profile?.qualification || "" : "";

  return (
    <RoleGuard role="hospital">
      <Link href={LIST[page]} className="dash-link mb-3">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> {w.page}
      </Link>
      {flash && <p role="status" className="mb-4 rounded-xl bg-teal-50 px-4 py-2 text-sm text-teal-800">{flash}</p>}
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {state === "loading" && !error && <SkeletonRows rows={5} />}
      {state === "notfound" && <EmptyState icon={w.icon} title={`No ${w.one} with this record`} />}

      {state === "done" && s && (
        <div className="space-y-6">
          <section aria-label="Staff member" className="dash-card flex flex-wrap items-center gap-4 p-5">
            <IconTile icon={w.icon} tone={page === "doctor" ? "blue" : page === "nurse" ? "rose" : "indigo"} />
            <div className="min-w-0 flex-1">
              <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold text-[#00295c]">
                {s.full_name}
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-[650] ring-1 ${s.is_active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"}`}>
                  {s.is_active ? "Working here" : s.left_on ? `Left ${fmtDate(s.left_on)}` : "Not started yet"}
                </span>
              </h1>
              <p className="text-sm text-slate-600">{roleLine(s, page) || s.kind_label} · {s.department_name ?? "No department"}</p>
            </div>
            {!editing && (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setEditing(true); setFlash(""); }} className="btn-solid rounded-xl px-4 py-2 text-sm">
                  <Icon name="pencil" className="h-4 w-4" /> Edit
                </button>
                <button onClick={remove} className="btn border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50">Delete</button>
              </div>
            )}
          </section>

          {editing ? (
            <StaffForm kind={page} member={s} onClose={() => setEditing(false)}
                       onSaved={() => { setEditing(false); setFlash("Saved."); load(); }} />
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Details title="Work">
                <Row k="Role" v={s.kind_label} />
                <Row k={s.kind === "other" ? "Job title" : "Designation"} v={s.designation} />
                <Row k="Department" v={s.department_name ?? ""} />
                <Row k="Specialization" v={spec} />
                <Row k="Qualification" v={qual} />
                <Row k="Joined" v={fmtDate(s.join_date)} />
                <Row k="Left on" v={s.left_on ? fmtDate(s.left_on) : s.is_active ? "Still working here" : ""} />
                <Row k="Time here" v={tenure(s.join_date, s.left_on ? new Date(s.left_on) : new Date())} />
              </Details>
              <Details title="Contact and salary">
                <Row k="Contact number" v={s.phone} />
                <Row k="Email" v={s.email} />
                <Row k="Monthly salary" v={`${fmtRupees(s.monthly_salary)} / month`} />
                <Row k="Yearly salary" v={fmtRupees(Number(s.monthly_salary) * 12)} />
                {page === "doctor" && <Row k="MediConnect account" v={s.doctor_email ?? "None (staff record only)"} />}
              </Details>
            </div>
          )}

          {s.doctor_profile && !editing && (
            <>
              <Details title="MediConnect doctor profile">
                <Row k="Specialization" v={s.doctor_profile.specialization} />
                <Row k="Qualification" v={s.doctor_profile.qualification} />
                <Row k="Experience" v={s.doctor_profile.experience_years ? `${s.doctor_profile.experience_years} years` : ""} />
                <Row k="Consultation fee" v={Number(s.doctor_profile.fee) ? fmtRupees(s.doctor_profile.fee) : ""} />
                <Row k="Slot length" v={`${s.doctor_profile.slot_minutes} minutes`} />
                <Row k="Patients can book" v={s.doctor_profile.is_bookable ? "Yes" : "Not yet"} />
              </Details>
              <section aria-label="Appointments">
                <h2 className="section-title mb-3">Appointments</h2>
                <DoctorAppointmentsPanel doctorId={s.doctor_profile.id} />
              </section>
            </>
          )}
        </div>
      )}
    </RoleGuard>
  );
}

function Details({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="dash-card px-5 py-4">
      <h2 className="mb-2 text-xs font-[650] uppercase tracking-wider text-slate-500">{title}</h2>
      <dl className="divide-y divide-slate-100">{children}</dl>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-4 py-2.5 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words text-[#00295c]">{v || <span className="text-slate-400">Not added</span>}</dd>
    </div>
  );
}
