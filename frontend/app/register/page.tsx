"use client";

import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/api";
import { dashboardFor, useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    password: "",
    role: "patient" as "patient" | "doctor",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await register(form);
      router.push(dashboardFor(user.role));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Create an account" subtitle="Free for patients. Doctors can join to offer instant booking.">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            First name
            <input className="input mt-1" required value={form.first_name} onChange={set("first_name")} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Last name
            <input className="input mt-1" value={form.last_name} onChange={set("last_name")} />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input className="input mt-1" type="email" required value={form.email} onChange={set("email")} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Phone
          <input className="input mt-1" value={form.phone} onChange={set("phone")} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input className="input mt-1" type="password" required minLength={8} value={form.password} onChange={set("password")} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          I am a
          <select className="input mt-1" value={form.role} onChange={set("role")}>
            <option value="patient">Patient</option>
            <option value="doctor">Doctor</option>
          </select>
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Creating account…" : "Sign up"}
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
