"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { bloodGroupLabel, bmiBand, CONDITIONS, fmtDate, timeAgo, type PatientDetails, type PatientLookup } from "@/lib/types";
import { EmptyState, IconTile, Panel, SkeletonRows } from "./DashboardShell";
import Icon from "./Icons";
import RecordList from "./RecordList";
import { TreatmentNoteView } from "./TreatmentNotes";

/**
 * Open a patient's records by patient ID (doctors and admins). The patient ID is a general ID:
 * any doctor or admin can open any patient's records with it (owner decision 2026-11-17).
 * The ID lives in the URL (?id=P123456), so links, the back button and the dashboard's quick access work.
 * The server decides who may see what, and logs every view for the patient.
 */
export default function PatientRecordsLookup({ basePath }: { basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = (params.get("id") ?? "").trim().toUpperCase();
  const [input, setInput] = useState(current);
  const [result, setResult] = useState<PatientLookup | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "notfound" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setInput(current);
    if (!current) {
      setState("idle");
      return;
    }
    setState("loading");
    api<PatientLookup>(`/api/records/patients/${encodeURIComponent(current)}/`)
      .then((r) => {
        setResult(r);
        setState("done");
      })
      .catch((e) => {
        setResult(null);
        if (e instanceof ApiError && e.status === 404) setState("notfound");
        else {
          setError(e instanceof ApiError && e.status === 429 ? "Too many lookups. Please wait a minute and try again." : errorMessage(e));
          setState("error");
        }
      });
  }, [current]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = input.trim().toUpperCase();
    if (id) router.push(`${basePath}?id=${encodeURIComponent(id)}`);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} role="search" className="dash-card flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm font-medium text-slate-700">
          Patient ID
          <input
            className="input mt-1 font-mono uppercase"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. P483920"
            maxLength={12}
            autoFocus
          />
        </label>
        <button className="btn-solid rounded-xl px-5 py-2.5">
          <Icon name="search" className="h-4 w-4" /> Open records
        </button>
      </form>

      {state === "loading" && <Panel title="Looking up…"><SkeletonRows rows={3} /></Panel>}
      {state === "notfound" && (
        <EmptyState
          icon="users"
          title={`No patient with ID ${current}`}
          text="Check the ID with the patient: it looks like P483920."
        />
      )}
      {state === "error" && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {state === "done" && result && (
        <>
          <section className="dash-card flex flex-wrap items-center gap-4 p-5" aria-label="Patient">
            <IconTile icon="user" tone="teal" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-[#00295c]">{result.patient.name}</p>
              <p className="text-sm text-slate-500">
                Patient ID <span className="font-mono">{result.patient.patient_id}</span>
                {result.details.age !== null && ` · ${result.details.age} years`}
                {result.details.gender && ` · ${result.details.gender[0].toUpperCase()}${result.details.gender.slice(1)}`}
              </p>
            </div>
            <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Icon name="eye" className="h-4 w-4" /> The patient can see that you opened their records (shown in their &apos;Who opened your records&apos; list).
            </p>
          </section>
          <HealthSummary d={result.details} />
          <Panel title={`Records (${result.records.length})`}>
            <RecordList records={result.records} empty={{ title: "This patient hasn't uploaded any records yet" }} />
          </Panel>
          <Panel title={`Visit notes (${result.notes.length})`}>
            {result.notes.length === 0 ? (
              <EmptyState icon="file" title="No treatment notes yet" text="Doctors write them after a visit on MediConnect." />
            ) : (
              <div className="space-y-3">{result.notes.map((n) => <TreatmentNoteView key={n.id} note={n} />)}</div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

/** "Not given" when the patient left a question empty: different from "None", which is an answer. */
const NOT_GIVEN = <span className="text-slate-400">Not given</span>;

/**
 * The patient's health details for the doctor or admin, read-only. Allergies come first and in red,
 * because they're what can hurt the patient if missed.
 */
export function HealthSummary({ d }: { d: PatientDetails }) {
  const conditions = [...d.conditions.map((c) => CONDITIONS[c] ?? c), ...(d.conditions_other ? [d.conditions_other] : [])];
  const hasAllergies = d.allergies.trim() !== "";
  const rows: [string, React.ReactNode][] = [
    ["Height", d.height_cm ? `${d.height_cm} cm` : NOT_GIVEN],
    ["Weight", d.weight_kg ? <>{d.weight_kg} kg{d.weight_updated_on && <span className="text-slate-400"> · {fmtDate(d.weight_updated_on)}</span>}</> : NOT_GIVEN],
    ["BMI", d.bmi ? `${d.bmi} · ${bmiBand(d.bmi)}` : NOT_GIVEN],
    ["Blood group", d.blood_group ? bloodGroupLabel(d.blood_group) : NOT_GIVEN],
    ["Long-term conditions", conditions.length ? conditions.join(", ") : d.no_conditions ? "None" : NOT_GIVEN],
    ["Current medicines", d.current_medicines ? <span className="whitespace-pre-line">{d.current_medicines}</span> : d.no_current_medicines ? "None" : NOT_GIVEN],
    ["Emergency contact", d.emergency_contact_name || d.emergency_contact_phone
      ? [d.emergency_contact_name, d.emergency_contact_relation && `(${d.emergency_contact_relation})`, d.emergency_contact_phone].filter(Boolean).join(" ")
      : NOT_GIVEN],
  ];

  return (
    <Panel title="Health details">
      <p className="-mt-2 mb-4 text-xs text-slate-500">
        Filled in by the patient{d.health_updated_at ? `, last updated ${timeAgo(d.health_updated_at)}` : ""}. Confirm important details with them.
      </p>
      <div
        className={`mb-4 flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${
          hasAllergies ? "border border-red-200 bg-red-50 text-red-800" : "bg-slate-50 text-slate-700"
        }`}
      >
        <Icon name="siren" className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-[650]">Allergies: </span>
          {hasAllergies ? <span className="whitespace-pre-line">{d.allergies}</span> : d.no_known_allergies ? "No known allergies" : "Not given"}
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wider text-slate-400">{k}</dt>
            <dd className="mt-0.5 text-[#00295c]">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}
