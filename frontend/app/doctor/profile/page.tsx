"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { IconTile } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import type { Department, Doctor, Hospital } from "@/lib/types";

/**
 * The doctor's "My hospital & profile" (owner request 2026-11-21: a professional look after editing).
 * Opens as a read-only profile, like the patient's Profile & settings; "Edit profile" shows the form,
 * and saving goes back to the profile.
 */

const FIELDS = ["hospital", "department", "specialization", "qualification", "experience_years", "fee", "slot_minutes", "bio"] as const;
type Form = Record<(typeof FIELDS)[number], string>;

const rupees = (v: string | number) => `₹${Math.round(Number(v)).toLocaleString("en-IN")}`;
const drName = (name: string) => (/^dr\.?\s/i.test(name) ? name : `Dr. ${name}`);

export default function DoctorProfilePage() {
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => api<Doctor>("/api/doctors/me/").then(setDoctor).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { load(); }, [load]);

  return (
    <RoleGuard role="doctor">
      <div className="mb-6">
        <h1 className="page-title">My hospital &amp; profile</h1>
        <p className="page-subtitle text-sm">{editing ? "Change your details, then save." : "What patients see on your page."}</p>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {!doctor ? (
        !error && <div className="dash-card h-64 animate-pulse bg-slate-100/60" />
      ) : editing ? (
        <EditProfile
          doctor={doctor}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            await load();
            setEditing(false);
            setFlash("Profile saved.");
            setTimeout(() => setFlash(""), 4000);
          }}
        />
      ) : (
        <ProfileView doctor={doctor} flash={flash} onEdit={() => { setFlash(""); setEditing(true); }} />
      )}
    </RoleGuard>
  );
}

// ---------------------------------------------------------------- view

function ProfileView({ doctor: d, flash, onEdit }: { doctor: Doctor; flash: string; onEdit: () => void }) {
  const initials = d.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "Dr";
  const todo = [
    !d.hospital && { text: "Choose your hospital", action: onEdit },
    d.availability.length === 0 && { text: "Set your working hours", href: "/doctor/availability" },
  ].filter(Boolean) as { text: string; action?: () => void; href?: string }[];

  return (
    <div className="max-w-4xl space-y-4">
      {flash && <p role="status" className="rounded-xl bg-teal-50 px-4 py-2 text-sm text-teal-800">{flash}</p>}

      {/* ---- Header card ---- */}
      <section aria-label="Profile" className="dash-card overflow-hidden">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <span aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#00295c] text-2xl font-[650] text-white">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-[#00295c]">{drName(d.name)}</h2>
              {d.is_bookable ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-[650] text-emerald-700 ring-1 ring-emerald-200">Accepting bookings</span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-[650] text-amber-800 ring-1 ring-amber-200">Not bookable yet</span>
              )}
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {[d.specialization, d.qualification].filter(Boolean).join(" · ") || "Add your specialization and qualification"}
            </p>
            {d.hospital_name && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
                <Icon name="hospital" className="h-4 w-4" /> {d.hospital_name}{d.hospital_city ? `, ${d.hospital_city}` : ""}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
            <button type="button" onClick={onEdit} className="btn-solid rounded-xl px-4 py-2 text-sm">
              <Icon name="pencil" className="h-4 w-4" /> Edit profile
            </button>
            {d.is_bookable && (
              <Link href={`/doctors/${d.id}`} className="btn-outline rounded-xl px-4 py-2 text-sm">View public page</Link>
            )}
          </div>
        </div>

        {/* Key facts */}
        <dl className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 text-center">
          <Fact label="Experience" value={d.experience_years ? `${d.experience_years} yr${d.experience_years === 1 ? "" : "s"}` : "—"} />
          <Fact label="Consultation fee" value={Number(d.fee) ? rupees(d.fee) : "—"} />
          <Fact label="Slot length" value={`${d.slot_minutes} min`} />
        </dl>
      </section>

      {/* What still stops patients from booking */}
      {!d.is_bookable && (
        <section aria-label="Before patients can book you" className="dash-card border-l-4 border-l-amber-400 p-5">
          <p className="font-[650] text-[#00295c]">Before patients can book you</p>
          {todo.length > 0 ? (
            <ul className="mt-2 space-y-1.5 text-sm">
              {todo.map((t) => (
                <li key={t.text} className="flex items-center gap-2 text-slate-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  {t.href ? <Link href={t.href} className="dash-link">{t.text}</Link>
                    : <button type="button" onClick={t.action} className="dash-link">{t.text}</button>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-600">Your hospital isn&apos;t connected to MediConnect yet. Patients can book you once it is.</p>
          )}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Hospital" icon="hospital">
          <Row k="Hospital" v={d.hospital_name ?? ""} />
          <Row k="City" v={d.hospital_city ?? ""} />
          <Row k="Department" v={d.department_name ?? ""} />
        </Section>
        <Section title="Practice details" icon="stethoscope">
          <Row k="Specialization" v={d.specialization} />
          <Row k="Qualification" v={d.qualification} />
          <Row k="Experience" v={d.experience_years ? `${d.experience_years} years` : ""} />
          <Row k="Consultation fee" v={Number(d.fee) ? rupees(d.fee) : ""} />
          <Row k="Slot length" v={`${d.slot_minutes} minutes per patient`} />
        </Section>
      </div>

      <Section title="About you" icon="user">
        <p className="whitespace-pre-line py-1 text-sm leading-relaxed text-slate-700">
          {d.bio || <span className="text-slate-400">Not added yet. A few lines about your experience help patients choose you.</span>}
        </p>
      </Section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-4">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-bold text-[#00295c]">{value}</dd>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="dash-card p-5">
      <div className="mb-2 flex items-center gap-3">
        <IconTile icon={icon} tone="blue" size="sm" />
        <h2 className="text-sm font-[650] text-[#00295c]">{title}</h2>
      </div>
      <dl className="divide-y divide-slate-100">{children}</dl>
    </section>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-4 py-2.5 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words text-[#00295c]">{v || <span className="text-slate-400">Not added</span>}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- edit

function EditProfile({ doctor, onCancel, onSaved }: { doctor: Doctor; onCancel: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<Form>(
    () => ({
      ...(Object.fromEntries(FIELDS.map((f) => [f, doctor[f] == null ? "" : String(doctor[f])])) as Form),
      fee: Number(doctor.fee) ? String(Number(doctor.fee)) : "", // "700.00" → "700"
    }),
  );
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Hospital[]>("/api/hospitals/").then(setHospitals).catch(() => {});
    api<Department[]>("/api/departments/").then(setDepartments).catch(() => {});
  }, []);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/doctors/me/", {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          hospital: form.hospital ? Number(form.hospital) : null,
          department: form.department ? Number(form.department) : null,
        }),
      });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "block text-sm font-medium text-slate-700";
  const legend = "mb-3 text-sm font-[650] text-[#00295c]";
  return (
    <section aria-label="Edit profile" className="dash-card max-w-4xl p-6">
      <form onSubmit={save} className="space-y-6">
        <fieldset>
          <legend className={legend}>Hospital</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              Hospital
              <select className="input mt-1" value={form.hospital} onChange={set("hospital")}>
                <option value="">— Select —</option>
                {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.city})</option>)}
              </select>
            </label>
            <label className={label}>
              Department
              <select className="input mt-1" value={form.department} onChange={set("department")}>
                <option value="">— Select —</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>
        </fieldset>

        <div className="border-t border-slate-100 pt-5"><fieldset>
          <legend className={legend}>Practice details</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>Specialization<input className="input mt-1" maxLength={120} placeholder="e.g. Cardiologist" value={form.specialization} onChange={set("specialization")} /></label>
            <label className={label}>Qualification<input className="input mt-1" maxLength={200} placeholder="e.g. MBBS, MD" value={form.qualification} onChange={set("qualification")} /></label>
            <label className={label}>Experience (years)<input className="input mt-1" type="number" min={0} value={form.experience_years} onChange={set("experience_years")} /></label>
            <label className={label}>Consultation fee (₹)<input className="input mt-1" type="number" min={0} value={form.fee} onChange={set("fee")} /></label>
            <label className={label}>
              Slot length
              <select className="input mt-1" value={form.slot_minutes} onChange={set("slot_minutes")}>
                {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </label>
          </div>
        </fieldset></div>

        <div className="border-t border-slate-100 pt-5"><fieldset>
          <legend className={legend}>About you</legend>
          <label className={label}>
            Shown on your public page
            <textarea className="input mt-1" rows={4} placeholder="Your experience, the conditions you treat, languages you speak…" value={form.bio} onChange={set("bio")} />
          </label>
        </fieldset></div>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </section>
  );
}
