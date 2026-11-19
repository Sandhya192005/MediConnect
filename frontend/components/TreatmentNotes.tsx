"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, isoDate, type Medicine, type TreatmentNote } from "@/lib/types";
import Icon from "./Icons";

/**
 * Treatment notes (reference design, Part 3; owner decision 2026-11-19): the visit's doctor writes them;
 * the patient and any doctor or admin who opens the patient's records read them (that lookup is logged).
 */

/** One note: diagnosis, medicines, advice and follow-up. */
export function TreatmentNoteView({ note, compact = false }: { note: TreatmentNote; compact?: boolean }) {
  return (
    <article aria-label={`Treatment note: ${note.diagnosis}`} className="rounded-xl border border-slate-100 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-[650] text-[#00295c]">{note.diagnosis}</p>
        <p className="text-xs text-slate-500">
          {fmtDate(note.visit_start)} · {note.doctor_name}{note.hospital_name && `, ${note.hospital_name}`}
          {note.edited && " · edited"}
        </p>
      </div>
      {note.medicines.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-[650] uppercase tracking-wider text-slate-500">Medicines</p>
          <ul className="mt-1 space-y-1 text-sm text-slate-700">
            {note.medicines.map((m, i) => (
              <li key={i} className="flex gap-2">
                <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" />
                <span>
                  <span className="font-[650]">{m.name}</span>
                  {[m.dose, m.frequency, m.days ? `${m.days} day${m.days === 1 ? "" : "s"}` : ""].filter(Boolean).map((x) => ` · ${x}`).join("")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {note.advice && !compact && <p className="mt-3 whitespace-pre-line text-sm text-slate-700"><span className="font-[650]">Advice: </span>{note.advice}</p>}
      {note.follow_up_on && <p className="mt-2 text-sm text-teal-800"><span className="font-[650]">Follow-up:</span> {fmtDate(note.follow_up_on)}</p>}
    </article>
  );
}

const EMPTY_MED: Medicine = { name: "", dose: "", frequency: "", days: null };

/**
 * The doctor's form for a visit's note: new, or editing their own (`noteId`). Medicines are rows the doctor
 * adds and removes; empty rows are dropped when saving.
 */
export function TreatmentNoteForm({ appointmentId, noteId, onSaved, onCancel }: {
  appointmentId: number;
  noteId: number | null;
  onSaved: (note: TreatmentNote) => void;
  onCancel?: () => void;
}) {
  const [f, setF] = useState({ diagnosis: "", advice: "", follow_up_on: "" });
  const [meds, setMeds] = useState<Medicine[]>([{ ...EMPTY_MED }]);
  const [loading, setLoading] = useState(!!noteId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!noteId) return;
    api<TreatmentNote>(`/api/records/notes/${noteId}/`)
      .then((n) => {
        setF({ diagnosis: n.diagnosis, advice: n.advice, follow_up_on: n.follow_up_on ?? "" });
        setMeds(n.medicines.length ? n.medicines : [{ ...EMPTY_MED }]);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [noteId]);

  const setMed = (i: number, patch: Partial<Medicine>) => setMeds((list) => list.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body = {
      appointment: appointmentId,
      diagnosis: f.diagnosis,
      advice: f.advice,
      follow_up_on: f.follow_up_on || null,
      medicines: meds.filter((m) => m.name.trim()).map((m) => ({ ...m, name: m.name.trim(), days: m.days || null })),
    };
    try {
      const note = await api<TreatmentNote>(noteId ? `/api/records/notes/${noteId}/` : "/api/records/notes/", {
        method: noteId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved(note);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "block text-sm font-medium text-slate-700";
  if (loading) return <p className="text-sm text-slate-500">Loading the note…</p>;

  return (
    <form onSubmit={save} aria-label="Treatment note" className="space-y-4">
      <label className={label}>
        Diagnosis
        <input className="input mt-1" required maxLength={300} placeholder="e.g. Viral fever" value={f.diagnosis}
               onChange={(e) => setF({ ...f, diagnosis: e.target.value })} />
      </label>

      <fieldset>
        <legend className={label}>Medicines</legend>
        {/* Column headings: the hints inside the boxes disappear once something is typed. */}
        <div aria-hidden="true" className="mt-1 hidden gap-2 px-2 text-xs text-slate-400 sm:grid sm:grid-cols-[2fr_1fr_1.4fr_0.8fr_auto]">
          <span>Name and strength</span><span>Dose</span><span>How often</span><span>Days</span><span className="w-8" />
        </div>
        <div className="mt-1 space-y-2">
          {meds.map((m, i) => (
            <div key={i} className="grid gap-2 rounded-xl bg-slate-50 p-2 sm:grid-cols-[2fr_1fr_1.4fr_0.8fr_auto]">
              <input className="input" aria-label={`Medicine ${i + 1} name`} placeholder="Name and strength" maxLength={100}
                     value={m.name} onChange={(e) => setMed(i, { name: e.target.value })} />
              <input className="input" aria-label={`Medicine ${i + 1} dose`} placeholder="Dose, e.g. 1 tablet" maxLength={60}
                     value={m.dose} onChange={(e) => setMed(i, { dose: e.target.value })} />
              <input className="input" aria-label={`Medicine ${i + 1} how often`} placeholder="How often" maxLength={60}
                     value={m.frequency} onChange={(e) => setMed(i, { frequency: e.target.value })} />
              <input className="input" aria-label={`Medicine ${i + 1} days`} placeholder="Days" type="number" min={1} max={365}
                     value={m.days ?? ""} onChange={(e) => setMed(i, { days: e.target.value ? Number(e.target.value) : null })} />
              <button type="button" onClick={() => setMeds((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [{ ...EMPTY_MED }]))}
                      className="rounded-lg px-2 text-slate-400 hover:bg-white hover:text-red-600" aria-label={`Remove medicine ${i + 1}`}>
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        {meds.length < 20 && (
          <button type="button" onClick={() => setMeds((list) => [...list, { ...EMPTY_MED }])} className="btn-ghost mt-2 px-3 py-1.5 text-xs">
            + Add medicine
          </button>
        )}
      </fieldset>

      <label className={label}>
        Advice
        <textarea className="input mt-1 min-h-[80px]" maxLength={2000} placeholder="e.g. Rest, plenty of fluids, come back if the fever lasts over 3 days"
                  value={f.advice} onChange={(e) => setF({ ...f, advice: e.target.value })} />
      </label>
      <label className={`${label} max-w-xs`}>
        Follow-up date <span className="font-normal text-slate-400">(optional)</span>
        <input className="input mt-1" type="date" min={isoDate(new Date())} value={f.follow_up_on}
               onChange={(e) => setF({ ...f, follow_up_on: e.target.value })} />
      </label>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : noteId ? "Save changes" : "Save note"}</button>
        {onCancel && <button type="button" onClick={onCancel} className="btn-ghost px-4 py-2.5">Cancel</button>}
      </div>
      <p className="text-xs text-slate-500">The patient sees this note in their account, and so does any doctor who opens their records.</p>
    </form>
  );
}
