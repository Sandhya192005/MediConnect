"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DashboardShell, { EmptyState, IconTile, Panel, pillFor, SkeletonRows, StatCard, StatusPill } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import TodayVisit from "@/components/TodayVisit";
import { api, downloadFile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import HospitalThumb from "@/components/HospitalThumb";
import { areaOf, fmtDate, fmtDateTime, type Appointment, type MedicalRecord, type NearbyHospital, type NearbyResponse } from "@/lib/types";

type PartnerHospital = {
  id: number;
  name: string;
  address: string;
  city: string;
  doctor_count: number;
  specialties: { name: string; count: number }[];
};

const NEARBY_KM = 5;

export default function PatientDashboard() {
  const { user } = useAuth();
  const [upcoming, setUpcoming] = useState<Appointment[] | null>(null);
  const [partners, setPartners] = useState<PartnerHospital[] | null>(null);
  const [records, setRecords] = useState<MedicalRecord[] | null>(null);
  const [failed, setFailed] = useState({ appointments: false, partners: false });

  useEffect(() => {
    api<MedicalRecord[]>("/api/records/").then(setRecords).catch(() => setRecords([]));
    api<Appointment[]>("/api/appointments/?when=upcoming")
      .then((items) => setUpcoming(items.filter((a) => a.status === "booked" || a.status === "confirmed")))
      .catch(() => {
        setUpcoming([]);
        setFailed((f) => ({ ...f, appointments: true }));
      });
    api<{ results: PartnerHospital[] }>("/api/search/partner-hospitals/")
      .then((r) => setPartners(r.results.slice(0, 3)))
      .catch(() => {
        setPartners([]);
        setFailed((f) => ({ ...f, partners: true }));
      });
  }, []);

  const next = upcoming?.[0];

  return (
    <DashboardShell
      role="patient"
      heading="Patient dashboard"
      greeting={`Hello ${user?.first_name || "there"}!`}
      subtitle="Take care of your health, always."
      badge
    >
      <TodayVisit />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon="calendar"
          tone="blue"
          label="Upcoming appointment"
          value={upcoming === null ? "…" : next ? undefined : "None booked"}
          detail={next ? <>{fmtDateTime(next.start)}<br />{next.specialization || next.doctor_name}</> : upcoming === null ? undefined : "Book a visit with a specialist."}
          link={next ? { href: "/patient/appointments", label: "View details" } : { href: "/doctors", label: "Book now" }}
        />
        <NearbyCard />
        <StatCard
          icon="folder"
          tone="orange"
          label="Medical records"
          value={records === null ? "…" : records.length === 0 ? "None yet" : undefined}
          detail={
            records === null
              ? undefined
              : records.length === 0
                ? "Keep your reports, scans and X-rays here, ready for your doctor."
                : `${records.length} ${records.length === 1 ? "file" : "files"} available`
          }
          link={{ href: "/patient/records", label: records?.length ? "View records" : "Add a record" }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="MediConnect hospitals" action={{ href: "/doctors", label: "View all" }} className="lg:col-span-3">
          {partners === null ? (
            <SkeletonRows rows={3} />
          ) : partners.length === 0 ? (
            <EmptyState
              icon="hospital"
              title={failed.partners ? "Couldn't load hospitals" : "No partner hospitals yet"}
              text={failed.partners ? "Please try again in a moment." : "Search every hospital by name, area or specialty."}
            >
              <Link href="/doctors" className="dash-link mt-3">Find hospitals <Icon name="arrow" className="h-4 w-4" /></Link>
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {partners.map((h) => (
                <li key={h.id} className="flex flex-col gap-3 rounded-xl border border-slate-100 p-3 transition hover:border-teal-200 hover:bg-teal-50/30 sm:flex-row sm:items-center sm:gap-4">
                  <div className="flex min-w-0 flex-1 items-center gap-4">
                    <IconTile icon="hospital" tone="teal" />
                    <div className="min-w-0">
                      <p className="truncate font-[650] text-[#0f2f3a]">{h.name}</p>
                      <p className="truncate text-sm text-slate-500">
                        {[h.address, h.city].filter(Boolean).join(", ") || "Address not listed"}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {h.doctor_count} {h.doctor_count === 1 ? "doctor" : "doctors"}
                        {h.specialties.length > 0 && ` · ${h.specialties.slice(0, 3).map((s) => s.name).join(", ")}`}
                      </p>
                    </div>
                  </div>
                  <Link href={`/hospitals/${h.id}`} className="btn-solid w-full px-4 py-2 sm:w-auto">
                    Book appointment
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6 lg:col-span-2">
        <Panel title="My upcoming appointments" action={{ href: "/patient/appointments", label: "View all" }}>
          {upcoming === null ? (
            <SkeletonRows rows={3} />
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={failed.appointments ? "Couldn't load appointments" : "No upcoming appointments"}
              text={failed.appointments ? "Please try again in a moment." : "Find a doctor and pick a free slot."}
            >
              {!failed.appointments && <Link href="/doctors" className="dash-link mt-3">Find a doctor <Icon name="arrow" className="h-4 w-4" /></Link>}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <IconTile icon="stethoscope" tone="indigo" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#0f2f3a]">{a.doctor_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {fmtDateTime(a.start)}
                      {a.hospital_name && ` · ${a.hospital_name}`}
                    </p>
                  </div>
                  <StatusPill status={pillFor(a)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent medical reports" action={{ href: "/patient/records", label: "View all" }}>
          {records === null ? (
            <SkeletonRows rows={2} />
          ) : records.length === 0 ? (
            <EmptyState icon="folder" title="No reports yet" text="Upload reports, scans and X-rays to share them with your doctor.">
              <Link href="/patient/records" className="dash-link mt-3">Add a record <Icon name="arrow" className="h-4 w-4" /></Link>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {records.slice(0, 3).map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <IconTile icon="file" tone="rose" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#0f2f3a]">{r.title}</p>
                    <p className="truncate text-xs text-slate-500">
                      {r.record_type_label} · {fmtDate(r.record_date ?? r.created_at)}
                    </p>
                  </div>
                  <DownloadButton id={r.id} title={r.title} fileName={r.original_name} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        </div>
      </div>
    </DashboardShell>
  );
}


/** Download a record from the dashboard (files need the login token, so it's a button, not a plain link). */
function DownloadButton({ id, title, fileName }: { id: number; title: string; fileName: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      await downloadFile(`/api/records/${id}/file/`, fileName);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button
      type="button"
      onClick={download}
      disabled={busy}
      aria-label={`Download ${title}`}
      title={failed ? "Download failed. Try again." : "Download"}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 transition ${
        failed ? "text-red-600 ring-red-200" : "text-teal-700 ring-slate-200 hover:bg-teal-50"
      }`}
    >
      <Icon name={busy ? "clock" : "download"} className="h-4 w-4" />
    </button>
  );
}

/**
 * "Nearby hospitals": only asks for the device location when the patient clicks, then shows the nearest
 * hospital with its distance and area. Declining is fine: the map lets them pick a city or area by hand.
 */
function NearbyCard() {
  const [state, setState] = useState<"idle" | "locating" | "done" | "denied" | "error">("idle");
  const [count, setCount] = useState(0);
  const [nearest, setNearest] = useState<NearbyHospital | null>(null);

  function locate() {
    if (!("geolocation" in navigator)) return setState("denied");
    setState("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude: lat, longitude: lng } = pos.coords;
          const r = await api<NearbyResponse>(`/api/hospitals/nearby/?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&radius_km=${NEARBY_KM}&limit=50`);
          setCount(r.count);
          setNearest(r.results.find((h) => h.distance_km !== null) ?? null); // results come nearest first
          setState("done");
        } catch {
          setState("error");
        }
      },
      () => setState("denied"),
      { timeout: 10000, maximumAge: 300000 },
    );
  }

  const detail = {
    idle: "See hospitals around you. Your location is only used when you ask.",
    locating: "Finding your location…",
    done: `${count} found within ${NEARBY_KM} km of you`,
    denied: "Location not shared. Search hospitals by city or area instead.",
    error: "Couldn't look up hospitals right now. Try Find hospitals.",
  }[state];

  return (
    <StatCard
      icon="hospital"
      tone="teal"
      label="Nearby hospitals"
      value={state === "done" ? count : undefined}
      detail={detail}
      link={{ href: "/doctors?near=1", label: "See hospitals near me" }}
    >
      {state === "done" && nearest && (
        <Link
          href={`/hospitals/${nearest.id}`}
          className="mt-3 flex items-center gap-3 rounded-xl border border-slate-100 p-2.5 transition hover:border-teal-200 hover:bg-teal-50/40"
        >
          <HospitalThumb />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-slate-500">Nearest to you</span>
            <span className="block truncate text-sm font-[650] text-[#0f2f3a]">{nearest.name}</span>
            <span className="block truncate text-xs text-slate-500">
              {/* An unverified map pin gives an approximate distance, so say "about". */}
              {nearest.location_verified ? "" : "about "}
              {nearest.distance_km!.toFixed(1)} km · {areaOf(nearest)}
              {nearest.is_partner && " · Instant booking"}
            </span>
          </span>
        </Link>
      )}
      {(state === "idle" || state === "locating") && (
        <button onClick={locate} disabled={state === "locating"} className="btn-outline mt-3 self-start px-3 py-1.5 text-xs">
          <Icon name="pin" className="h-4 w-4" />
          {state === "locating" ? "Locating…" : "Use my location"}
        </button>
      )}
    </StatCard>
  );
}
