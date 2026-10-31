"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import AppointmentRequestForm from "@/components/AppointmentRequestForm";
import ExternalAppointmentForm from "@/components/ExternalAppointmentForm";
import LocationBadge from "@/components/LocationBadge";
import ScrapeStatus from "@/components/ScrapeStatus";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { timeAgo, type Doctor, type HospitalDetail, type ScrapeJob } from "@/lib/types";
import { useScrapeJob } from "@/lib/useScrapeJob";

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

  const refresh = useCallback(async (silent = false) => {
    setRefreshMsg("");
    try {
      const r = await api<{ job: ScrapeJob }>(`/api/scraper/hospitals/${id}/refresh/`, { method: "POST" });
      setStartedJob(r.job);
    } catch (e) {
      if (!silent) setRefreshMsg(errorMessage(e));
    }
  }, [id]);

  // Saved copy older than 24 h: quietly fetch a fresh one in the background (logged-in users only).
  useEffect(() => {
    if (!hospital || autoTried || !user) return;
    setAutoTried(true);
    if (hospital.website && !hospital.is_fresh && !hospital.active_job) refresh(true);
  }, [hospital, autoTried, user, refresh]);

  if (!hospital) return <p className="text-slate-500">{error || "Loading…"}</p>;

  const partner = hospital.has_bookable_doctors;
  const info = hospital.scraped_info;
  const hasPin = hospital.latitude != null && hospital.longitude != null;

  return (
    <div className="space-y-6">
      <Link href="/hospitals" className="text-sm text-teal-700">← Hospitals</Link>

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left: who they are + where */}
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{hospital.name}</h1>
              {partner ? (
                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-700">MediConnect partner · instant booking</span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Not a MediConnect partner</span>
              )}
            </div>
            <p className="mt-1 text-slate-600">{[hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")}</p>
            {hospital.phone && <p className="mt-1 text-sm">📞 <a href={`tel:${hospital.phone}`} className="underline">{hospital.phone}</a></p>}
            {hospital.website && (
              <a href={hospital.website} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm text-teal-700 underline">Official website ↗</a>
            )}
            {hasPin && <div className="mt-3"><LocationBadge verified={hospital.location_verified} /></div>}
          </div>
          {hasPin && <HospitalMap hospitals={[hospital]} height={240} />}
        </section>

        {/* Right: what their website says */}
        <section className="space-y-4 lg:col-span-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-lg font-semibold">From the hospital&apos;s website</h2>
              {hospital.website && user && (
                <button onClick={() => refresh()} disabled={job?.status === "pending" || job?.status === "running"} className="rounded-md border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50 disabled:opacity-50">
                  ↻ Refresh from website
                </button>
              )}
            </div>
            {hospital.scraped_at ? (
              <p className="mt-1 text-xs text-slate-500">
                Collected {timeAgo(hospital.scraped_at)} from{" "}
                <a href={hospital.source_url} target="_blank" rel="noopener noreferrer" className="underline">{hospital.source_url}</a>.
                Check details with the hospital before visiting.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-500">{hospital.website ? "Not collected yet." : "This hospital has no website listed."}</p>
            )}
            <div className="mt-3 space-y-2"><ScrapeStatus job={job} />{refreshMsg && <p className="text-sm text-amber-700">{refreshMsg}</p>}</div>

            {info && (
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                {info.opd_timings && <div><dt className="text-slate-500">OPD timings</dt><dd>{info.opd_timings}</dd></div>}
                {info.phones.length > 0 && <div><dt className="text-slate-500">Phone</dt><dd>{info.phones.join(", ")}</dd></div>}
                {info.emails.length > 0 && <div><dt className="text-slate-500">Email</dt><dd>{info.emails.join(", ")}</dd></div>}
                {info.departments.length > 0 && <div className="sm:col-span-2"><dt className="text-slate-500">Departments</dt><dd>{info.departments.join(" · ")}</dd></div>}
                {info.notes && <div className="sm:col-span-2"><dt className="text-slate-500">Notes</dt><dd>{info.notes}</dd></div>}
              </dl>
            )}

            {hospital.scraped_doctors.length > 0 && (
              <>
                <h3 className="mt-5 text-sm font-semibold">Doctors listed on their website ({hospital.scraped_doctors.length})</h3>
                <ul className="mt-2 divide-y divide-slate-100 text-sm">
                  {hospital.scraped_doctors.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div>
                        <p className="font-medium">{d.name}</p>
                        <p className="text-slate-600">{[d.specialization, d.qualification].filter(Boolean).join(" · ")}</p>
                        {d.timings && <p className="text-xs text-slate-500">As listed: {d.timings}</p>}
                      </div>
                      {!partner && user?.role === "patient" && (
                        <button onClick={() => setRequestDoctor(d.id)} className="rounded-md border border-teal-600 px-2 py-1 text-xs text-teal-700 hover:bg-teal-50">Request</button>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-slate-400">Timings are as published by the hospital. They are not bookable slots.</p>
              </>
            )}
          </div>

          {/* Booking */}
          {partner ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 text-lg font-semibold">Book with a MediConnect doctor</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {(doctors ?? []).map((d) => (
                  <Link key={d.id} href={`/doctors/${d.id}`} className="rounded-lg border border-slate-200 p-3 hover:border-teal-400">
                    <p className="font-semibold">Dr. {d.name}</p>
                    <p className="text-sm text-teal-700">{d.specialization}</p>
                    <p className="text-sm text-slate-500">₹{Number(d.fee).toFixed(0)} · Book →</p>
                  </Link>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-lg font-semibold">How to book</h2>
              <p className="text-sm text-slate-600">This hospital isn&apos;t a MediConnect partner yet, so we can&apos;t confirm slots instantly.</p>
              <div className="flex flex-wrap gap-2">
                {hospital.booking_url && (
                  <a href={hospital.booking_url} target="_blank" rel="noopener noreferrer" className="rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white">Book on the hospital&apos;s website ↗</a>
                )}
                {(hospital.phone || info?.phones[0]) && (
                  <a href={`tel:${hospital.phone || info?.phones[0]}`} className="rounded-md border border-slate-300 px-3 py-2 text-sm">📞 Call {hospital.phone || info?.phones[0]}</a>
                )}
              </div>
              {user?.role === "patient" ? (
                <>
                  <AppointmentRequestForm key={requestDoctor ?? "any"} hospitalId={hospital.id} doctors={hospital.scraped_doctors} presetDoctor={requestDoctor} />
                  <details className="rounded-xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-teal-700">
                      Already booked on their website or by phone? Add it to get reminders
                    </summary>
                    <div className="px-4 pb-4">
                      <ExternalAppointmentForm hospitalId={hospital.id} hospitalName={hospital.name} doctors={hospital.scraped_doctors} />
                    </div>
                  </details>
                </>
              ) : !user ? (
                <p className="text-sm"><Link href="/login" className="text-teal-700 underline">Log in</Link> as a patient to send an appointment request.</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
