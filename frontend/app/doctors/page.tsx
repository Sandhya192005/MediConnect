"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Highlight from "@/components/Highlight";
import Icon from "@/components/Icons";
import PageHeader, { Avatar } from "@/components/PageHeader";
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

function PartnerCard({ h, department }: { h: PartnerHospital; department: string }) {
  // Open the hospital on the specialty the patient was looking for.
  const focus = department || h.matching_doctors[0]?.department || "";
  const href = `/hospitals/${h.id}${focus ? `?specialty=${encodeURIComponent(focus)}` : ""}`;
  return (
    <article aria-label={h.name} className="card-hover flex flex-col overflow-hidden">
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
    <div className="space-y-8">
      <PageHeader
        icon="search"
        title="Find hospitals or doctors"
        subtitle="Search a hospital, a doctor, or a specialty. Try “Apollo”, “heart”, “skin doctor”, “kids”, or even a typo like “cardiolgist”."
      />

      <div className="card space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-3">
            <SearchBox value={q} onChange={setQ} placeholder="Hospital, doctor, specialty or symptom area" />
          </div>
          <select className="input" value={maxFee} onChange={(e) => setMaxFee(e.target.value)} aria-label="Maximum fee">
            {FEE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        {partners && (partners.facets.departments.length > 0 || department || city) && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
            <Chips title="Specialty" items={partners.facets.departments} active={department} onPick={setDepartment} />
            <Chips title="City" items={partners.facets.cities} active={city} onPick={setCity} />
          </div>
        )}
      </div>

      {partners?.degraded && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Smart search is temporarily unavailable, so these are basic results (no typo correction).
        </p>
      )}

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
            {partners.results.map((h) => <PartnerCard key={h.id} h={h} department={department} />)}
          </div>
        )}
      </section>

      {others.length > 0 && (
        <section aria-label="Other hospitals">
          <h2 className="section-title">Other hospitals <span className="text-sm font-normal text-slate-500">· not on MediConnect yet</span></h2>
          <p className="text-sm text-slate-500">Information from the map and each hospital&apos;s own website. Book with the hospital, or send a request.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.slice(0, 9).map((h) => (
              <Link key={h.id} href={`/hospitals/${h.id}`} className="card-hover flex items-start gap-3 p-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><Icon name="hospital" /></span>
                <span className="min-w-0">
                  <span className="block font-semibold text-navy-800"><Highlight text={h.highlight.name} fallback={h.name} /></span>
                  <span className="block truncate text-sm text-slate-500">{[h.address, h.city].filter(Boolean).join(", ") || "Address not listed"}</span>
                  <span className="mt-1 block text-xs font-medium text-teal-700">View info from its website →</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {listed.length > 0 && (
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
