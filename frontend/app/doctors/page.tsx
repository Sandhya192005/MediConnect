"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import HospitalRow, { type HospitalRowData } from "@/components/HospitalRow";
import Icon from "@/components/Icons";
import PageHeader, { Avatar } from "@/components/PageHeader";
import SearchBox from "@/components/SearchBox";
import { api, errorMessage } from "@/lib/api";
import type { LatLng, NearbyResponse } from "@/lib/types";

// Leaflet needs the browser: load the map only there, and only when "Show map" is pressed.
const HospitalMap = dynamic(() => import("@/components/HospitalMap"), {
  ssr: false,
  loading: () => <div className="h-[380px] animate-pulse rounded-xl bg-slate-100" />,
});
const RADII = [2, 5, 10, 25];

type Facet = { value: string; count: number };

/** A MediConnect (partner) hospital: instant booking with its own specialists. */
type PartnerHospital = {
  id: number;
  name: string;
  address: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  location_verified: boolean;
  doctor_count: number;
  specialties: { name: string; count: number }[];
  matching_doctors: { id: number; name: string; specialization: string; department: string; fee: number }[];
};

type PartnerResponse = {
  total: number;
  degraded: boolean;
  results: PartnerHospital[];
  facets: { departments: Facet[]; cities: Facet[] };
};

/** A hospital from the search index (GET /api/search/?type=hospitals). */
type HospitalHit = {
  id: number;
  name: string;
  address: string;
  city: string;
  departments: string[];
  is_partner?: boolean;
  location: { lat: number; lon: number } | null;
};

const fromHit = (h: HospitalHit): HospitalRowData => ({
  id: h.id, name: h.name, address: h.address, city: h.city, departments: h.departments ?? [], is_partner: !!h.is_partner,
  latitude: h.location?.lat ?? null, longitude: h.location?.lon ?? null,
});

const fromNearby = (r: NearbyResponse): HospitalRowData[] =>
  r.results.map((h) => ({
    id: h.id, name: h.name, address: h.address, city: h.city, departments: (h.departments ?? []).map((d) => d.name),
    is_partner: h.is_partner, distance_km: h.distance_km, location_verified: h.location_verified,
    latitude: h.latitude, longitude: h.longitude,
  }));

type ListedDoctor = {
  id: number;
  name: string;
  specialization: string;
  timings: string;
  hospital_id: number;
  hospital_name: string;
  hospital_city: string;
};

const FEE_OPTIONS = [
  { label: "Any fee", value: "" },
  { label: "Up to ₹500", value: "500" },
  { label: "Up to ₹800", value: "800" },
  { label: "Up to ₹1000", value: "1000" },
];

function Chips({ title, items, active, onPick }: { title: string; items: Facet[]; active: string; onPick: (v: string) => void }) {
  if (items.length === 0 && !active) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span>
      {active && (
        <button onClick={() => onPick("")} className="chip-active">
          {active} <Icon name="close" className="h-3 w-3" />
        </button>
      )}
      {!active &&
        items.map((f) => (
          <button key={f.value} onClick={() => onPick(f.value)} className="chip">
            {f.value} <span className="text-slate-400">{f.count}</span>
          </button>
        ))}
    </div>
  );
}

function PartnerCard({ h, department, selected }: { h: PartnerHospital; department: string; selected: boolean }) {
  // Open the hospital on the specialty the patient was looking for.
  const focus = department || h.matching_doctors[0]?.department || "";
  const href = `/hospitals/${h.id}${focus ? `?specialty=${encodeURIComponent(focus)}` : ""}`;
  return (
    <article id={`hospital-${h.id}`} aria-label={h.name} className={`card-hover flex scroll-mt-24 flex-col overflow-hidden ${selected ? "ring-2 ring-amber-400" : ""}`}>
      <div className="bg-brand-gradient h-1.5" />
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
            <Icon name="hospital" />
          </span>
          <div className="min-w-0 flex-1">
            <Link href={href} className="font-semibold text-navy-800 hover:text-teal-700">{h.name}</Link>
            <p className="flex items-center gap-1 truncate text-sm text-slate-500">
              <Icon name="pin" className="h-3.5 w-3.5 shrink-0" />
              {[h.address, h.city].filter(Boolean).join(", ")}
            </p>
          </div>
        </div>
        <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
          <Icon name="check" className="h-3 w-3" /> Instant booking
        </span>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {h.doctor_count} specialist{h.doctor_count === 1 ? "" : "s"}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {h.specialties.map((s) => (
            <Link key={s.name} href={`/hospitals/${h.id}?specialty=${encodeURIComponent(s.name)}`} className="chip">
              {s.name}{s.count > 1 ? ` · ${s.count}` : ""}
            </Link>
          ))}
        </div>

        {h.matching_doctors.length > 0 && (
          <div className="mt-4 rounded-xl bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">Matching specialists</p>
            <ul className="mt-2 space-y-2 text-sm">
              {h.matching_doctors.slice(0, 3).map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <Avatar name={d.name} size="sm" />
                  <span className="min-w-0">
                    <Link href={`/doctors/${d.id}`} className="font-medium text-navy-800 hover:text-teal-700">Dr. {d.name}</Link>
                    <span className="block truncate text-xs text-slate-500">{d.specialization} · ₹{d.fee.toFixed(0)}</span>
                  </span>
                </li>
              ))}
              {h.matching_doctors.length > 3 && <li className="text-xs text-slate-500">+{h.matching_doctors.length - 3} more</li>}
            </ul>
          </div>
        )}

        <div className="mt-auto pt-5">
          <Link href={href} className="btn-solid w-full">
            View specialists & book <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </article>
  );
}

/**
 * Book appointment (owner requests 2026-11-18): the one place where patients find a hospital and book.
 * - Search a hospital, doctor, specialty or area; filter by specialty, city, fee, "Instant booking only".
 * - MediConnect hospitals first (book instantly), then every other hospital (request an appointment).
 * - Near me: hospitals around the patient, nearest first (location asked only when pressed).
 * - Show map: the hospitals in the list on a map, with the patient in the middle; a pin highlights its card.
 */
export default function BookPage() {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [city, setCity] = useState("");
  const [maxFee, setMaxFee] = useState("");
  const [partnersOnly, setPartnersOnly] = useState(false);
  const [partners, setPartners] = useState<PartnerResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [others, setOthers] = useState<HospitalRowData[] | null>(null);
  const [othersTotal, setOthersTotal] = useState(0);
  const [othersPage, setOthersPage] = useState(1);
  const [listed, setListed] = useState<ListedDoctor[]>([]);
  // Near me
  const [me, setMe] = useState<LatLng | null>(null);
  const [radius, setRadius] = useState(5);
  const [near, setNear] = useState<HospitalRowData[] | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);
  // Map
  const [showMap, setShowMap] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState("");

  const nearMe = useCallback(() => {
    if (!navigator.geolocation) return setStatus("Your browser can't share its location. Search by name, area or city instead.");
    setStatus("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNear(null);
        setStatus("");
      },
      () => setStatus("Location not shared. You can still search by name, area or city."),
      { timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  // From other pages: /doctors?q=heart (home page search), /doctors?near=1 ("Hospitals near me").
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("q");
    if (fromUrl) setQ(fromUrl);
    if (params.get("near") === "1") nearMe();
  }, [nearMe]);

  // MediConnect hospitals, with the specialists matching the search.
  useEffect(() => {
    const params = new URLSearchParams({ q });
    if (department) params.set("department", department);
    if (city) params.set("city", city);
    if (maxFee) params.set("max_fee", maxFee);
    const t = setTimeout(() => {
      api<PartnerResponse>(`/api/search/partner-hospitals/?${params}`)
        .then((r) => {
          setPartners(r);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    }, 200);
    return () => clearTimeout(t);
  }, [q, department, city, maxFee]);

  // Every other hospital (not on MediConnect yet), 20 at a time.
  const loadOthers = useCallback((pageNo: number) => {
    const params = new URLSearchParams({ type: "hospitals", partners: "0", size: "20", page: String(pageNo), ...(q && { q }), ...(city && { city }) });
    api<{ total: number; results: HospitalHit[] }>(`/api/search/?${params}`)
      .then((r) => {
        setOthers((prev) => (pageNo > 1 && prev ? [...prev, ...r.results.map(fromHit)] : r.results.map(fromHit)));
        setOthersTotal(r.total);
        setOthersPage(pageNo);
      })
      .catch(() => setOthers([]));
  }, [q, city]);

  useEffect(() => {
    const t = setTimeout(() => loadOthers(1), 200);
    return () => clearTimeout(t);
  }, [loadOthers]);

  // Doctors listed on hospital websites: only when searching.
  useEffect(() => {
    if (!q.trim()) return setListed([]);
    const t = setTimeout(() => {
      api<{ results: ListedDoctor[] }>(`/api/search/listed-doctors/?q=${encodeURIComponent(q)}`)
        .then((r) => setListed(r.results))
        .catch(() => setListed([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  // Near me: hospitals around the patient, nearest first. The first time in an area, its hospitals are
  // downloaded from OpenStreetMap in the background: check again every few seconds while that runs.
  useEffect(() => {
    if (!me) return;
    let stale = false;
    const params = new URLSearchParams({ lat: String(me.lat), lng: String(me.lng), radius_km: String(radius), limit: "100",
                                         partners_only: String(partnersOnly) });
    api<NearbyResponse>(`/api/hospitals/nearby/?${params}`)
      .then((r) => {
        if (stale) return;
        const words = q.trim().toLowerCase();
        setNear(fromNearby(r).filter((h) => !words || h.name.toLowerCase().includes(words)));
        setLoadingMore(r.loading_more);
        if (r.loading_more) setTimeout(() => !stale && setTick((n) => n + 1), 4000);
      })
      .catch((e) => !stale && (setStatus(errorMessage(e)), setNear([])));
    return () => {
      stale = true;
    };
  }, [me, radius, partnersOnly, q, tick]);

  function pick(id: number) {
    setSelected(id);
    document.getElementById(`hospital-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // What the map shows: the hospitals currently in the list.
  const partnerPins: HospitalRowData[] = (partners?.results ?? []).map((h) => ({
    id: h.id, name: h.name, address: h.address, city: h.city, departments: h.specialties.map((s) => s.name), is_partner: true,
    location_verified: h.location_verified, latitude: h.latitude, longitude: h.longitude,
  }));
  const pins = me ? near ?? [] : [...partnerPins, ...(partnersOnly ? [] : others ?? [])];
  const pinned = pins.filter((h) => h.latitude != null).length;

  const toggle = (on: boolean, label: string, icon: string, onClick: () => void) => (
    <button type="button" onClick={onClick} aria-pressed={on} className={`${on ? "chip-active" : "chip"} gap-1.5`}>
      <Icon name={icon} className="h-4 w-4" /> {label}
    </button>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        icon="calendar"
        title="Book an appointment"
        subtitle="Find a hospital or doctor: search a name, a specialty or your area. Try “Apollo”, “heart”, “kids”, or even a typo like “cardiolgist”."
      />

      <div className="card space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-3">
            <SearchBox value={q} onChange={setQ} placeholder="Hospital, doctor, specialty or area" />
          </div>
          <select className="input" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} aria-label="Maximum fee">
            {FEE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {toggle(partnersOnly, "Instant booking only", "check", () => setPartnersOnly((v) => !v))}
          {toggle(!!me, me ? "Near me (on)" : "Near me", "pin", () => (me ? (setMe(null), setNear(null), setLoadingMore(false)) : nearMe()))}
          {toggle(showMap, showMap ? "Hide map" : "Show map", "map", () => setShowMap((v) => !v))}
          {me && (
            <select className="input w-auto rounded-xl py-1.5 text-sm" aria-label="Distance" value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
              {RADII.map((r) => <option key={r} value={r}>Within {r} km</option>)}
            </select>
          )}
          {me && <span className="text-xs text-slate-500">Your location is only used for this search and isn&apos;t saved.</span>}
        </div>
        {!me && partners && (partners.facets.departments.length > 0 || department || city) && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <Chips title="Specialty" items={partners.facets.departments} active={department} onPick={setDepartment} />
            <Chips title="City" items={partners.facets.cities} active={city} onPick={setCity} />
          </div>
        )}
      </div>

      {status && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{status}</p>}
      {partners?.degraded && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Smart search is temporarily unavailable, so these are basic results (no typo correction).
        </p>
      )}

      {showMap && (
        <section aria-label="Map" className="card space-y-2 overflow-hidden p-2">
          <HospitalMap hospitals={pins} user={me} radiusKm={me ? radius : undefined} selectedId={selected} onSelect={pick} height={380} />
          <p className="flex flex-wrap gap-4 px-2 pb-1 text-xs text-slate-500">
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-teal-600" /> MediConnect (instant booking)</span>
            <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-500" /> Other hospitals</span>
            {me && <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0f8f7e]" /> You</span>}
            <span>{pinned} of {pins.length} on the map (some have no pin yet). Tap a pin to find it in the list.</span>
          </p>
        </section>
      )}

      {me ? (
        <section aria-label="Hospitals near you" className="space-y-3">
          <div>
            <h2 className="section-title">Hospitals near you</h2>
            <p className="text-sm text-slate-500">
              {near === null ? "Looking…" : `${near.length} hospital${near.length === 1 ? "" : "s"} within ${radius} km, nearest first.`}
            </p>
          </div>
          {loadingMore && (
            <p role="status" className="flex items-center gap-2 rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
              Loading all hospitals in this area… (first time only, up to a minute)
            </p>
          )}
          {near === null ? (
            <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="dash-card h-28 animate-pulse" />)}</div>
          ) : near.length === 0 ? (
            <p className="card p-6 text-center text-slate-600">{loadingMore ? "Loading hospitals…" : "No hospitals found nearby. Try a bigger distance."}</p>
          ) : (
            <ul className="space-y-3">{near.map((h) => <li key={h.id}><HospitalRow h={h} selected={selected === h.id} /></li>)}</ul>
          )}
        </section>
      ) : (
        <>
          <section aria-label="MediConnect hospitals">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="section-title">MediConnect hospitals</h2>
                <p className="text-sm text-slate-500">Choose a specialist and book instantly.</p>
              </div>
              {partners && !failed && (
                <span className="text-sm text-slate-500">{partners.total} hospital{partners.total === 1 ? "" : "s"}</span>
              )}
            </div>
            {failed ? (
              <p className="mt-3 text-red-600">Couldn&apos;t load hospitals. Please try again.</p>
            ) : partners === null ? (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => <div key={i} className="card h-64 animate-pulse bg-slate-100/60" />)}
              </div>
            ) : partners.results.length === 0 ? (
              <div className="card mt-3 flex flex-col items-center p-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><Icon name="search" /></span>
                <p className="mt-3 font-medium text-navy-800">No MediConnect hospital has a specialist matching your search.</p>
                <p className="mt-1 text-sm text-slate-500">Try another word, or look at the other hospitals below.</p>
              </div>
            ) : (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {partners.results.map((h) => <PartnerCard key={h.id} h={h} department={department} selected={selected === h.id} />)}
              </div>
            )}
          </section>

          {!partnersOnly && (
            <section aria-label="Other hospitals" className="space-y-3">
              <div>
                <h2 className="section-title">Other hospitals <span className="text-sm font-normal text-slate-500">· not on MediConnect yet</span></h2>
                <p className="text-sm text-slate-500">
                  Information from the map and each hospital&apos;s own website. Book with the hospital, or send a request.
                  {others !== null && ` ${othersTotal} hospital${othersTotal === 1 ? "" : "s"}.`}
                </p>
              </div>
              {others === null ? (
                <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="dash-card h-24 animate-pulse" />)}</div>
              ) : others.length === 0 ? (
                <p className="card p-6 text-center text-sm text-slate-600">
                  No other hospitals match.{" "}
                  <Link href="/hospitals/lookup" className="font-[650] text-teal-700 hover:underline">Can&apos;t find one? Look it up</Link>
                </p>
              ) : (
                <>
                  <ul className="space-y-3">{others.map((h) => <li key={h.id}><HospitalRow h={h} selected={selected === h.id} /></li>)}</ul>
                  {others.length < othersTotal && (
                    <div className="flex justify-center">
                      <button onClick={() => loadOthers(othersPage + 1)} className="btn-outline rounded-xl px-6 py-2.5">
                        Show more ({othersTotal - others.length} left)
                      </button>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}

      {listed.length > 0 && !me && (
        <section>
          <h2 className="section-title">Doctors listed on hospital websites</h2>
          <p className="text-sm text-slate-500">Information from each hospital&apos;s own website. Book with the hospital, or send a request.</p>
          <ul className="card mt-3 divide-y divide-slate-100 overflow-hidden">
            {listed.map((d) => (
              <li key={d.id}>
                <Link href={`/hospitals/${d.hospital_id}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">
                  <span className="flex items-center gap-3">
                    <Avatar name={d.name} size="sm" />
                    <span>
                      <span className="font-medium text-navy-800">{d.name}</span>
                      {d.specialization && <span className="text-slate-600"> · {d.specialization}</span>}
                      {d.timings && <span className="block text-xs text-slate-500">As listed: {d.timings}</span>}
                    </span>
                  </span>
                  <span className="text-sm font-medium text-teal-700">{d.hospital_name}{d.hospital_city ? `, ${d.hospital_city}` : ""} →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}