"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AppointmentRequestForm from "@/components/AppointmentRequestForm";
import ExternalAppointmentForm from "@/components/ExternalAppointmentForm";
import Icon from "@/components/Icons";
import LocationBadge from "@/components/LocationBadge";
import ScrapeStatus from "@/components/ScrapeStatus";
import { Avatar } from "@/components/PageHeader";
import SpecialistList from "@/components/SpecialistList";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { timeAgo, type Doctor, type HospitalDetail, type ScrapeJob } from "@/lib/types";
import { useScrapeJob } from "@/lib/useScrapeJob";

// Shown next to a website we found ourselves, so patients know it isn't confirmed by the hospital.
const WEBSITE_SOURCE: Record<string, string> = {
  osm: "from OpenStreetMap",
  wikidata: "found on Wikidata, not confirmed by the hospital",
  patient: "added by a patient, not confirmed by the hospital",
  nearby: "from the same hospital listed nearby on the map, not confirmed by the hospital",
};

const HospitalMap = dynamic(() => import("@/components/HospitalMap"), { ssr: false });

export default function HospitalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [hospital, setHospital] = useState<HospitalDetail | null>(null);
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [error, setError] = useState("");
  const [refreshMsg, setRefreshMsg] = useState("");
  const [startedJob, setStartedJob] = useState<ScrapeJob | null>(null);
  const [requestDoctor, setRequestDoctor] = useState<number | null>(null);
  const [autoTried, setAutoTried] = useState(false);

  const load = useCallback(() => {
    api<HospitalDetail>(`/api/scraper/hospitals/${id}/`).then(setHospital).catch((e) => setError(errorMessage(e)));
    api<Doctor[]>(`/api/doctors/?hospital=${id}`).then(setDoctors);
  }, [id]);

  useEffect(load, [load]);

  // Reload when the "Hospital info ready" notification arrives live.
  useEffect(() => {
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [load]);

  const job = useScrapeJob(startedJob ?? hospital?.active_job ?? null, load);

  const [pastedUrl, setPastedUrl] = useState("");
  const [docQuery, setDocQuery] = useState("");

  const refresh = useCallback(async (silent = false, url = "") => {
    setRefreshMsg("");
    try {
      const r = await api<{ job: ScrapeJob }>(`/api/scraper/hospitals/${id}/refresh/`, {
        method: "POST",
        body: JSON.stringify(url ? { url } : {}),
      });
      setStartedJob(r.job);
    } catch (e) {
      if (!silent) setRefreshMsg(errorMessage(e));
    }
  }, [id]);

  // Runs once per page view, in the background, for logged-in users only.
  useEffect(() => {
    if (!hospital || autoTried || !user) return;
    setAutoTried(true);
    if (hospital.active_job) return;
    // Stale copy → refresh it. No website yet → search for it (Wikidata) and read it if found.
    if ((hospital.website && !hospital.is_fresh) || hospital.can_search_website) refresh(true);
  }, [hospital, autoTried, user, refresh]);

  if (!hospital) return <p className="text-slate-500">{error || "Loading…"}</p>;

  const partner = hospital.has_bookable_doctors;
  const searching = !hospital.website && (job?.status === "pending" || job?.status === "running");
  const info = hospital.scraped_info;
  const hasPin = hospital.latitude != null && hospital.longitude != null;

  // "Search doctors at this hospital": matches name, specialty or qualification, in both lists.
  const dq = docQuery.trim().toLowerCase();
  const matchDoc = (...fields: (string | null | undefined)[]) => !dq || fields.some((f) => (f ?? "").toLowerCase().includes(dq));
  const listedDoctors = hospital.scraped_doctors.filter((d) => matchDoc(d.name, d.specialization, d.qualification));
  const mcDoctors = (doctors ?? []).filter((d) => matchDoc(d.name, d.specialization, d.department_name));
  const totalDoctors = hospital.scraped_doctors.length + (doctors?.length ?? 0);

  const phone = hospital.phone || info?.phones[0] || "";
  const busy = job?.status === "pending" || job?.status === "running";

  return (
    <div className="space-y-6">
      <Link href="/hospitals" className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline">← Hospitals</Link>

      {/* Header */}
      <section className="card overflow-hidden">
        <div className={`${partner ? "bg-brand-gradient" : "bg-gradient-to-r from-slate-500 to-slate-400"} relative h-24`}>
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        </div>
        <div className="px-5 pb-5 sm:px-6">
          <span className="relative z-10 -mt-8 flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-white bg-white text-teal-700 shadow-md">
            <Icon name="hospital" className="h-8 w-8" />
          </span>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-navy-800 sm:text-3xl">{hospital.name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {partner ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-800">
                    <Icon name="check" className="h-3 w-3" />MediConnect partner · instant booking
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Not a MediConnect partner</span>
                )}
                {hasPin && <LocationBadge verified={hospital.location_verified} />}
              </div>
              <p className="mt-2 flex items-start gap-1.5 text-slate-600">
                <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                {[hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ") || "Address not listed"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {phone && (
                <a href={`tel:${phone}`} className="btn-outline">
                  <Icon name="phone" className="h-4 w-4" /> {phone}
                </a>
              )}
              {hospital.website && (
                <a href={hospital.website} target="_blank" rel="noopener noreferrer" className="btn-outline">
                  <Icon name="globe" className="h-4 w-4" />
                  {["wikidata", "patient", "nearby"].includes(hospital.website_source) ? "Website" : "Official website"} ↗
                </a>
              )}
            </div>
          </div>
          {hospital.website && WEBSITE_SOURCE[hospital.website_source] && (
            <p className="mt-2 text-xs text-slate-500">Website {WEBSITE_SOURCE[hospital.website_source]}.</p>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: where */}
        <aside className="space-y-4 lg:col-span-2">
          {hasPin && (
            <div className="card overflow-hidden p-2">
              <HospitalMap hospitals={[hospital]} height={260} />
            </div>
          )}
          {info && (info.opd_timings || info.emails.length > 0 || info.departments.length > 0 || info.notes) && (
            <div className="card p-5">
              <h2 className="section-title">At a glance</h2>
              <p className="text-xs text-slate-500">From the hospital&apos;s website.</p>
              <dl className="mt-3 space-y-3 text-sm">
                {info.opd_timings && (
                  <div className="flex gap-3"><Icon name="clock" className="h-4 w-4 shrink-0 text-teal-700" /><div><dt className="text-slate-500">OPD timings</dt><dd className="font-medium text-slate-800">{info.opd_timings}</dd></div></div>
                )}
                {info.phones.length > 0 && (
                  <div className="flex gap-3"><Icon name="phone" className="h-4 w-4 shrink-0 text-teal-700" /><div><dt className="text-slate-500">Phone</dt><dd className="font-medium text-slate-800">{info.phones.join(", ")}</dd></div></div>
                )}
                {info.emails.length > 0 && (
                  <div className="flex gap-3"><Icon name="chat" className="h-4 w-4 shrink-0 text-teal-700" /><div><dt className="text-slate-500">Email</dt><dd className="break-all font-medium text-slate-800">{info.emails.join(", ")}</dd></div></div>
                )}
                {info.departments.length > 0 && (
                  <div><dt className="text-slate-500">Departments</dt><dd className="mt-1 flex flex-wrap gap-1.5">{info.departments.map((d) => <span key={d} className="chip">{d}</span>)}</dd></div>
                )}
                {info.notes && <div><dt className="text-slate-500">Notes</dt><dd className="text-slate-800">{info.notes}</dd></div>}
              </dl>
            </div>
          )}
        </aside>

        {/* Right: our specialists (partners), then what their website says */}
        <section className="space-y-4 lg:col-span-3">
          {totalDoctors > 0 && (
            <div className="card p-4">
              <label className="block text-sm font-semibold text-navy-800">
                Search doctors at this hospital
                <span className="relative mt-2 block">
                  <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    className="input pl-9 font-normal"
                    value={docQuery}
                    onChange={(e) => setDocQuery(e.target.value)}
                    placeholder="Name or specialty, e.g. cardio, skin, Dr. Raman"
                  />
                </span>
              </label>
              {dq && (
                <p className="mt-2 text-xs text-slate-500">
                  {mcDoctors.length + listedDoctors.length} of {totalDoctors} doctors match “{docQuery}”.
                </p>
              )}
            </div>
          )}
          {partner && (
            <div className="card p-5">
              <h2 className="section-title">Our specialists</h2>
              <p className="mb-4 text-sm text-slate-500">MediConnect doctors at this hospital. Pick a specialist to see free slots and book instantly.</p>
              <SpecialistList doctors={mcDoctors} searching={!!dq} />
            </div>
          )}

          <div className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="section-title">From the hospital&apos;s website</h2>
                {hospital.scraped_at ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Collected {timeAgo(hospital.scraped_at)} from{" "}
                    <a href={hospital.source_url} target="_blank" rel="noopener noreferrer" className="underline">{hospital.source_url}</a>.
                    Check details with the hospital before visiting.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">
                    {hospital.website
                      ? user
                        ? "Not collected yet."
                        : "Log in to load the latest information from this hospital's website."
                      : hospital.can_search_website
                        ? user
                          ? "No website saved yet: we'll look for it."
                          : "No website saved yet. Log in and we'll look for it."
                        : "We couldn't find this hospital's website on OpenStreetMap or Wikidata."}
                  </p>
                )}
              </div>
              {hospital.website && user && (
                <button onClick={() => refresh()} disabled={busy} className="btn-outline px-3 py-1.5">
                  ↻ Refresh from website
                </button>
              )}
            </div>
            {!hospital.website && user && !searching && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (pastedUrl.trim()) refresh(false, pastedUrl.trim());
                }}
                className="mt-3 flex flex-wrap gap-2"
              >
                <input
                  className="input max-w-sm"
                  value={pastedUrl}
                  onChange={(e) => setPastedUrl(e.target.value)}
                  placeholder="Paste the hospital's website, e.g. https://…"
                  aria-label="Hospital website"
                />
                <button className="btn-solid" disabled={!pastedUrl.trim()}>
                  Read website
                </button>
              </form>
            )}
            <div className="mt-3 space-y-2"><ScrapeStatus job={job} searching={searching} />{refreshMsg && <p className="text-sm text-amber-700">{refreshMsg}</p>}</div>

            {hospital.scraped_doctors.length > 0 && (
              <>
                <h3 className="mt-5 text-sm font-semibold text-navy-800">Doctors listed on their website ({listedDoctors.length}{dq ? ` of ${hospital.scraped_doctors.length}` : ""})</h3>
                {listedDoctors.length === 0 && <p className="mt-2 text-sm text-slate-500">No listed doctor matches your search.</p>}
                <ul className="mt-2 divide-y divide-slate-100 text-sm">
                  {listedDoctors.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={d.name} size="sm" />
                        <div>
                          <p className="font-medium text-navy-800">{d.name}</p>
                          {(d.specialization || d.qualification) && (
                            <p className="text-slate-600">{[d.specialization, d.qualification].filter(Boolean).join(" · ")}</p>
                          )}
                          {d.timings && <p className="text-xs text-slate-500">As listed: {d.timings}</p>}
                        </div>
                      </div>
                      {!partner && user?.role === "patient" && (
                        <button onClick={() => setRequestDoctor(d.id)} className="btn-outline px-3 py-1 text-xs">Request</button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-400">Timings are as published by the hospital. They are not bookable slots.</p>
              </>
            )}
          </div>

          {/* Booking */}
          {!partner && (
            <div className="card space-y-4 p-5">
              <div>
                <h2 className="section-title">How to book</h2>
                <p className="text-sm text-slate-600">This hospital isn&apos;t a MediConnect partner yet, so we can&apos;t confirm slots instantly.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {hospital.booking_url && (
                  <a href={hospital.booking_url} target="_blank" rel="noopener noreferrer" className="btn-solid">Book on the hospital&apos;s website ↗</a>
                )}
                {phone && (
                  <a href={`tel:${phone}`} className="btn-outline"><Icon name="phone" className="h-4 w-4" /> Call {phone}</a>
                )}
              </div>
              {user?.role === "patient" ? (
                <>
                  <AppointmentRequestForm key={requestDoctor ?? "any"} hospitalId={hospital.id} doctors={hospital.scraped_doctors} presetDoctor={requestDoctor} />
                  <details className="rounded-xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-teal-700">
                      Already booked on their website or by phone? Add it to get reminders
                    </summary>
                    <div className="px-4 pb-4">
                      <ExternalAppointmentForm hospitalId={hospital.id} hospitalName={hospital.name} doctors={hospital.scraped_doctors} />
                    </div>
                  </details>
                </>
              ) : !user ? (
                <p className="text-sm"><Link href="/login" className="font-semibold text-teal-700 hover:underline">Log in</Link> as a patient to send an appointment request.</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
