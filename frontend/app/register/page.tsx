"use client";

import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import Icon from "@/components/Icons";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/api";
import { dashboardFor, useAuth } from "@/lib/auth";

type Kind = "patient" | "doctor" | "hospital";

const KIND_HINT: Record<Kind, string> = {
  patient: "Find hospitals and doctors, book appointments and keep your medical records.",
  doctor: "Show your working hours so patients can book you, and see your queue and patients.",
  hospital:
    "Manage your hospital on MediConnect: doctors, nurses, staff, salaries and patient records. Patients won't see your hospital until you connect it with MediConnect.",
};

/** Sign-up for patients, doctors and hospitals (a hospital = its manager's login + a private hospital workspace). */
export default function RegisterPage() {
  const { register, registerHospital } = useAuth();
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("patient");
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    password: "",
    hospital_name: "",
    hospital_city: "",
    hospital_phone: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // /register?as=hospital (from the login page's Hospital tab) opens with Hospital chosen.
  useEffect(() => {
    const as = new URLSearchParams(window.location.search).get("as");
    if (as === "patient" || as === "doctor" || as === "hospital") setKind(as);
  }, []);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const person = { first_name: form.first_name, last_name: form.last_name, email: form.email, phone: form.phone, password: form.password };
    try {
      const user =
        kind === "hospital"
          ? await registerHospital({ ...person, hospital_name: form.hospital_name, hospital_city: form.hospital_city, hospital_phone: form.hospital_phone })
          : await register({ ...person, role: kind });
      router.push(dashboardFor(user.role));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "block text-sm font-medium text-slate-700";

  return (
    <AuthLayout title="Create an account" subtitle="Free for patients. Doctors and hospitals can join too.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className={label}>
            I am a
            <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              <option value="patient">Patient</option>
              <option value="doctor">Doctor</option>
              <option value="hospital">Hospital (I manage a hospital)</option>
            </select>
          </label>
          <p className="mt-1.5 text-xs text-slate-500">{KIND_HINT[kind]}</p>
        </div>

        {kind === "hospital" && (
          <fieldset className="space-y-3 rounded-2xl bg-slate-50 p-4">
            <legend className="sr-only">Your hospital</legend>
            <p className="text-sm font-[650] text-[#00295c]">Your hospital</p>
            <label className={label}>
              Hospital name
              <input className="input mt-1" required minLength={3} maxLength={200} value={form.hospital_name} onChange={set("hospital_name")} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={label}>
                City
                <input className="input mt-1" required maxLength={100} value={form.hospital_city} onChange={set("hospital_city")} />
              </label>
              <label className={label}>
                Hospital phone
                <input className="input mt-1" type="tel" maxLength={30} value={form.hospital_phone} onChange={set("hospital_phone")} />
              </label>
            </div>
            <p className="pt-1 text-sm font-[650] text-[#00295c]">You, the hospital&apos;s manager</p>
          </fieldset>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            First name
            <input className="input mt-1" required value={form.first_name} onChange={set("first_name")} />
          </label>
          <label className={label}>
            Last name
            <input className="input mt-1" value={form.last_name} onChange={set("last_name")} />
          </label>
        </div>
        <label className={label}>
          Email
          <input className="input mt-1" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </label>
        <label className={label}>
          Phone
          <input className="input mt-1" type="tel" value={form.phone} onChange={set("phone")} />
        </label>
        <div>
          <label htmlFor="register-password" className={label}>Password</label>
          <div className="relative mt-1">
            <input
              id="register-password"
              className="input pr-11"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              value={form.password}
              onChange={set("password")}
            />
            {/* Outside the <label>, so the button doesn't become part of the input's name. */}
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <Icon name={showPassword ? "eyeOff" : "eye"} className="h-[18px] w-[18px]" />
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">At least 8 characters, not a common password.</p>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Creating account…" : kind === "hospital" ? "Create hospital account" : "Sign up"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already registered?{" "}
        <Link href="/login" className="font-semibold text-teal-700 hover:underline">
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
