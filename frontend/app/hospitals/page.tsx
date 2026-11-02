"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import Icon from "@/components/Icons";
import LocationBadge from "@/components/LocationBadge";
import PageHeader from "@/components/PageHeader";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { LatLng, NearbyResponse } from "@/lib/types";

// Leaflet needs the browser, so skip server rendering for the map.
const HospitalMap = dynamic(() => import("@/components/HospitalMap"), {
  ssr: false,
  loading: () => <div className="flex h-[460px] animate-pulse items-center justify-center rounded-xl bg-slate-100 text-slate-500">Loading map…</div>,
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

  const tab = (m: Mode, label: string, icon: string) => (
    <button
      onClick={() => {
        setMode(m);
        setData(null);
        setStatus("");
      }}
      aria-pressed={mode === m}
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition ${mode === m ? "bg-white text-navy-800 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
    >
      <Icon name={icon} className="h-4 w-4" />
      {label}
    </button>
  );

  const results = (data?.results ?? []).filter((h) => !filter || h.name.toLowerCase().includes(filter.toLowerCase()));
  const center = mode === "near" ? user : data?.place ? { lat: data.place.lat, lng: data.place.lng } : null;

  return (
    <div className="space-y-5">
      <PageHeader icon="map" title="Hospitals" subtitle="Every hospital near you or in any city. Teal pins are MediConnect partners with instant booking.">
        <Link href="/hospitals/lookup" className="btn-outline">Can&apos;t find one? Look it up →</Link>
      </PageHeader>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {tab("near", "Near me", "pin")}
          {tab("city", "Search a city", "hospital")}
        </div>
        {mode === "near" && (
          <button onClick={locate} className="btn-solid">
            <Icon name="pin" className="h-4 w-4" />
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
            <button className="btn-solid" disabled={cityInput.trim().length < 2}>Search</button>
          </form>
        )}
        <select className="input w-36" value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Search radius">
          {RADII.map((r) => <option key={r} value={r}>Within {r} km</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-teal-600" checked={partnersOnly} onChange={(e) => setPartnersOnly(e.target.checked)} />
          Instant-booking partners only
        </label>
      </div>

      {mode === "city" && !city && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Popular:</span>
          {POPULAR_CITIES.map((c) => (
            <button key={c} onClick={() => { setCityInput(c); setCity(c); }} className="chip">{c}</button>
          ))}
        </div>
      )}
      {status && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{status}</p>}
      {mode === "near" && !user && !status && (
        <p className="text-sm text-slate-600">Click “Use my location”. Your location is only used for this search and is not saved.</p>
      )}
      {data?.loading_more && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
          Loading all hospitals in this area from OpenStreetMap… (first time only, up to a minute)
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="card overflow-hidden p-2">
          <HospitalMap hospitals={results} user={center} radiusKm={center ? radius : undefined} selectedId={selected} onSelect={setSelected} height={460} />
          </div>
          <p className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-600" /> MediConnect partner (instant booking)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" /> Other hospitals (info from OpenStreetMap / their website)</span>
            <span>Dashed = approximate location</span>
          </p>
        </div>

        <div className="lg:col-span-2">
          {data && data.results.length > 0 && (
            <input className="input mb-3" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Filter ${data.count} hospitals by name…`} aria-label="Filter hospitals" />
          )}
          {data === null ? (
            <p className="card p-5 text-slate-500">{(mode === "near" && user) || (mode === "city" && city) ? "Searching…" : "Results will appear here."}</p>
          ) : results.length === 0 ? (
            <p className="card p-5 text-sm text-slate-600">
              {data.loading_more ? "Loading hospitals…" : `No hospitals found within ${radius} km. Try a bigger radius.`}
            </p>
          ) : (
            <ul className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {results.map((h) => (
                <li
                  key={h.id}
                  onMouseEnter={() => setSelected(h.id)}
                  className={`card p-4 transition ${selected === h.id ? "border-teal-500 ring-2 ring-teal-100" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/hospitals/${h.id}`} className="font-semibold text-navy-800 hover:text-teal-700">{h.name}</Link>
                    {h.distance_km != null && <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{h.distance_km} km</span>}
                  </div>
                  <p className="text-sm text-slate-500">{[h.address, h.city].filter(Boolean).join(", ")}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {h.is_partner ? (
                      <span className="rounded-full bg-teal-50 px-2.5 py-0.5 font-semibold text-teal-800">Partner · instant booking</span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-600">
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
