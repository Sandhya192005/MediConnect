"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Highlight from "@/components/Highlight";
import SearchBox from "@/components/SearchBox";
import { api, ApiError } from "@/lib/api";
import type { Doctor } from "@/lib/types";

type Hit = {
  id: number;
  name: string;
  specialization: string;
  department: string | null;
  hospital_name: string | null;
  city: string | null;
  fee: number;
  experience_years: number;
  highlight: Record<string, string[]>;
};

type Facet = { value: string; count: number };

type HospitalHit = {
  id: number;
  name: string;
  address: string;
  city: string;
  is_partner?: boolean;
  highlight: Record<string, string[]>;
};

type ListedDoctor = {
  id: number;
  name: string;
  specialization: string;
  timings: string;
  hospital_id: number;
  hospital_name: string;
  hospital_city: string;
};

type SearchResponse = {
  total: number;
  results: Hit[];
  facets: { departments: Facet[]; cities: Facet[] };
};

const FEE_OPTIONS = [
  { label: "Any fee", value: "" },
  { label: "Up to ₹500", value: "500" },
  { label: "Up to ₹800", value: "800" },
  { label: "Up to ₹1000", value: "1000" },
];

/** Used when Elasticsearch is down: the plain database search from Phase 2. */
async function fallbackSearch(q: string): Promise<SearchResponse> {
  const docs = await api<Doctor[]>(`/api/doctors/?q=${encodeURIComponent(q)}`);
  return {
    total: docs.length,
    results: docs.map((d) => ({
      id: d.id,
      name: d.name,
      specialization: d.specialization,
      department: d.department_name,
      hospital_name: d.hospital_name,
      city: d.hospital_city,
      fee: Number(d.fee),
      experience_years: d.experience_years,
      highlight: {},
    })),
    facets: { departments: [], cities: [] },
  };
}

function Chips({ title, items, active, onPick }: { title: string; items: Facet[]; active: string; onPick: (v: string) => void }) {
  if (items.length === 0 && !active) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</span>
      {active && (
        <button onClick={() => onPick("")} className="rounded-full bg-teal-600 px-3 py-1 text-xs text-white">
          {active} ✕
        </button>
      )}
      {!active &&
        items.map((f) => (
          <button key={f.value} onClick={() => onPick(f.value)} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs hover:border-teal-500">
            {f.value} <span className="text-slate-400">{f.count}</span>
          </button>
        ))}
    </div>
  );
}

export default function DoctorsPage() {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [city, setCity] = useState("");
  const [maxFee, setMaxFee] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [hospitals, setHospitals] = useState<HospitalHit[]>([]);
  const [listed, setListed] = useState<ListedDoctor[]>([]);

  useEffect(() => {
    const params = new URLSearchParams({ q });
    if (department) params.set("department", department);
    if (city) params.set("city", city);
    if (maxFee) params.set("max_fee", maxFee);

    const t = setTimeout(async () => {
      try {
        setData(await api<SearchResponse>(`/api/search/?${params}`));
        setDegraded(false);
      } catch (e) {
        if (e instanceof ApiError && e.status === 503) {
          setData(await fallbackSearch(q));
          setDegraded(true);
        }
      }
    }, 200);
    return () => clearTimeout(t);
  }, [q, department, city, maxFee]);

  // Hospitals (all listed ones, partners first) and doctors listed on hospital websites.
  useEffect(() => {
    if (!q.trim()) {
      setHospitals([]);
      setListed([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ results: HospitalHit[] }>(`/api/search/?type=hospitals&q=${encodeURIComponent(q)}${city ? `&city=${encodeURIComponent(city)}` : ""}`)
        .then((r) => setHospitals(r.results))
        .catch(() => setHospitals([]));
      api<{ results: ListedDoctor[] }>(`/api/search/listed-doctors/?q=${encodeURIComponent(q)}`)
        .then((r) => setListed(r.results))
        .catch(() => setListed([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, city]);

  return (
    <div>
      <h1 className="text-2xl font-bold">Find hospitals or doctors</h1>
      <p className="text-sm text-slate-600">
        Search a hospital name, a doctor, or a specialty. Try “Apollo”, “heart”, “skin doctor”, “kids”, or even a typo like “cardiolgist”.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-3">
          <SearchBox value={q} onChange={setQ} placeholder="Hospital, doctor, specialty or symptom area" />
        </div>
        <select className="input" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} aria-label="Maximum fee">
          {FEE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {data && !degraded && (
        <div className="mt-4 space-y-2">
          <Chips title="Department" items={data.facets.departments} active={department} onPick={setDepartment} />
          <Chips title="City" items={data.facets.cities} active={city} onPick={setCity} />
        </div>
      )}

      {degraded && (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Smart search is temporarily unavailable, so these are basic results.
        </p>
      )}

      {hospitals.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold">Hospitals</h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {hospitals.slice(0, 9).map((h) => (
              <Link key={h.id} href={`/hospitals/${h.id}`} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-teal-400">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold"><Highlight text={h.highlight.name} fallback={h.name} /></h3>
                  {h.is_partner && <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">Partner</span>}
                </div>
                <p className="text-sm text-slate-600">{[h.address, h.city].filter(Boolean).join(", ") || "Address not listed"}</p>
                <p className="mt-1 text-xs text-slate-500">{h.is_partner ? "Instant booking on MediConnect" : "View info from its website →"}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <h2 className="mt-8 text-lg font-semibold">MediConnect doctors <span className="text-sm font-normal text-slate-500">· book instantly</span></h2>
      {data === null ? (
        <p className="mt-2 text-slate-500">Loading…</p>
      ) : data.results.length === 0 ? (
        <p className="mt-2 text-slate-500">No MediConnect doctors match your search.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-500">{data.total} doctor{data.total === 1 ? "" : "s"} found</p>
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.results.map((d) => (
              <Link key={d.id} href={`/doctors/${d.id}`} className="rounded-xl border border-slate-200 bg-white p-5 hover:border-teal-400 hover:shadow-sm">
                <h3 className="font-semibold">
                  Dr. <Highlight text={d.highlight.name} fallback={d.name} />
                </h3>
                <p className="text-sm text-teal-700">
                  <Highlight text={d.highlight.specialization} fallback={d.specialization} />
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  <Highlight text={d.highlight.hospital_name} fallback={d.hospital_name} />, <Highlight text={d.highlight.city} fallback={d.city} />
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {d.experience_years} yrs experience · ₹{Number(d.fee).toFixed(0)}
                </p>
              </Link>
            ))}
          </div>
        </>
      )}

      {listed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">Doctors listed on hospital websites</h2>
          <p className="text-sm text-slate-500">Information from each hospital&apos;s own website. Book with the hospital, or send a request.</p>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {listed.map((d) => (
              <li key={d.id}>
                <Link href={`/hospitals/${d.hospital_id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50">
                  <span>
                    <span className="font-medium">{d.name}</span>
                    {d.specialization && <span className="text-slate-600"> · {d.specialization}</span>}
                    {d.timings && <span className="block text-xs text-slate-500">As listed: {d.timings}</span>}
                  </span>
                  <span className="text-sm text-teal-700">{d.hospital_name}{d.hospital_city ? `, ${d.hospital_city}` : ""} →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
