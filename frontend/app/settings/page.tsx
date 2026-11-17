"use client";

import { useEffect, useState } from "react";
import { Panel } from "@/components/DashboardShell";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isoDate } from "@/lib/types";

type PatientDetails = { patient_id: string; date_of_birth: string | null; gender: "" | "female" | "male" | "other"; age: number | null };

const label = "block text-sm font-medium text-slate-700";

/** Profile & settings for every role: name and phone, a patient's details, and change password. */
export default function SettingsPage() {
  const { user } = useAuth();
  return (
    <RoleGuard>
      <div className="mb-6">
        <h1 className="page-title">Profile &amp; settings</h1>
        <p className="page-subtitle text-sm">Your details and password.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <ProfileForm />
          {user?.role === "patient" && <PatientDetailsForm />}
        </div>
        <PasswordForm />
      </div>
    </RoleGuard>
  );
}

function Status({ ok, error }: { ok: string; error: string }) {
  if (error) return <p role="alert" className="text-sm text-red-600">{error}</p>;
  if (ok) return <p role="status" className="text-sm text-teal-700">{ok}</p>;
  return null;
}

function ProfileForm() {
  const { user, refresh } = useAuth();
  const [f, setF] = useState({ first_name: user?.first_name ?? "", last_name: user?.last_name ?? "", phone: user?.phone ?? "" });
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setOk("");
    setError("");
    try {
      await api("/api/auth/me/", { method: "PATCH", body: JSON.stringify(f) });
      await refresh();
      setOk("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Your profile">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className={label}>First name<input className="input mt-1" required maxLength={150} value={f.first_name} onChange={(e) => setF({ ...f, first_name: e.target.value })} /></label>
          <label className={label}>Last name<input className="input mt-1" maxLength={150} value={f.last_name} onChange={(e) => setF({ ...f, last_name: e.target.value })} /></label>
        </div>
        <label className={label}>Phone<input className="input mt-1" maxLength={20} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        <p className="text-xs text-slate-500">Email: {user?.email} · Account type: {user?.role}</p>
        <Status ok={ok} error={error} />
        <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
      </form>
    </Panel>
  );
}

function PatientDetailsForm() {
  const [d, setD] = useState<PatientDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<PatientDetails>("/api/auth/me/patient/").then(setD).catch((e) => setError(errorMessage(e)));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d) return;
    setBusy(true);
    setOk("");
    setError("");
    try {
      setD(await api<PatientDetails>("/api/auth/me/patient/", {
        method: "PATCH",
        body: JSON.stringify({ date_of_birth: d.date_of_birth || null, gender: d.gender }),
      }));
      setOk("Saved.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Health details">
      <p className="-mt-2 mb-4 text-xs text-slate-500">Doctors see these with your records. Both are optional.</p>
      {d && (
        <form onSubmit={submit} className="space-y-3">
          <p className="text-sm text-slate-600">Patient ID <span className="font-mono font-[650] text-[#0f2f3a]">{d.patient_id}</span>{d.age !== null && ` · Age ${d.age}`}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className={label}>
              Date of birth
              <input className="input mt-1" type="date" max={isoDate(new Date())} value={d.date_of_birth ?? ""} onChange={(e) => setD({ ...d, date_of_birth: e.target.value || null })} />
            </label>
            <label className={label}>
              Gender
              <select className="input mt-1" value={d.gender} onChange={(e) => setD({ ...d, gender: e.target.value as PatientDetails["gender"] })}>
                <option value="">Prefer not to say</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <Status ok={ok} error={error} />
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : "Save health details"}</button>
        </form>
      )}
      {!d && <Status ok="" error={error} />}
    </Panel>
  );
}

function PasswordForm() {
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
        <Status ok={ok} error={error} />
        <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Changing…" : "Change password"}</button>
      </form>
    </Panel>
  );
}
