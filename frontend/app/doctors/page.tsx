"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Highlight from "@/components/Highlight";
import SearchBox from "@/components/SearchBox";
import { api } from "@/lib/api";

type Facet = { value: string; count: number };

/** A MediConnect (partner) hospital: instant booking with its own specialists. */
type PartnerHospital = {
  id: number;
  name: string;
  address: string;
  city: string;
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

function PartnerCard({ h, department }: { h: PartnerHospital; department: string }) {
  // Open the hospital on the specialty the patient was looking for.
  const focus = department || h.matching_doctors[0]?.department || "";
  const href = `/hospitals/${h.id}${focus ? `?specialty=${encodeURIComponent(focus)}` : ""}`;
  return (
    <article aria-label={h.name} className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 hover:border-teal-400 hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <Link href={href} className="font-semibold hover:text-teal-700">{h.name}</Link>
        <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">Instant booking</span>
      </div>
      <p className="text-sm text-slate-600">{[h.address, h.city].filter(Boolean).join(", ")}</p>

      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">
        {h.doctor_count} specialist{h.doctor_count === 1 ? "" : "s"}
      </p>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {h.specialties.map((s) => (
          <Link
            key={s.name}
            href={`/hospitals/${h.id}?specialty=${encodeURIComponent(s.name)}`}
            className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-teal-50 hover:text-teal-800"
          >
            {s.name} {s.count > 1 ? `· ${s.count}` : ""}
          </Link>
        ))}
      </div>

      {h.matching_doctors.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-500">Matching specialists</p>
          <ul className="mt-1 space-y-1 text-sm">
            {h.matching_doctors.slice(0, 3).map((d) => (
              <li key={d.id}>
                <Link href={`/doctors/${d.id}`} className="text-teal-700 hover:underline">Dr. {d.name}</Link>
                <span className="text-slate-600"> · {d.specialization} · ₹{d.fee.toFixed(0)}</span>
              </li>
            ))}
            {h.matching_doctors.length > 3 && <li className="text-xs text-slate-500">+{h.matching_doctors.length - 3} more</li>}
          </ul>
        </div>
      )}

      <Link href={href} className="mt-auto pt-3 text-sm font-medium text-teal-700">View specialists & book →</Link>
    </article>
  );
}

export default function FindPage() {
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState("");
  const [city, setCity] = useState("");
  const [maxFee, setMaxFee] = useState("");
  const [partners, setPartners] = useState<PartnerResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [others, setOthers] = useState<HospitalHit[]>([]);
  const [listed, setListed] = useState<ListedDoctor[]>([]);

  // Arriving from the home page with words already typed: /doctors?q=heart
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("q");
    if (fromUrl) setQ(fromUrl);
  }, []);

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

  // Other hospitals (not partners) and doctors listed on hospital websites: only when searching.
  useEffect(() => {
    if (!q.trim()) {
      setOthers([]);
      setListed([]);
      return;
    }
    const t = setTimeout(() => {
      api<{ results: HospitalHit[] }>(`/api/search/?type=hospitals&q=${encodeURIComponent(q)}${city ? `&city=${encodeURIComponent(city)}` : ""}`)
        .then((r) => setOthers(r.results.filter((h) => !h.is_partner)))
        .catch(() => setOthers([]));
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
        Search a hospital, a doctor, or a specialty. Try “Apollo”, “heart”, “skin doctor”, “kids”, or even a typo like “cardiolgist”.
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

      {partners && (
        <div className="mt-4 space-y-2">
          <Chips title="Specialty" items={partners.facets.departments} active={department} onPick={setDepartment} />
          <Chips title="City" items={partners.facets.cities} active={city} onPick={setCity} />
        </div>
      )}

      {partners?.degraded && (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
          Smart search is temporarily unavailable, so these are basic results (no typo correction).
        </p>
      )}

      <section className="mt-6" aria-label="MediConnect hospitals">
        <h2 className="text-lg font-semibold">
          MediConnect hospitals <span className="text-sm font-normal text-slate-500">· choose a specialist and book instantly</span>
        </h2>
        {failed ? (
          <p className="mt-2 text-red-600">Couldn&apos;t load hospitals. Please try again.</p>
        ) : partners === null ? (
          <p className="mt-2 text-slate-500">Loading…</p>
        ) : partners.results.length === 0 ? (
          <p className="mt-2 text-slate-500">No MediConnect hospital has a specialist matching your search.</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-slate-500">{partners.total} hospital{partners.total === 1 ? "" : "s"}</p>
            <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {partners.results.map((h) => <PartnerCard key={h.id} h={h} department={department} />)}
            </div>
          </>
        )}
      </section>

      {others.length > 0 && (
        <section className="mt-8" aria-label="Other hospitals">
          <h2 className="text-lg font-semibold">Other hospitals <span className="text-sm font-normal text-slate-500">· not on MediConnect yet</span></h2>
          <p className="text-sm text-slate-500">Information from the map and each hospital&apos;s own website. Book with the hospital, or send a request.</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.slice(0, 9).map((h) => (
              <Link key={h.id} href={`/hospitals/${h.id}`} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-teal-400">
                <h3 className="font-semibold"><Highlight text={h.highlight.name} fallback={h.name} /></h3>
                <p className="text-sm text-slate-600">{[h.address, h.city].filter(Boolean).join(", ") || "Address not listed"}</p>
                <p className="mt-1 text-xs text-slate-500">View info from its website →</p>
              </Link>
            ))}
          </div>
        </section>
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
