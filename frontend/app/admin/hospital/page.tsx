"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { IconTile, Panel, SkeletonRows } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import type { PinPoint } from "@/components/PinPicker";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { directionsUrl } from "@/lib/directions";
import type { Department, HospitalProfile } from "@/lib/types";

const HospitalMap = dynamic(() => import("@/components/HospitalMap"), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse rounded-xl bg-slate-100" />,
});
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
      <HospitalProfileScreen />
    </RoleGuard>
  );
}

/**
 * The profile opens read-only, like a professional profile (owner request 2026-11-24); "Edit profile" opens
 * the form, and saving goes back to the profile.
 */
function HospitalProfileScreen() {
  const [h, setH] = useState<HospitalProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<HospitalProfile>("/api/hospital-admin/profile/").then(setH).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (!h) return <>{error ? <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p> : <SkeletonRows rows={6} />}</>;
  if (editing) {
    return (
      <ProfileEditor initial={h} onCancel={() => setEditing(false)}
                     onSaved={(x) => { setH(x); setEditing(false); setFlash(x.connected ? "Saved. Patients see the new details now." : "Saved."); }} />
    );
  }
  return <ProfileView h={h} flash={flash} onEdit={() => { setFlash(""); setEditing(true); }} />;
}

function ProfileView({ h, flash, onEdit }: { h: HospitalProfile; flash: string; onEdit: () => void }) {
  const hasPin = h.latitude != null && h.longitude != null;
  const where = [h.address, h.city, h.state].filter(Boolean).join(", ");
  const website = h.website ? h.website.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Hospital profile</h1>
        <p className="page-subtitle text-sm">What patients see about your hospital on MediConnect.</p>
      </div>
      {flash && <p role="status" className="rounded-xl bg-green-50 px-4 py-2 text-sm text-green-800">{flash}</p>}

      {/* ---- Header card ---- */}
      <section aria-label="Hospital" className="dash-card overflow-hidden">
        <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-center">
          <span aria-hidden="true" className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#00295c] text-white">
            <Icon name="hospital" className="h-10 w-10" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold text-[#00295c]">{h.name}</h2>
              {h.connected ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-[650] text-emerald-700 ring-1 ring-emerald-200">Connected to MediConnect</span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-[650] text-amber-800 ring-1 ring-amber-200">Not connected yet</span>
              )}
            </div>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-slate-600">
              <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /> {where || "Address not added"}
            </p>
          </div>
          <button type="button" onClick={onEdit} className="btn-solid rounded-xl px-4 py-2 text-sm">
            <Icon name="pencil" className="h-4 w-4" /> Edit profile
          </button>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 text-center">
          <Fact label="Departments" value={String(h.departments.length)} />
          <Fact label="Map pin" value={hasPin ? "Set" : "Not set"} />
          <Fact label="Patients can book" value={h.connected ? "Yes" : "Not yet"} />
        </dl>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Contact" icon="phone">
          <Row k="Phone" v={h.phone} />
          <Row k="Website" v={website ? <a href={h.website} target="_blank" rel="noopener noreferrer" className="dash-link">{website} ↗</a> : ""} />
          <Row k="Login email" v={h.email} />
        </Section>
        <Section title="Address" icon="pin">
          <Row k="Street / area" v={h.address} />
          <Row k="City" v={h.city} />
          <Row k="State" v={h.state} />
        </Section>
      </div>

      <Section title="Departments" icon="stethoscope">
        {h.departments.length === 0 ? (
          <p className="py-1 text-sm text-slate-400">No departments chosen yet. Patients search hospitals by department.</p>
        ) : (
          <div className="flex flex-wrap gap-2 py-1">
            {h.departments.map((d) => <span key={d.id} className="chip">{d.name}</span>)}
          </div>
        )}
      </Section>

      <Section title="Location" icon="map">
        {hasPin ? (
          <div className="space-y-2 py-1">
            <div className="overflow-hidden rounded-xl">
              <HospitalMap hospitals={[{ id: h.id, name: h.name, address: h.address, city: h.city, latitude: h.latitude, longitude: h.longitude, location_verified: h.location_verified }]} height={240} />
            </div>
            <a href={directionsUrl(h.name, h)} target="_blank" rel="noopener noreferrer" className="dash-link text-sm">
              <Icon name="arrow" className="h-4 w-4 -rotate-45" /> Get directions (what patients see)
            </a>
          </div>
        ) : (
          <p className="py-1 text-sm text-slate-400">No pin yet: patients can&apos;t find you on the map. Use Edit profile to place it.</p>
        )}
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

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-4 py-2.5 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words text-[#00295c]">{v || <span className="text-slate-400">Not added</span>}</dd>
    </div>
  );
}

/** The edit form (details, departments, map pin). Saving goes back to the profile. */
function ProfileEditor({ initial, onCancel, onSaved }: { initial: HospitalProfile; onCancel: () => void; onSaved: (x: HospitalProfile) => void }) {
  const { refresh } = useAuth();
  const h = initial;
  const [f, setF] = useState<Form>(() => toForm(initial));
  const [departments, setDepartments] = useState<Department[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    api<Department[]>("/api/departments/").then(setDepartments).catch(() => {});
  }, []);

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
      if (x.name !== h.name) await refresh(); // the account name follows the hospital's name
      onSaved(x); // back to the profile view
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
          <h1 className="page-title">Edit hospital profile</h1>
          <p className="page-subtitle text-sm">
            {h.connected
              ? "Your hospital is connected: patients see these details as soon as you save."
              : "Patients will see these details once your hospital is connected with MediConnect."}
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
        </div>
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
