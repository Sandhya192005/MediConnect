"use client";

import Link from "next/link";
import AuthLayout from "@/components/AuthLayout";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { errorMessage } from "@/lib/api";
import { dashboardFor, useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await login(email, password);
      router.push(dashboardFor(user.role));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Log in" subtitle="Welcome back. Log in to book and manage your visits.">
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input className="input mt-1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input className="input mt-1" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        No account?{" "}
        <Link href="/register" className="font-semibold text-teal-700 hover:underline">
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
}
