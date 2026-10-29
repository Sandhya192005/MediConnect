"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Department, Doctor, Hospital } from "@/lib/types";

export default function DoctorsPage() {
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [hospital, setHospital] = useState("");

  useEffect(() => {
    api<Department[]>("/api/departments/").then(setDepartments);
    api<Hospital[]>("/api/hospitals/").then(setHospitals);
  }, []);

  // Re-fetch when filters change (small delay so typing doesn't spam the API).
  useEffect(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (department) params.set("department", department);
    if (hospital) params.set("hospital", hospital);
    const t = setTimeout(() => api<Doctor[]>(`/api/doctors/?${params}`).then(setDoctors), 250);
    return () => clearTimeout(t);
  }, [q, department, hospital]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Find a doctor</h1>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <input className="input" placeholder="Search name, specialty or hospital" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        <select className="input" value={hospital} onChange={(e) => setHospital(e.target.value)}>
          <option value="">All hospitals</option>
          {hospitals.map((h) => (
            <option key={h.id} value={h.id}>{h.name} ({h.city})</option>
          ))}
        </select>
      </div>

      {doctors === null ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : doctors.length === 0 ? (
        <p className="mt-6 text-slate-500">No doctors match your search.</p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {doctors.map((d) => (
            <Link key={d.id} href={`/doctors/${d.id}`} className="rounded-xl border border-slate-200 bg-white p-5 hover:border-teal-400 hover:shadow-sm">
              <h3 className="font-semibold">Dr. {d.name}</h3>
              <p className="text-sm text-teal-700">{d.specialization}</p>
              <p className="mt-2 text-sm text-slate-600">{d.hospital_name}, {d.hospital_city}</p>
              <p className="mt-1 text-sm text-slate-500">{d.experience_years} yrs experience · ₹{Number(d.fee).toFixed(0)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
