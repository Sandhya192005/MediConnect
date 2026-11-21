"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/DashboardShell";
import { api, errorMessage } from "@/lib/api";
import {
  BLOOD_GROUPS, bloodGroupLabel, bmiBand, CONDITIONS, fmtDate, isoDate,
  type ConditionKey, type PatientDetails,
} from "@/lib/types";

const label = "block text-sm font-medium text-slate-700";
const legend = "mb-2 text-sm font-[650] text-[#00295c]";
const check = "flex items-center gap-2 text-sm text-slate-700";

/** "" = not answered yet, which is different from "no" (the patient said they have none). */
type Answer = "" | "yes" | "no";

/** The form keeps numbers as text while typing; they're converted when saving. */
type Form = Omit<PatientDetails, "height_cm" | "weight_kg"> & {
  height_cm: string;
  weight_kg: string;
  allergies_answer: Answer;
  conditions_answer: Answer;
  medicines_answer: Answer;
};

const answer = (none: boolean, some: boolean): Answer => (none ? "no" : some ? "yes" : "");

const toForm = (d: PatientDetails): Form => ({
  ...d,
  height_cm: d.height_cm?.toString() ?? "",
  weight_kg: d.weight_kg?.toString() ?? "",
  allergies_answer: answer(d.no_known_allergies, !!d.allergies),
  conditions_answer: answer(d.no_conditions, d.conditions.length > 0 || !!d.conditions_other),
  medicines_answer: answer(d.no_current_medicines, !!d.current_medicines),
});

/** What a "Yes" still needs before it can be saved (a "Yes" with nothing listed tells a doctor nothing). */
function missingDetails(f: Form): string {
  if (f.allergies_answer === "yes" && !f.allergies.trim()) return "Please write what you're allergic to, or choose No.";
  if (f.conditions_answer === "yes" && f.conditions.length === 0 && !f.conditions_other.trim())
    return "Please tick or write your long-term conditions, or choose No.";
  if (f.medicines_answer === "yes" && !f.current_medicines.trim()) return "Please write which medicines you take, or choose No.";
  return "";
}

/**
 * A patient's health details on Profile & settings: age (from date of birth), gender, height, weight, blood
 * group, allergies, long-term conditions, current medicines and an emergency contact. All optional.
 * Doctors and admins see them (read-only) when they open the patient's records with the patient ID.
 */
export default function HealthDetailsForm({ personal, beforeSave, onDone, onCancel }: {
  /** Extra fields shown first in the same form (name and phone on Edit profile). */
  personal?: React.ReactNode;
  /** Saves those extra fields; runs before the health details are saved. Throws to stop the save. */
  beforeSave?: () => Promise<void>;
  /** After a successful save (e.g. back to the profile view). */
  onDone?: (d: PatientDetails) => void;
  onCancel?: () => void;
} = {}) {
  const [saved, setSaved] = useState<PatientDetails | null>(null);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    // React (in development) runs this twice; a late answer must never overwrite what the patient has already
    // typed. So: ignore answers after cleanup, and only fill the form if it's still empty.
    let stale = false;
    api<PatientDetails>("/api/auth/me/patient/")
      .then((d) => {
        if (stale) return;
        setSaved(d);
        setF((prev) => prev ?? toForm(d));
      })
      .catch((e) => !stale && setError(errorMessage(e)));
    return () => {
      stale = true;
    };
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
    setOk("");
    setError(missingDetails(f));
    if (missingDetails(f)) return;
    setBusy(true);
    // Only a "Yes" sends the details; "No" sends the "none" flag and clears them.
    const yes = (a: Answer) => a === "yes";
    try {
      await beforeSave?.();
      const d = await api<PatientDetails>("/api/auth/me/patient/", {
        method: "PATCH",
        body: JSON.stringify({
          date_of_birth: f.date_of_birth || null,
          gender: f.gender,
          height_cm: f.height_cm ? Number(f.height_cm) : null,
          weight_kg: f.weight_kg ? Number(f.weight_kg) : null,
          blood_group: f.blood_group,
          allergies: yes(f.allergies_answer) ? f.allergies : "",
          no_known_allergies: f.allergies_answer === "no",
          conditions: yes(f.conditions_answer) ? f.conditions : [],
          conditions_other: yes(f.conditions_answer) ? f.conditions_other : "",
          no_conditions: f.conditions_answer === "no",
          current_medicines: yes(f.medicines_answer) ? f.current_medicines : "",
          no_current_medicines: f.medicines_answer === "no",
          emergency_contact_name: f.emergency_contact_name,
          emergency_contact_relation: f.emergency_contact_relation,
          emergency_contact_phone: f.emergency_contact_phone,
        }),
      });
      setSaved(d);
      setF(toForm(d));
      setOk("Saved.");
      onDone?.(d);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={personal ? "Edit profile" : "Health details"}>
      <p className="-mt-2 mb-4 text-xs text-slate-500">
        Health details are optional. Doctors see them when they open your records with your patient ID, so they can treat you safely.
      </p>

      <form onSubmit={submit} className="space-y-6">
        {personal}

        {/* ---- Body ---- */}
        <fieldset>
          <legend className={legend}>Body</legend>
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
                {bmi === null ? "Enter height and weight" : <span><span className="font-[650] text-[#00295c]">{bmi}</span> · {bmiBand(bmi)}</span>}
              </p>
            </div>
          </div>
        </fieldset>

        {/* ---- Allergies, conditions, medicines: a clear Yes / No question each; Yes opens the details. ---- */}
        <YesNo question="Do you have any allergies?" name="allergies" value={f.allergies_answer}
               onChange={(v) => set("allergies_answer", v)}>
          <label className={label}>
            What are you allergic to? Medicines, food or anything else
            <textarea className="input mt-1 min-h-[72px]" maxLength={1000} placeholder="e.g. Penicillin (rash), peanuts"
                      value={f.allergies} onChange={(e) => set("allergies", e.target.value)} />
          </label>
        </YesNo>

        <YesNo question="Do you have any long-term conditions?" name="conditions" value={f.conditions_answer}
               onChange={(v) => set("conditions_answer", v)}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(Object.keys(CONDITIONS) as ConditionKey[]).map((c) => (
              <label key={c} className={check}>
                <input type="checkbox" checked={f.conditions.includes(c)} onChange={() => toggleCondition(c)} />
                {CONDITIONS[c]}
              </label>
            ))}
          </div>
          <label className={`${label} mt-3`}>
            Other conditions
            <input className="input mt-1" maxLength={300} placeholder="e.g. Migraine"
                   value={f.conditions_other} onChange={(e) => set("conditions_other", e.target.value)} />
          </label>
        </YesNo>

        <YesNo question="Do you take any medicines regularly?" name="medicines" value={f.medicines_answer}
               onChange={(v) => set("medicines_answer", v)}>
          <label className={label}>
            Which medicines? With the dose if you know it
            <textarea className="input mt-1 min-h-[72px]" maxLength={1000} placeholder="e.g. Metformin 500 mg twice a day"
                      value={f.current_medicines} onChange={(e) => set("current_medicines", e.target.value)} />
          </label>
        </YesNo>

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
        <div className="flex flex-wrap gap-3">
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
              Cancel
            </button>
          )}
        </div>
      </form>
    </Panel>
  );
}

/**
 * A Yes / No question. The details (children) only appear after "Yes", so "No" is one click and a patient
 * with nothing to report never has to look for a hidden "none" checkbox.
 */
function YesNo({ question, name, value, onChange, children }: {
  question: string;
  name: string;
  value: Answer;
  onChange: (v: Answer) => void;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className={legend}>{question}</legend>
      <div role="radiogroup" aria-label={question} className="flex gap-2">
        {(["yes", "no"] as const).map((v) => (
          <label
            key={v}
            className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-600 ${
              value === v ? "border-teal-600 bg-teal-50 font-[650] text-teal-800" : "border-slate-200 text-slate-700 hover:border-slate-300"
            }`}
          >
            <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="accent-teal-600" />
            {v === "yes" ? "Yes" : "No"}
          </label>
        ))}
      </div>
      {value === "yes" && <div className="mt-3">{children}</div>}
    </fieldset>
  );
}
