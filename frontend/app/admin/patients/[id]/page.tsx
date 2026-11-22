"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, IconTile, Panel, SkeletonRows, StatusPill } from "@/components/DashboardShell";
import HealthDetailsForm from "@/components/HealthDetailsForm";
import Icon from "@/components/Icons";
import PatientPayments from "@/components/PatientPayments";
import { HealthSummary } from "@/components/PatientRecordsLookup";
import RecordList from "@/components/RecordList";
import RecordUploadForm from "@/components/RecordUploadForm";
import RoleGuard from "@/components/RoleGuard";
import { TreatmentNoteView } from "@/components/TreatmentNotes";
import { api, ApiError, errorMessage } from "@/lib/api";
import { fmtDateTime, type HospitalPatientPage, type PatientDetails } from "@/lib/types";

/**
 * One patient in the hospital's Patient management (owner request 2026-11-21): their details (both the
 * hospital and the patient can edit them), medical records (upload; delete your own uploads — the patient
 * keeps their copy), visits at this hospital and doctors' treatment notes. Opening it is logged for the patient.
 */
export default function HospitalPatientPageView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const base = `/api/hospital-admin/patients/${encodeURIComponent(id)}/`;
  const [data, setData] = useState<HospitalPatientPage | null>(null);
  const [state, setState] = useState<"loading" | "done" | "notfound" | "error">("loading");
  const [editing, setEditing] = useState(false);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<HospitalPatientPage>(base)
      .then((d) => { setData(d); setState("done"); })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setState("notfound");
        else { setError(e instanceof ApiError && e.status === 429 ? "Too many lookups. Please wait a minute." : errorMessage(e)); setState("error"); }
      });
  }, [base]);

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("added")) setFlash("Patient added to your patients.");
    if (params.get("edit")) setEditing(true); // the list's "Edit" button (2026-11-22)
  }, [load]);

  async function addToList() {
    try {
      await api("/api/hospital-admin/patients/add/", { method: "POST", body: JSON.stringify({ patient_id: id }) });
      setFlash("Patient added to your patients.");
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function removeFromList() {
    if (!window.confirm("Remove this patient from your patients? Their MediConnect account and records stay.")) return;
    try {
      await api(base, { method: "DELETE" });
      router.push("/admin/patients");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const p = data?.patient;
  return (
    <RoleGuard role="hospital">
      <Link href="/admin/patients" className="dash-link mb-3">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Patient management
      </Link>
      {flash && <p role="status" className="mb-4 rounded-xl bg-teal-50 px-4 py-2 text-sm text-teal-800">{flash}</p>}
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {state === "loading" && <SkeletonRows rows={5} />}
      {state === "notfound" && <EmptyState icon="users" title={`No patient with ID ${id}`} text="Check the ID with the patient: it looks like P483920." />}

      {state === "done" && data && p && (
        <div className="space-y-6">
          {/* ---- Who ---- */}
          <section aria-label="Patient" className="dash-card flex flex-wrap items-center gap-4 p-5">
            <IconTile icon="user" tone="teal" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-[#00295c]">{p.name}</h1>
              <p className="text-sm text-slate-500">
                Patient ID <span className="font-mono">{p.patient_id}</span>
                {data.details.age !== null && ` · ${data.details.age} years`}
                {data.details.gender && ` · ${data.details.gender[0].toUpperCase()}${data.details.gender.slice(1)}`}
              </p>
              <p className="text-sm text-slate-500">
                {p.phone || "No phone"} · {p.email ?? "No email"} · {p.has_login ? "Uses the MediConnect app" : "No app login yet"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!p.in_list && <button onClick={addToList} className="btn-solid rounded-xl px-4 py-2 text-sm">Add to my patients</button>}
              {p.in_list && !editing && (
                <button onClick={() => { setEditing(true); setFlash(""); }} className="btn-solid rounded-xl px-4 py-2 text-sm">
                  <Icon name="pencil" className="h-4 w-4" /> Edit details
                </button>
              )}
              {p.added_by_you && <button onClick={removeFromList} className="btn-ghost px-3 py-2 text-sm">Remove from my patients</button>}
            </div>
            <p className="flex w-full items-center gap-2 text-xs text-amber-800">
              <Icon name="eye" className="h-4 w-4" /> Opening this page is shown in the patient&apos;s access log.
            </p>
          </section>

          {/* ---- Details ---- */}
          {editing ? (
            <EditDetails data={data} base={base}
                         onCancel={() => setEditing(false)}
                         onSaved={() => { setEditing(false); setFlash("Details saved."); load(); }} />
          ) : (
            <HealthSummary d={data.details} />
          )}

          {/* ---- Medical records ---- */}
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Panel title={`Medical records (${data.records.length})`}>
                <p className="-mt-2 mb-3 text-xs text-slate-500">
                  The patient&apos;s own uploads and yours. What you upload also appears in the patient&apos;s records; deleting removes only your copy.
                </p>
                <RecordList records={data.records} viewer="hospital"
                            onDelete={async (r) => { await api(`${base}records/${r.id}/`, { method: "DELETE" }); load(); }}
                            empty={{ title: "No records yet", text: p.in_list ? "Upload reports, scans or X-rays with the form." : undefined }} />
              </Panel>
            </div>
            {p.in_list ? (
              <RecordUploadForm endpoint={`${base}records/`} title="Upload a record" onUploaded={load} />
            ) : (
              <Panel title="Upload a record"><p className="text-sm text-slate-500">Add this patient to your patients to upload records or edit details.</p></Panel>
            )}
          </div>

          {/* ---- Payments (2026-11-21) ---- */}
          <PatientPayments patientId={p.patient_id} visits={data.visits} canAdd={p.in_list} />

          {/* ---- Visits and notes ---- */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title={`Visits at your hospital (${data.visits.length})`}>
              {data.visits.length === 0 ? (
                <EmptyState icon="calendar" title="No visits booked here yet" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.visits.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <span className="font-[650] text-[#00295c]">{fmtDateTime(v.start)}</span>
                      <span className="min-w-0 flex-1 text-slate-600">{v.doctor_name}{v.reason ? ` · ${v.reason}` : ""}</span>
                      <StatusPill status={v.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={`Treatment notes (${data.notes.length})`}>
              {data.notes.length === 0 ? (
                <EmptyState icon="file" title="No treatment notes yet" text="Doctors write them after a visit on MediConnect." />
              ) : (
                <div className="space-y-3">{data.notes.map((n) => <TreatmentNoteView key={n.id} note={n} />)}</div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </RoleGuard>
  );
}

/** Name, phone, email (only if the patient has none) and the health details form, saved together. */
function EditDetails({ data, base, onCancel, onSaved }: { data: HospitalPatientPage; base: string; onCancel: () => void; onSaved: () => void }) {
  const p = data.patient;
  const [who, setWho] = useState({ first_name: p.first_name, last_name: p.last_name, phone: p.phone, email: p.email ?? "" });
  const set = (k: keyof typeof who) => (e: React.ChangeEvent<HTMLInputElement>) => setWho({ ...who, [k]: e.target.value });
  const label = "block text-sm font-medium text-slate-700";

  const personal = (
    <fieldset>
      <legend className="mb-2 text-sm font-[650] text-[#00295c]">Personal information</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={label}>First name<input className="input mt-1" required maxLength={150} value={who.first_name} onChange={set("first_name")} /></label>
        <label className={label}>Last name<input className="input mt-1" maxLength={150} value={who.last_name} onChange={set("last_name")} /></label>
        <label className={label}>Phone<input className="input mt-1" type="tel" maxLength={20} value={who.phone} onChange={set("phone")} /></label>
        {p.can_edit_email && (
          <label className={label}>Email <span className="font-normal text-slate-400">(optional)</span>
            <input className="input mt-1" type="email" value={who.email} onChange={set("email")} />
          </label>
        )}
      </div>
      {!p.can_edit_email && p.email !== null && <p className="mt-2 text-xs text-slate-500">Email: {p.email} (the patient uses the app, so they change it in their account)</p>}
    </fieldset>
  );

  return (
    <HealthDetailsForm
      personal={personal}
      load={() => Promise.resolve(data.details)}
      beforeSave={async () => {
        const body: Record<string, string> = { first_name: who.first_name, last_name: who.last_name, phone: who.phone };
        if (p.can_edit_email && who.email.trim() && who.email.trim() !== (p.email ?? "")) body.email = who.email.trim();
        await api(base, { method: "PATCH", body: JSON.stringify(body) });
      }}
      save={async (body) => (await api<HospitalPatientPage>(base, { method: "PATCH", body: JSON.stringify(body) })).details as PatientDetails}
      onDone={onSaved}
      onCancel={onCancel}
    />
  );
}
