"use client";

import Link from "next/link";
import { useState } from "react";
import AuthLayout, { IconInput } from "@/components/AuthLayout";
import { api, ApiError, errorMessage } from "@/lib/api";

/** "Forgot password?": emails a one-time reset link. The answer is the same whether or not the email exists. */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api<{ detail: string }>("/api/auth/password-reset/", { method: "POST", body: JSON.stringify({ email }) });
      setSent(r.detail);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429 ? "Too many requests. Please try again later." : errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Forgot your password?" subtitle="Enter your email and we'll send you a link to choose a new one.">
      {sent ? (
        <div role="status" className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">
          {sent} The link works once and expires in 1 hour. Check your spam folder too.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <IconInput icon="mail" label="Email" type="email" autoComplete="email" placeholder="Email address" required
                     value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary rounded-xl py-3" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-slate-600">
        Remembered it? <Link href="/login" className="font-semibold text-teal-700 hover:underline">Back to login</Link>
      </p>
    </AuthLayout>
  );
}
