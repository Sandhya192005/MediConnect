"use client";

import { useCallback, useEffect, useState } from "react";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import type { Department, Hospital } from "@/lib/types";

const EMPTY = { name: "", address: "", city: "", state: "", country: "India", phone: "", website: "", latitude: "", longitude: "" };

function HospitalsAdmin() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [deptIds, setDeptIds] = useState<number[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<Hospital[]>("/api/hospitals/").then(setHospitals);
  }, []);

  useEffect(() => {
    load();
    api<Department[]>("/api/departments/").then(setDepartments);
  }, [load]);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api("/api/hospitals/", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          latitude: form.latitude ? Number(form.latitude) : null,
          longitude: form.longitude ? Number(form.longitude) : null,
          department_ids: deptIds,
        }),
      });
      setForm(EMPTY);
      setDeptIds([]);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function toggleApproval(h: Hospital) {
    await api(`/api/hospitals/${h.id}/`, { method: "PATCH", body: JSON.stringify({ is_approved: !h.is_approved }) });
    load();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <form onSubmit={add} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
        <h2 className="font-semibold">Add hospital</h2>
        <input className="input" placeholder="Name" required value={form.name} onChange={set("name")} />
        <input className="input" placeholder="Address" value={form.address} onChange={set("address")} />
        <div className="grid grid-cols-2 gap-2">
          <input className="input" placeholder="City" required value={form.city} onChange={set("city")} />
          <input className="input" placeholder="State" value={form.state} onChange={set("state")} />
          <input className="input" placeholder="Country" value={form.country} onChange={set("country")} />
          <input className="input" placeholder="Phone" value={form.phone} onChange={set("phone")} />
          <input className="input" placeholder="Latitude" type="number" step="any" value={form.latitude} onChange={set("latitude")} />
          <input className="input" placeholder="Longitude" type="number" step="any" value={form.longitude} onChange={set("longitude")} />
        </div>
        <input className="input" placeholder="Website (https://…)" type="url" value={form.website} onChange={set("website")} />
        <fieldset className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {departments.map((d) => (
            <label key={d.id} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={deptIds.includes(d.id)}
                onChange={(e) => setDeptIds(e.target.checked ? [...deptIds, d.id] : deptIds.filter((x) => x !== d.id))}
              />
              {d.name}
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary">Add hospital</button>
      </form>

      <ul className="space-y-3 lg:col-span-3">
        {hospitals.map((h) => (
          <li key={h.id} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div>
              <p className="font-medium">{h.name}</p>
              <p className="text-sm text-slate-600">{[h.address, h.city, h.state].filter(Boolean).join(", ")}</p>
              <p className="text-xs text-slate-500">{h.departments.map((d) => d.name).join(" · ") || "No departments"}</p>
            </div>
            <button
              onClick={() => toggleApproval(h)}
              className={`shrink-0 rounded-md px-3 py-1 text-xs ${h.is_approved ? "bg-teal-100 text-teal-800" : "bg-amber-100 text-amber-800"}`}
            >
              {h.is_approved ? "Approved" : "Pending – approve"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AdminHospitalsPage() {
  return (
    <RoleGuard role="admin">
      <h1 className="mb-4 text-2xl font-bold">Hospitals</h1>
      <HospitalsAdmin />
    </RoleGuard>
  );
}
