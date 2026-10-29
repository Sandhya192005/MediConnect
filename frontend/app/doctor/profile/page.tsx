"use client";

import { useEffect, useState } from "react";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import type { Department, Doctor, Hospital } from "@/lib/types";

const FIELDS = ["hospital", "department", "specialization", "qualification", "experience_years", "fee", "slot_minutes", "bio"] as const;
type Form = Record<(typeof FIELDS)[number], string>;

function ProfileForm() {
  const [form, setForm] = useState<Form | null>(null);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Hospital[]>("/api/hospitals/").then(setHospitals);
    api<Department[]>("/api/departments/").then(setDepartments);
    api<Doctor>("/api/doctors/me/").then((d) =>
      setForm(Object.fromEntries(FIELDS.map((f) => [f, d[f] == null ? "" : String(d[f])])) as Form),
    );
  }, []);

  if (!form) return <p className="text-slate-500">Loading…</p>;

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    setError("");
    try {
      await api("/api/doctors/me/", {
        method: "PATCH",
        body: JSON.stringify({
          ...form,
          hospital: form!.hospital ? Number(form!.hospital) : null,
          department: form!.department ? Number(form!.department) : null,
        }),
      });
      setMsg("Profile saved.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={save} className="max-w-xl space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <label className="block text-sm">
        Hospital
        <select className="input mt-1" value={form.hospital} onChange={set("hospital")}>
          <option value="">— Select —</option>
          {hospitals.map((h) => <option key={h.id} value={h.id}>{h.name} ({h.city})</option>)}
        </select>
      </label>
      <label className="block text-sm">
        Department
        <select className="input mt-1" value={form.department} onChange={set("department")}>
          <option value="">— Select —</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Specialization<input className="input mt-1" value={form.specialization} onChange={set("specialization")} /></label>
        <label className="block text-sm">Qualification<input className="input mt-1" value={form.qualification} onChange={set("qualification")} /></label>
        <label className="block text-sm">Experience (years)<input className="input mt-1" type="number" min={0} value={form.experience_years} onChange={set("experience_years")} /></label>
        <label className="block text-sm">Fee (₹)<input className="input mt-1" type="number" min={0} value={form.fee} onChange={set("fee")} /></label>
        <label className="block text-sm">
          Slot length
          <select className="input mt-1" value={form.slot_minutes} onChange={set("slot_minutes")}>
            {[10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm">About you<textarea className="input mt-1" rows={3} value={form.bio} onChange={set("bio")} /></label>
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary">Save profile</button>
    </form>
  );
}

export default function DoctorProfilePage() {
  return (
    <RoleGuard role="doctor">
      <h1 className="mb-4 text-2xl font-bold">My profile</h1>
      <p className="mb-4 text-sm text-slate-600">Patients can book you once a hospital is selected and your working hours are set.</p>
      <ProfileForm />
    </RoleGuard>
  );
}
