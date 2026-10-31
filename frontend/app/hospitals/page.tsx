"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import LocationBadge from "@/components/LocationBadge";
import { api, errorMessage } from "@/lib/api";
import type { Hospital, LatLng, NearbyHospital } from "@/lib/types";

// Leaflet needs the browser, so skip server rendering for the map.
const HospitalMap = dynamic(() => import("@/components/HospitalMap"), {
  ssr: false,
  loading: () => <div className="flex h-[420px] items-center justify-center rounded-xl bg-slate-100 text-slate-500">Loading map…</div>,
});

type Mode = "near" | "city";
type City = { city: string; hospitals: number };
const RADII = [2, 5, 10, 25, 50];

export default function HospitalsPage() {
  const [mode, setMode] = useState<Mode>("near");
  const [user, setUser] = useState<LatLng | null>(null);
  const [radius, setRadius] = useState(10);
  const [cities, setCities] = useState<City[]>([]);
  const [city, setCity] = useState("");
  const [results, setResults] = useState<NearbyHospital[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    api<City[]>("/api/hospitals/cities/").then(setCities);
  }, []);

  function locate() {
    if (!navigator.geolocation) {
      setStatus("Your browser can't share location. Choose a city instead.");
      setMode("city");
      return;
    }
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUser({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStatus("");
      },
      () => {
        setStatus("Location permission was denied. You can still browse hospitals by city.");
        setMode("city");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  // Near me: ask PostGIS for hospitals inside the radius, nearest first.
  useEffect(() => {
    if (mode !== "near" || !user) return;
    setResults(null);
    api<{ results: NearbyHospital[] }>(`/api/hospitals/nearby/?lat=${user.lat}&lng=${user.lng}&radius_km=${radius}&limit=50`)
      .then((r) => setResults(r.results))
      .catch((e) => setStatus(errorMessage(e)));
  }, [mode, user, radius]);

  // By city: no location needed.
  useEffect(() => {
    if (mode !== "city" || !city) return;
    setResults(null);
    api<Hospital[]>(`/api/hospitals/?city=${encodeURIComponent(city)}`).then((r) =>
      setResults(r.map((h) => ({ ...h, distance_km: null, doctor_count: 0 }))),
    );
  }, [mode, city]);

  const tab = (m: Mode, label: string) => (
    <button
      onClick={() => {
        setMode(m);
        setResults(null);
        setStatus("");
      }}
      className={`rounded-md px-4 py-2 text-sm ${mode === m ? "bg-teal-600 text-white" : "border border-slate-300 bg-white"}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold">Hospitals near you</h1>
        <Link href="/hospitals/lookup" className="text-sm text-teal-700 underline">
          Can&apos;t find a hospital? Look it up from its website →
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {tab("near", "📍 Near me")}
        {tab("city", "🏙️ Browse by city")}

        {mode === "near" && (
          <>
            <button onClick={locate} className="rounded-md border border-teal-600 px-4 py-2 text-sm text-teal-700 hover:bg-teal-50">
              {user ? "Update my location" : "Use my location"}
            </button>
            <select className="input w-36" value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Search radius">
              {RADII.map((r) => <option key={r} value={r}>Within {r} km</option>)}
            </select>
          </>
        )}

        {mode === "city" && (
          <select className="input w-56" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City">
            <option value="">Choose a city…</option>
            {cities.map((c) => <option key={c.city} value={c.city}>{c.city} ({c.hospitals})</option>)}
          </select>
        )}
      </div>

      {status && <p role="status" className="mt-3 text-sm text-amber-700">{status}</p>}
      {mode === "near" && !user && !status && (
        <p className="mt-3 text-sm text-slate-600">Click “Use my location”. Your location is only used for this search and is not saved.</p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HospitalMap hospitals={results ?? []} user={mode === "near" ? user : null} radiusKm={mode === "near" ? radius : undefined} selectedId={selected} onSelect={setSelected} />
          <p className="mt-2 text-xs text-slate-500">Dashed pins are approximate locations that haven&apos;t been verified yet.</p>
        </div>

        <div className="lg:col-span-2">
          {results === null ? (
            <p className="text-slate-500">{(mode === "near" && user) || (mode === "city" && city) ? "Searching…" : "Results will appear here."}</p>
          ) : results.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
              No hospitals found{mode === "near" ? ` within ${radius} km. Try a bigger radius or browse by city.` : "."}
            </p>
          ) : (
            <ul className="max-h-[460px] space-y-3 overflow-y-auto pr-1">
              {results.map((h) => (
                <li
                  key={h.id}
                  onMouseEnter={() => setSelected(h.id)}
                  className={`rounded-xl border bg-white p-4 ${selected === h.id ? "border-amber-500" : "border-slate-200"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/hospitals/${h.id}`} className="font-semibold hover:text-teal-700">{h.name}</Link>
                    {h.distance_km != null && <span className="shrink-0 text-sm font-medium text-teal-700">{h.distance_km} km</span>}
                  </div>
                  <p className="text-sm text-slate-600">{[h.address, h.city].filter(Boolean).join(", ")}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <LocationBadge verified={h.location_verified} />
                    {mode === "near" && <span>{h.doctor_count} doctor{h.doctor_count === 1 ? "" : "s"}</span>}
                    {h.departments.slice(0, 3).map((d) => <span key={d.id}>· {d.name}</span>)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
