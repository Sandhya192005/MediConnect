"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Panel } from "@/components/DashboardShell";
import HealthDetailsForm from "@/components/HealthDetailsForm";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { bloodGroupLabel, bmiBand, CONDITIONS, fmtDate, type PatientDetails } from "@/lib/types";

const label = "block text-sm font-medium text-slate-700";
const ROLE_LABEL: Record<string, string> = { patient: "Patient", doctor: "Doctor", admin: "Admin" };

/**
 * Profile & settings for every role (owner's reference design, 2026-11-18): a clean read-only profile with an
 * Edit button. Edit opens the forms; Save or Cancel goes back to the profile.
 */
export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const isPatient = user?.role === "patient";
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [details, setDetails] = useState<PatientDetails | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    if (!isPatient) return;
    let stale = false; // a late answer must not replace newer saved details
    api<PatientDetails>("/api/auth/me/patient/")
      .then((d) => !stale && setDetails((prev) => prev ?? d))
      .catch((e) => !stale && setError(errorMessage(e)));
    return () => {
      stale = true;
    };
  }, [isPatient]);

  const backToView = (message = "") => {
    setFlash(message);
    setMode("view");
    window.scrollTo({ top: 0 });
  };

  return (
    <RoleGuard>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h1 className="page-title">Profile &amp; settings</h1>
          <p className="page-subtitle text-sm">
            {mode === "edit" ? "Change your details, then save." : isPatient ? "Your details, health details and password." : "Your details and password."}
          </p>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        {mode === "view" ? (
          <ProfileView details={details} flash={flash} onEdit={() => { setFlash(""); setMode("edit"); }} />
        ) : isPatient ? (
          <EditPatientProfile
            onCancel={() => backToView()}
            onDone={async (d) => {
              setDetails(d);
              await refresh();
              backToView("Profile saved.");
            }}
          />
        ) : (
          <EditPersonalOnly onCancel={() => backToView()} onDone={() => backToView("Profile saved.")} />
        )}
      </div>
    </RoleGuard>
  );
}

// ---------------------------------------------------------------- view

function ProfileView({ details: d, flash, onEdit }: { details: PatientDetails | null; flash: string; onEdit: () => void }) {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  if (!user) return null;

  const name = `${user.first_name} ${user.last_name}`.trim() || user.email;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const isPatient = user.role === "patient";

  async function copyId() {
    if (!d) return;
    try {
      await navigator.clipboard.writeText(d.patient_id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the ID is on screen anyway */
    }
  }

  const conditions = d ? [...d.conditions.map((c) => CONDITIONS[c] ?? c), ...(d.conditions_other ? [d.conditions_other] : [])] : [];

  return (
    <div className="space-y-4">
      {flash && <p role="status" className="rounded-xl bg-teal-50 px-4 py-2 text-sm text-teal-800">{flash}</p>}

      {/* ---- Header card ---- */}
      <section aria-label="Profile" className="dash-card relative overflow-hidden">
        <div className="h-24 bg-teal-600/10" />
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit profile"
          title="Edit profile"
          className="absolute right-4 top-4 flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 text-sm font-[650] text-teal-700 shadow-sm ring-1 ring-slate-200 hover:bg-teal-50"
        >
          <Icon name="pencil" className="h-4 w-4" /> Edit
        </button>
        <div className="-mt-12 flex flex-col items-center px-5 pb-6 text-center">
          <span aria-hidden="true" className="flex h-24 w-24 items-center justify-center rounded-full bg-[#00295c] text-3xl font-[650] text-white ring-4 ring-white">
            {initials || "?"}
          </span>
          <h2 className="mt-3 text-xl font-bold text-[#00295c]">{name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {ROLE_LABEL[user.role] ?? user.role}
            {isPatient && d && <> · Patient ID <span className="font-mono text-[#00295c]" data-testid="profile-patient-id">{d.patient_id}</span></>}
          </p>

          <div className="mt-5 flex justify-center gap-6">
            <Tile icon="phone" label="Phone" href={user.phone ? `tel:${user.phone.replace(/\s+/g, "")}` : undefined} />
            <Tile icon="mail" label="Email" href={`mailto:${user.email}`} />
            {isPatient && d && <Tile icon={copied ? "check" : "copy"} label={copied ? "Copied" : "Copy ID"} onClick={copyId} />}
          </div>

          {isPatient && d && (
            <div className="mt-6 w-full max-w-sm text-left">
              <div className="flex items-baseline justify-between text-sm">
                <p id="completeness-label" className="font-[650] text-[#00295c]">Profile {d.completeness}% complete</p>
                {d.completeness < 100 && <button type="button" onClick={onEdit} className="dash-link text-xs">Complete it</button>}
              </div>
              <div role="progressbar" aria-labelledby="completeness-label" aria-valuenow={d.completeness} aria-valuemin={0} aria-valuemax={100}
                   className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-teal-600" style={{ width: `${d.completeness}%` }} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ---- Sections ---- */}
      <Section title={user.role === "hospital" ? "Account information" : "Personal information"}>
        <Row k={user.role === "hospital" ? "Account name" : "Full name"} v={`${user.first_name} ${user.last_name}`.trim()} />
        <Row k={user.role === "hospital" ? "Hospital email (login)" : "Email"} v={user.email} />
        <Row k="Phone" v={user.phone} />
        {isPatient && d && (
          <>
            {/* Given once when the account is made; it never changes (owner request 2026-11-21). */}
            <div className="grid grid-cols-[8.5rem_1fr] gap-4 py-2.5 text-sm sm:grid-cols-[12rem_1fr]">
              <dt className="text-slate-500">Patient ID</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-[650] text-[#00295c]" data-testid="patient-id-row">{d.patient_id}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  <Icon name="lock" className="h-3 w-3" /> Can&apos;t be changed
                </span>
              </dd>
            </div>
            <Row k="Date of birth" v={d.date_of_birth ? `${fmtDate(d.date_of_birth)}${d.age !== null ? ` (${d.age} years)` : ""}` : ""} />
            <Row k="Gender" v={d.gender ? d.gender[0].toUpperCase() + d.gender.slice(1) : ""} />
          </>
        )}
      </Section>

      {isPatient && d && (
        <>
          <Section title="Body">
            <Row k="Height" v={d.height_cm ? `${d.height_cm} cm` : ""} />
            <Row k="Weight" v={d.weight_kg ? `${d.weight_kg} kg${d.weight_updated_on ? ` · updated ${fmtDate(d.weight_updated_on)}` : ""}` : ""} />
            <Row k="BMI" v={d.bmi ? `${d.bmi} · ${bmiBand(d.bmi)}` : ""} />
            <Row k="Blood group" v={d.blood_group ? bloodGroupLabel(d.blood_group) : ""} />
          </Section>

          <Section title="Medical">
            <Row k="Allergies" v={d.allergies || (d.no_known_allergies ? "No known allergies" : "")} warn={!!d.allergies} />
            <Row k="Long-term conditions" v={conditions.join(", ") || (d.no_conditions ? "None" : "")} />
            <Row k="Current medicines" v={d.current_medicines || (d.no_current_medicines ? "None" : "")} />
          </Section>

          <Section title="Emergency contact">
            <Row k="Name" v={d.emergency_contact_name} />
            <Row k="Relation" v={d.emergency_contact_relation} />
            <Row k="Phone" v={d.emergency_contact_phone} />
          </Section>
        </>
      )}

      <Section title="Security">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="grid flex-1 grid-cols-[8.5rem_1fr] gap-4 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-slate-500">Password</dt>
            <dd className="tracking-widest text-[#00295c]">••••••••</dd>
          </div>
          {!changingPassword && (
            <button type="button" onClick={() => setChangingPassword(true)} className="dash-link shrink-0 text-sm">
              Change password
            </button>
          )}
        </div>
      </Section>
      {changingPassword && <PasswordForm onClose={() => setChangingPassword(false)} />}

      <p className="pt-2 text-center text-xs text-slate-400">
        Need to change your email or account type? <Link href="/support" className="dash-link text-xs">Contact support</Link>
      </p>
    </div>
  );
}

function Tile({ icon, label, href, onClick }: { icon: string; label: string; href?: string; onClick?: () => void }) {
  const inner = (
    <>
      <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${href || onClick ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-300"}`}>
        <Icon name={icon} className="h-5 w-5" />
      </span>
      <span className={`text-sm ${href || onClick ? "text-slate-700" : "text-slate-400"}`}>{label}</span>
    </>
  );
  const cls = "flex w-20 flex-col items-center gap-2";
  if (href) return <a href={href} className={`${cls} hover:opacity-80`}>{inner}</a>;
  if (onClick) return <button type="button" onClick={onClick} className={`${cls} hover:opacity-80`}>{inner}</button>;
  return <span className={cls} title={`No ${label.toLowerCase()} added`}>{inner}</span>; // nothing to call yet
}

/** A card with an UPPERCASE heading and label → value rows, like the reference design. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="dash-card px-5 py-4">
      <h2 className="mb-2 text-xs font-[650] uppercase tracking-wider text-slate-500">{title}</h2>
      <dl className="divide-y divide-slate-100">{children}</dl>
    </section>
  );
}

function Row({ k, v, warn = false }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-4 py-2.5 text-sm sm:grid-cols-[12rem_1fr]">
      <dt className="text-slate-500">{k}</dt>
      <dd className={`min-w-0 whitespace-pre-line break-words ${warn ? "font-[650] text-red-700" : "text-[#00295c]"}`}>
        {v || <span className="text-slate-400">Not added</span>}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------- edit

function usePersonalFields() {
  const { user } = useAuth();
  const [p, setP] = useState({ first_name: user?.first_name ?? "", last_name: user?.last_name ?? "", phone: user?.phone ?? "" });
  // A hospital account has one name (the hospital's), not a person's first and last name.
  const isHospital = user?.role === "hospital";
  const fields = (
    <fieldset>
      <legend className="mb-2 text-sm font-[650] text-[#00295c]">{isHospital ? "Account information" : "Personal information"}</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={`${label} ${isHospital ? "sm:col-span-2" : ""}`}>{isHospital ? "Account name" : "First name"}<input className="input mt-1" required maxLength={150} value={p.first_name} onChange={(e) => setP((x) => ({ ...x, first_name: e.target.value }))} /></label>
        {!isHospital && <label className={label}>Last name<input className="input mt-1" maxLength={150} value={p.last_name} onChange={(e) => setP((x) => ({ ...x, last_name: e.target.value }))} /></label>}
        <label className={label}>Phone<input className="input mt-1" type="tel" maxLength={20} value={p.phone} onChange={(e) => setP((x) => ({ ...x, phone: e.target.value }))} /></label>
      </div>
      {user?.patient_id && (
        <label className={`${label} mt-3 block sm:w-1/3`}>
          Patient ID
          <input className="input mt-1 cursor-not-allowed bg-slate-100 font-mono text-slate-500" value={user.patient_id} readOnly disabled
                 aria-describedby="patient-id-note" />
          <span id="patient-id-note" className="mt-1 block text-xs font-normal text-slate-500">Given by MediConnect; it can&apos;t be changed.</span>
        </label>
      )}
      <p className="mt-2 text-xs text-slate-500">Email: {user?.email} (can&apos;t be changed here)</p>
    </fieldset>
  );
  const save = () => api("/api/auth/me/", { method: "PATCH", body: JSON.stringify(p) }).then(() => undefined);
  return { fields, save };
}

/** Patients: name and phone plus health details, in one form with one Save. */
function EditPatientProfile({ onDone, onCancel }: { onDone: (d: PatientDetails) => void; onCancel: () => void }) {
  const personal = usePersonalFields();
  return <HealthDetailsForm personal={personal.fields} beforeSave={personal.save} onDone={onDone} onCancel={onCancel} />;
}

/** Doctors and admins: name and phone only. */
function EditPersonalOnly({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { refresh } = useAuth();
  const personal = usePersonalFields();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await personal.save();
      await refresh();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Edit profile">
      <form onSubmit={submit} className="space-y-4">
        {personal.fields}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" onClick={onCancel} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </Panel>
  );
}

// ---------------------------------------------------------------- password

function PasswordForm({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ current_password: "", new_password: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setOk("");
    setError("");
    if (f.new_password !== f.confirm) return setError("The two new passwords don't match.");
    setBusy(true);
    try {
      await api("/api/auth/change-password/", {
        method: "POST",
        body: JSON.stringify({ current_password: f.current_password, new_password: f.new_password }),
      });
      setF({ current_password: "", new_password: "", confirm: "" });
      setOk("Your password has been changed.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Change password">
      <form onSubmit={submit} className="space-y-3">
        <label className={label}>Current password<input className="input mt-1" type="password" autoComplete="current-password" required value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} /></label>
        <label className={label}>New password<input className="input mt-1" type="password" autoComplete="new-password" required minLength={8} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} /></label>
        <label className={label}>Repeat new password<input className="input mt-1" type="password" autoComplete="new-password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
        <p className="text-xs text-slate-500">At least 8 characters, not too similar to your name or email, and not a common password.</p>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {ok && <p role="status" className="text-sm text-teal-700">{ok}</p>}
        <div className="flex flex-wrap gap-3">
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
            {ok ? "Close" : "Cancel"}
          </button>
        </div>
      </form>
    </Panel>
  );
}
