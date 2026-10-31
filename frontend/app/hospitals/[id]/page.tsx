"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import LocationBadge from "@/components/LocationBadge";
import { api, errorMessage } from "@/lib/api";
import type { Doctor, Hospital } from "@/lib/types";

const HospitalMap = dynamic(() => import("@/components/HospitalMap"), { ssr: false });

export default function HospitalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [hospital, setHospital] = useState<Hospital | null>(null);
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Hospital>(`/api/hospitals/${id}/`).then(setHospital).catch((e) => setError(errorMessage(e)));
    api<Doctor[]>(`/api/doctors/?hospital=${id}`).then(setDoctors);
  }, [id]);

  if (!hospital) return <p className="text-slate-500">{error || "Loading…"}</p>;
  const hasPin = hospital.latitude != null && hospital.longitude != null;

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <section className="space-y-4 lg:col-span-2">
        <Link href="/hospitals" className="text-sm text-teal-700">← Hospitals near you</Link>
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-2xl font-bold">{hospital.name}</h1>
          <p className="mt-1 text-slate-600">{[hospital.address, hospital.city, hospital.state].filter(Boolean).join(", ")}</p>
          {hospital.phone && <p className="mt-1 text-sm text-slate-600">📞 {hospital.phone}</p>}
          {hospital.website && (
            <a href={hospital.website} target="_blank" rel="noopener noreferrer" className="mt-1 block text-sm text-teal-700 underline">
              Website
            </a>
          )}
          <div className="mt-3"><LocationBadge verified={hospital.location_verified} /></div>
          {hospital.departments.length > 0 && (
            <p className="mt-3 text-sm text-slate-500">{hospital.departments.map((d) => d.name).join(" · ")}</p>
          )}
        </div>
        {hasPin && (
          <>
            <HospitalMap hospitals={[hospital]} height={260} />
            <a
              href={`https://www.openstreetmap.org/directions?to=${hospital.latitude},${hospital.longitude}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-sm text-teal-700 underline"
            >
              Get directions (OpenStreetMap)
            </a>
          </>
        )}
      </section>

      <section className="lg:col-span-3">
        <h2 className="mb-3 text-lg font-semibold">Doctors at this hospital</h2>
        {doctors === null ? (
          <p className="text-slate-500">Loading…</p>
        ) : doctors.length === 0 ? (
          <p className="text-slate-500">No doctors are taking bookings here yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {doctors.map((d) => (
              <Link key={d.id} href={`/doctors/${d.id}`} className="rounded-xl border border-slate-200 bg-white p-4 hover:border-teal-400">
                <p className="font-semibold">Dr. {d.name}</p>
                <p className="text-sm text-teal-700">{d.specialization}</p>
                <p className="mt-1 text-sm text-slate-500">{d.experience_years} yrs · ₹{Number(d.fee).toFixed(0)}</p>
                <p className="mt-2 text-sm font-medium text-teal-700">Book →</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
