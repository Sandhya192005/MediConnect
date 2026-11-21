"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Panel, SkeletonRows } from "@/components/DashboardShell";
import type { PinPoint } from "@/components/PinPicker";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Department, HospitalProfile } from "@/lib/types";

const PinPicker = dynamic(() => import("@/components/PinPicker"), {
  ssr: false,
  loading: () => <div className="h-[320px] animate-pulse rounded-xl bg-slate-100" />,
});

const TEXT = ["name", "address", "city", "state", "phone", "website"] as const;
type Form = Record<(typeof TEXT)[number], string> & { department_ids: number[]; pin: PinPoint | null };
const label = "block text-sm font-medium text-slate-700";

const toForm = (h: HospitalProfile): Form => ({
  name: h.name, address: h.address, city: h.city, state: h.state, phone: h.phone, website: h.website,
  department_ids: h.departments.map((d) => d.id),
  pin: h.latitude != null && h.longitude != null ? { lat: h.latitude, lng: h.longitude } : null,
});

/**
 * Hospital profile (owner request 2026-11-20): the hospital edits its own details, departments and map pin.
 * Changes apply at once (also when connected); the pin it sets counts as confirmed, so patients'
 * "Get directions" goes straight to it. The hospital email is the login and can't be changed here.
 */
export default function HospitalProfilePage() {
  return (
    <RoleGuard role="hospital">
      <ProfileEditor />
    </RoleGuard>
  );
}

function ProfileEditor() {
  const { refresh } = useAuth();
  const [h, setH] = useState<HospitalProfile | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    api<HospitalProfile>("/api/hospital-admin/profile/").then((x) => { setH(x); setF(toForm(x)); }).catch((e) => setError(errorMessage(e)));
    api<Department[]>("/api/departments/").then(setDepartments).catch(() => {});
  }, []);

  if (!f || !h) return <>{error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : <SkeletonRows rows={6} />}</>;

  const set = (k: (typeof TEXT)[number]) => (e: React.ChangeEvent<HTMLInputElement>) => { setF({ ...f, [k]: e.target.value }); setSaved(""); };
  const setPin = (pin: PinPoint | null) => { setF({ ...f, pin }); setSaved(""); };
  const toggleDept = (id: number) => {
    setF({ ...f, department_ids: f.department_ids.includes(id) ? f.department_ids.filter((x) => x !== id) : [...f.department_ids, id] });
    setSaved("");
  };

  function locateMe() {
    setError("");
    if (!navigator.geolocation) return setError("This browser can't share its location. Click the map instead.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setLocating(false); setPin({ lat: p.coords.latitude, lng: p.coords.longitude }); },
      () => { setLocating(false); setError("Couldn't get your location. Click your hospital on the map instead."); },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const body = {
        ...Object.fromEntries(TEXT.map((k) => [k, f![k]])),
        department_ids: f!.department_ids,
        latitude: f!.pin ? Number(f!.pin.lat.toFixed(6)) : null,
        longitude: f!.pin ? Number(f!.pin.lng.toFixed(6)) : null,
      };
      const x = await api<HospitalProfile>("/api/hospital-admin/profile/", { method: "PATCH", body: JSON.stringify(body) });
      setH(x);
      setF(toForm(x));
      setSaved(x.connected ? "Saved. Patients see the new details now." : "Saved.");
      if (x.name !== h!.name) await refresh(); // the account name follows the hospital's name
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Hospital profile</h1>
          <p className="page-subtitle text-sm">
            {h.connected
              ? "Your hospital is connected: patients see these details as soon as you save."
              : "Patients will see these details once your hospital is connected with MediConnect."}
          </p>
        </div>
        <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {saved && <p role="status" className="rounded-xl bg-green-50 px-4 py-2 text-sm text-green-800">{saved}</p>}

      <Panel title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>Hospital name
            <input className="input mt-1" required minLength={2} maxLength={200} value={f.name} onChange={set("name")} />
          </label>
          <label className={`${label} sm:col-span-2`}>Address
            <input className="input mt-1" maxLength={300} required={h.connected} placeholder="Street, area" value={f.address} onChange={set("address")} />
          </label>
          <label className={label}>City
            <input className="input mt-1" required maxLength={100} value={f.city} onChange={set("city")} />
          </label>
          <label className={label}>State
            <input className="input mt-1" maxLength={100} value={f.state} onChange={set("state")} />
          </label>
          <label className={label}>Phone
            <input className="input mt-1" type="tel" maxLength={30} required={h.connected} value={f.phone} onChange={set("phone")} />
          </label>
          <label className={label}>Website
            <input className="input mt-1" type="url" maxLength={200} placeholder="https://" value={f.website} onChange={set("website")} />
          </label>
          <div className="sm:col-span-2">
            <p className={label}>Hospital email (login)</p>
            <p className="mt-1 text-sm text-slate-600">{h.email || "—"} · to change it, contact support.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Departments">
        <p className="-mt-2 mb-3 text-xs text-slate-500">Tick the departments your hospital has. Patients search by these.</p>
        {departments.length === 0 ? (
          <p className="text-sm text-slate-500">No departments on MediConnect yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {departments.map((d) => {
              const on = f.department_ids.includes(d.id);
              return (
                <label key={d.id} className={`cursor-pointer ${on ? "chip chip-active" : "chip"}`}>
                  <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleDept(d.id)} />
                  {d.name}
                </label>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Location on the map">
        <p className="-mt-2 mb-3 text-sm text-slate-600">
          Click your hospital&apos;s entrance on the map. Patients&apos; &ldquo;Get directions&rdquo; takes them to this exact pin.
        </p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={locateMe} className="btn-outline px-3 py-1.5 text-sm" disabled={locating}>
            {locating ? "Finding you…" : "Use my current location"}
          </button>
          {f.pin && (
            <button type="button" onClick={() => setPin(null)} className="btn-ghost px-3 py-1.5 text-sm">Remove pin</button>
          )}
          <span className="text-xs text-slate-500" aria-live="polite">
            {f.pin ? `Pin: ${f.pin.lat.toFixed(5)}, ${f.pin.lng.toFixed(5)}` : "No pin yet: patients can't find you on the map."}
          </span>
        </div>
        <div role="region" aria-label="Map: click to place your hospital's pin" className="overflow-hidden rounded-xl">
          <PinPicker pin={f.pin} onPick={setPin} />
        </div>
        <p className="mt-2 text-xs text-slate-500">Remember to press Save changes after moving the pin.</p>
      </Panel>
    </form>
  );
}
