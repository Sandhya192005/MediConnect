"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/DashboardShell";
import { api, errorMessage } from "@/lib/api";
import {
  BLOOD_GROUPS, bloodGroupLabel, bmiBand, CONDITIONS, fmtDate, isoDate,
  type ConditionKey, type PatientDetails,
} from "@/lib/types";

const label = "block text-sm font-medium text-slate-700";
const legend = "mb-2 text-sm font-[650] text-[#0f2f3a]";
const check = "flex items-center gap-2 text-sm text-slate-700";

/** The form keeps numbers as text while typing; they're converted when saving. */
type Form = Omit<PatientDetails, "height_cm" | "weight_kg"> & { height_cm: string; weight_kg: string };

const toForm = (d: PatientDetails): Form => ({
  ...d,
  height_cm: d.height_cm?.toString() ?? "",
  weight_kg: d.weight_kg?.toString() ?? "",
});

/**
 * A patient's health details on Profile & settings: age (from date of birth), gender, height, weight, blood
 * group, allergies, long-term conditions, current medicines and an emergency contact. All optional.
 * Doctors and admins see them (read-only) when they open the patient's records with the patient ID.
 */
export default function HealthDetailsForm() {
  const [saved, setSaved] = useState<PatientDetails | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<PatientDetails>("/api/auth/me/patient/")
      .then((d) => {
        setSaved(d);
        setF(toForm(d));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);

  if (!f || !saved) {
    return (
      <Panel title="Health details">
        {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : <p className="text-sm text-slate-500">Loading…</p>}
      </Panel>
    );
  }

  // Updates build on the latest state (not the `f` of this render), so quick successive changes are never lost.
  const update = (fn: (prev: Form) => Partial<Form>) => setF((prev) => (prev ? { ...prev, ...fn(prev) } : prev));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => update(() => ({ [key]: value }) as Partial<Form>);
  const toggleCondition = (c: ConditionKey) =>
    update((p) => ({ conditions: p.conditions.includes(c) ? p.conditions.filter((x) => x !== c) : [...p.conditions, c] }));

  // Live BMI while typing, so the patient sees it before saving.
  const h = Number(f.height_cm), w = Number(f.weight_kg);
  const bmi = h >= 30 && h <= 250 && w >= 1 && w <= 300 ? Math.round((w / (h / 100) ** 2) * 10) / 10 : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true);
    setOk("");
    setError("");
    try {
      const d = await api<PatientDetails>("/api/auth/me/patient/", {
        method: "PATCH",
        body: JSON.stringify({
          date_of_birth: f.date_of_birth || null,
          gender: f.gender,
          height_cm: f.height_cm ? Number(f.height_cm) : null,
          weight_kg: f.weight_kg ? Number(f.weight_kg) : null,
          blood_group: f.blood_group,
          allergies: f.allergies,
          no_known_allergies: f.no_known_allergies,
          conditions: f.conditions,
          conditions_other: f.conditions_other,
          no_conditions: f.no_conditions,
          current_medicines: f.current_medicines,
          no_current_medicines: f.no_current_medicines,
          emergency_contact_name: f.emergency_contact_name,
          emergency_contact_relation: f.emergency_contact_relation,
          emergency_contact_phone: f.emergency_contact_phone,
        }),
      });
      setSaved(d);
      setF(toForm(d));
      setOk("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Health details">
      <p className="-mt-2 mb-4 text-xs text-slate-500">
        All optional. Doctors see these when they open your records with your patient ID, so they can treat you safely.
      </p>

      <div className="mb-5 rounded-xl bg-slate-50 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <p className="text-slate-600">
            Patient ID <span className="font-mono font-[650] text-[#0f2f3a]">{saved.patient_id}</span>
            {saved.age !== null && ` · Age ${saved.age}`}
          </p>
          <p id="completeness-label" className="font-[650] text-[#0f2f3a]">Profile {saved.completeness}% complete</p>
        </div>
        <div
          role="progressbar"
          aria-labelledby="completeness-label"
          aria-valuenow={saved.completeness}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200"
        >
          <div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${saved.completeness}%` }} />
        </div>
      </div>

      <form onSubmit={submit} className="space-y-6">
        {/* ---- Body ---- */}
        <fieldset>
          <legend className={legend}>About you</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className={label}>
              Date of birth
              <input className="input mt-1" type="date" min="1900-01-01" max={isoDate(new Date())} value={f.date_of_birth ?? ""}
                     onChange={(e) => set("date_of_birth", e.target.value || null)} />
            </label>
            <label className={label}>
              Gender
              <select className="input mt-1" value={f.gender} onChange={(e) => set("gender", e.target.value as Form["gender"])}>
                <option value="">Prefer not to say</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className={label}>
              Blood group
              <select className="input mt-1" value={f.blood_group} onChange={(e) => set("blood_group", e.target.value as Form["blood_group"])}>
                <option value="">Not given</option>
                {BLOOD_GROUPS.map((g) => <option key={g} value={g}>{bloodGroupLabel(g)}</option>)}
                <option value="unknown">Don&apos;t know</option>
              </select>
            </label>
            <label className={label}>
              Height (cm)
              <input className="input mt-1" type="number" inputMode="numeric" min={30} max={250} step={1} placeholder="e.g. 165"
                     value={f.height_cm} onChange={(e) => set("height_cm", e.target.value)} />
            </label>
            <label className={label}>
              Weight (kg)
              <input className="input mt-1" type="number" inputMode="decimal" min={1} max={300} step={0.1} placeholder="e.g. 62.5"
                     value={f.weight_kg} onChange={(e) => set("weight_kg", e.target.value)} />
              {saved.weight_updated_on && <span className="mt-1 block text-xs font-normal text-slate-400">Updated {fmtDate(saved.weight_updated_on)}</span>}
            </label>
            <div className={label}>
              BMI
              <p className="mt-1 flex h-[42px] items-center text-sm text-slate-600" aria-live="polite">
                {bmi === null ? "Enter height and weight" : <span><span className="font-[650] text-[#0f2f3a]">{bmi}</span> · {bmiBand(bmi)}</span>}
              </p>
            </div>
          </div>
        </fieldset>

        {/* ---- Allergies ---- */}
        <fieldset>
          <legend className={legend}>Allergies</legend>
          <label className={label}>
            Medicines, food or anything else you&apos;re allergic to
            <textarea className="input mt-1 min-h-[72px]" maxLength={1000} disabled={f.no_known_allergies}
                      placeholder="e.g. Penicillin (rash), peanuts" value={f.allergies} onChange={(e) => set("allergies", e.target.value)} />
          </label>
          <label className={`${check} mt-2`}>
            <input type="checkbox" checked={f.no_known_allergies}
                   onChange={(e) => { const on = e.target.checked; update((p) => ({ no_known_allergies: on, allergies: on ? "" : p.allergies })); }} />
            I have no known allergies
          </label>
        </fieldset>

        {/* ---- Conditions ---- */}
        <fieldset>
          <legend className={legend}>Long-term conditions</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(CONDITIONS) as ConditionKey[]).map((c) => (
              <label key={c} className={check}>
                <input type="checkbox" disabled={f.no_conditions} checked={f.conditions.includes(c)} onChange={() => toggleCondition(c)} />
                {CONDITIONS[c]}
              </label>
            ))}
          </div>
          <label className={`${label} mt-3`}>
            Other conditions
            <input className="input mt-1" maxLength={300} disabled={f.no_conditions} placeholder="e.g. Migraine"
                   value={f.conditions_other} onChange={(e) => set("conditions_other", e.target.value)} />
          </label>
          <label className={`${check} mt-2`}>
            <input type="checkbox" checked={f.no_conditions}
                   onChange={(e) => { const on = e.target.checked; update(() => ({ no_conditions: on, ...(on ? { conditions: [], conditions_other: "" } : {}) })); }} />
            None of these
          </label>
        </fieldset>

        {/* ---- Medicines ---- */}
        <fieldset>
          <legend className={legend}>Current medicines</legend>
          <label className={label}>
            Medicines you take regularly, with the dose if you know it
            <textarea className="input mt-1 min-h-[72px]" maxLength={1000} disabled={f.no_current_medicines}
                      placeholder="e.g. Metformin 500 mg twice a day" value={f.current_medicines}
                      onChange={(e) => set("current_medicines", e.target.value)} />
          </label>
          <label className={`${check} mt-2`}>
            <input type="checkbox" checked={f.no_current_medicines}
                   onChange={(e) => { const on = e.target.checked; update((p) => ({ no_current_medicines: on, current_medicines: on ? "" : p.current_medicines })); }} />
            I&apos;m not taking any medicines
          </label>
        </fieldset>

        {/* ---- Emergency contact ---- */}
        <fieldset>
          <legend className={legend}>Emergency contact</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className={label}>
              Name
              <input className="input mt-1" maxLength={120} autoComplete="off" value={f.emergency_contact_name}
                     onChange={(e) => set("emergency_contact_name", e.target.value)} />
            </label>
            <label className={label}>
              Relation
              <input className="input mt-1" maxLength={60} placeholder="e.g. Mother" value={f.emergency_contact_relation}
                     onChange={(e) => set("emergency_contact_relation", e.target.value)} />
            </label>
            <label className={label}>
              Phone
              <input className="input mt-1" type="tel" maxLength={20} autoComplete="off" value={f.emergency_contact_phone}
                     onChange={(e) => set("emergency_contact_phone", e.target.value)} />
            </label>
          </div>
        </fieldset>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {ok && <p role="status" className="text-sm text-teal-700">{ok}</p>}
        <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : "Save health details"}</button>
      </form>
    </Panel>
  );
}
