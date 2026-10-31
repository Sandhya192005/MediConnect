"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import LocationBadge from "@/components/LocationBadge";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { LatLng, NearbyResponse } from "@/lib/types";

// Leaflet needs the browser, so skip server rendering for the map.
const HospitalMap = dynamic(() => import("@/components/HospitalMap"), {
  ssr: false,
  loading: () => <div className="flex h-[460px] items-center justify-center rounded-xl bg-slate-100 text-slate-500">Loading map…</div>,
});

type Mode = "near" | "city";
const RADII = [1, 2, 5, 10, 25];
const POPULAR_CITIES = ["Chennai", "Bengaluru", "Mumbai", "Coimbatore", "Madurai"];

export default function HospitalsPage() {
  const [mode, setMode] = useState<Mode>("near");
  const [user, setUser] = useState<LatLng | null>(null);
  const [radius, setRadius] = useState(5);
  const [cityInput, setCityInput] = useState("");
  const [city, setCity] = useState("");
  const [partnersOnly, setPartnersOnly] = useState(false);
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<NearbyResponse | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState("");
  const [tick, setTick] = useState(0); // re-fetch counter while OpenStreetMap results are arriving

  function locate() {
    if (!navigator.geolocation) {
      setStatus("Your browser can't share location. Search by city instead.");
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
        setStatus("Location permission was denied. You can still search hospitals by city.");
        setMode("city");
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }

  // Ask the backend for every hospital in the area (partners + OpenStreetMap).
  useEffect(() => {
    const qs = new URLSearchParams({ radius_km: String(radius), limit: "100", partners_only: String(partnersOnly) });
    let url = "";
    if (mode === "near" && user) url = `/api/hospitals/nearby/?lat=${user.lat}&lng=${user.lng}&${qs}`;
    if (mode === "city" && city) url = `/api/hospitals/city/?name=${encodeURIComponent(city)}&${qs}`;
    if (!url) return;
    let cancelled = false;
    api<NearbyResponse>(url)
      .then((r) => {
        if (cancelled) return;
        setData(r);
        setStatus("");
        // More hospitals are being downloaded in the background: check again in a few seconds.
        if (r.loading_more) setTimeout(() => !cancelled && setTick((t) => t + 1), 4000);
      })
      .catch((e) => !cancelled && setStatus(e instanceof ApiError ? errorMessage(e) : "Couldn't load hospitals."));
    return () => {
      cancelled = true;
    };
  }, [mode, user, city, radius, partnersOnly, tick]);

  const tab = (m: Mode, label: string) => (
    <button
      onClick={() => {
        setMode(m);
        setData(null);
        setStatus("");
      }}
      className={`rounded-md px-4 py-2 text-sm ${mode === m ? "bg-teal-600 text-white" : "border border-slate-300 bg-white"}`}
    >
      {label}
    </button>
  );

  const results = (data?.results ?? []).filter((h) => !filter || h.name.toLowerCase().includes(filter.toLowerCase()));
  const center = mode === "near" ? user : data?.place ? { lat: data.place.lat, lng: data.place.lng } : null;

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold">Hospitals</h1>
        <Link href="/hospitals/lookup" className="text-sm text-teal-700 underline">Can&apos;t find a hospital? Look it up from its website →</Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {tab("near", "📍 Near me")}
        {tab("city", "🏙️ Search a city")}
        {mode === "near" && (
          <button onClick={locate} className="rounded-md border border-teal-600 px-4 py-2 text-sm text-teal-700 hover:bg-teal-50">
            {user ? "Update my location" : "Use my location"}
          </button>
        )}
        {mode === "city" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setData(null);
              setCity(cityInput.trim());
            }}
            className="flex gap-2"
          >
            <input className="input w-56" value={cityInput} onChange={(e) => setCityInput(e.target.value)} placeholder="City or area, e.g. T. Nagar Chennai" aria-label="City" />
            <button className="rounded-md bg-teal-600 px-3 text-sm text-white" disabled={cityInput.trim().length < 2}>Search</button>
          </form>
        )}
        <select className="input w-32" value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Search radius">
          {RADII.map((r) => <option key={r} value={r}>Within {r} km</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={partnersOnly} onChange={(e) => setPartnersOnly(e.target.checked)} />
          Instant-booking partners only
        </label>
      </div>

      {mode === "city" && !city && (
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          {POPULAR_CITIES.map((c) => (
            <button key={c} onClick={() => { setCityInput(c); setCity(c); }} className="rounded-full border border-slate-300 bg-white px-3 py-1 hover:border-teal-500">{c}</button>
          ))}
        </div>
      )}
      {status && <p role="status" className="mt-3 text-sm text-amber-700">{status}</p>}
      {mode === "near" && !user && !status && (
        <p className="mt-3 text-sm text-slate-600">Click “Use my location”. Your location is only used for this search and is not saved.</p>
      )}
      {data?.loading_more && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-sky-800">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
          Loading all hospitals in this area from OpenStreetMap… (first time only, up to a minute)
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <HospitalMap hospitals={results} user={center} radiusKm={center ? radius : undefined} selectedId={selected} onSelect={setSelected} height={460} />
          <p className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-600" /> MediConnect partner (instant booking)</span>
            <span><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" /> Other hospitals (info from OpenStreetMap / their website)</span>
            <span>Dashed = approximate location</span>
          </p>
        </div>

        <div className="lg:col-span-2">
          {data && data.results.length > 0 && (
            <input className="input mb-3" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${data.count} hospitals by name…`} aria-label="Filter hospitals" />
          )}
          {data === null ? (
            <p className="text-slate-500">{(mode === "near" && user) || (mode === "city" && city) ? "Searching…" : "Results will appear here."}</p>
          ) : results.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
              {data.loading_more ? "Loading hospitals…" : `No hospitals found within ${radius} km. Try a bigger radius.`}
            </p>
          ) : (
            <ul className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
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
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {h.is_partner ? (
                      <span className="rounded-full bg-teal-50 px-2 py-0.5 text-teal-700">Partner · instant booking</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                        {h.scraped_at ? "Website info collected" : h.has_website ? "Website available" : "No website listed"}
                      </span>
                    )}
                    <LocationBadge verified={h.location_verified} />
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
