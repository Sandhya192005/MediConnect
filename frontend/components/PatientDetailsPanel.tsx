"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { PatientLookup } from "@/lib/types";
import { SkeletonRows } from "./DashboardShell";
import Icon from "./Icons";
import { HealthSummary } from "./PatientRecordsLookup";
import RecordList from "./RecordList";
import { TreatmentNoteView } from "./TreatmentNotes";

/**
 * Patient Details for the patient in front of the doctor (reference design, Part 3): name, patient ID,
 * age and gender, the health summary (allergies first), recent reports and earlier treatment notes.
 * It uses the same patient-ID lookup as the records page, so opening it is logged for the patient.
 */
export default function PatientDetailsPanel({ patientId, recordsHref, refreshKey = 0 }: {
  patientId: string;
  recordsHref: string;
  /** Change it to reload (e.g. after the doctor saves a note). */
  refreshKey?: number;
}) {
  const [p, setP] = useState<PatientLookup | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stale = false;
    api<PatientLookup>(`/api/records/patients/${encodeURIComponent(patientId)}/`)
      .then((r) => !stale && setP(r))
      .catch((e) => !stale && setError(errorMessage(e)));
    return () => {
      stale = true;
    };
  }, [patientId, refreshKey]);

  if (error) return <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>;
  if (!p) return <div className="dash-card p-5"><SkeletonRows rows={4} /></div>;

  const d = p.details;
  const facts = [d.age !== null ? `${d.age} years` : null, d.gender ? d.gender[0].toUpperCase() + d.gender.slice(1) : null].filter(Boolean);

  return (
    <section aria-label="Patient details" className="space-y-4">
      <div className="dash-card flex flex-wrap items-center gap-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-[650] uppercase tracking-wider text-slate-500">Patient details</p>
          <p className="text-lg font-bold text-[#0f2f3a]">{p.patient.name}</p>
          <p className="text-sm text-slate-500">
            Patient ID <span className="font-mono">{p.patient.patient_id}</span>
            {facts.length > 0 && ` · ${facts.join(" · ")}`}
          </p>
        </div>
        <Link href={recordsHref} className="btn-outline px-3 py-2 text-xs"><Icon name="file" className="h-4 w-4" /> All records</Link>
      </div>

      <HealthSummary d={d} />

      <div className="dash-card p-5">
        <h3 className="mb-3 text-sm font-[650] text-[#0f2f3a]">Reports and scans ({p.records.length})</h3>
        <RecordList records={p.records.slice(0, 3)} empty={{ title: "No reports uploaded yet" }} />
        {p.records.length > 3 && <Link href={recordsHref} className="dash-link mt-2 text-xs">See all {p.records.length}</Link>}
      </div>

      <div className="dash-card p-5">
        <h3 className="mb-3 text-sm font-[650] text-[#0f2f3a]">Earlier visit notes ({p.notes.length})</h3>
        {p.notes.length === 0 ? (
          <p className="text-sm text-slate-500">No treatment notes yet.</p>
        ) : (
          <div className="space-y-3">{p.notes.slice(0, 3).map((n) => <TreatmentNoteView key={n.id} note={n} compact />)}</div>
        )}
        {p.notes.length > 3 && <Link href={recordsHref} className="dash-link mt-2 text-xs">See all {p.notes.length}</Link>}
      </div>
    </section>
  );
}
