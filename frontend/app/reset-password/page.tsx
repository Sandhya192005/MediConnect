"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import AuthLayout, { IconInput } from "@/components/AuthLayout";
import { api, ApiError, errorMessage } from "@/lib/api";

/** The page the reset email links to (?uid=…&token=…): choose a new password. */
export default function ResetPasswordPage() {
  return (
    <AuthLayout title="Choose a new password" subtitle="Pick a password you don't use anywhere else.">
      <Suspense>
        <ResetForm />
      </Suspense>
    </AuthLayout>
  );
}

function ResetForm() {
  const params = useSearchParams();
  const uid = params.get("uid") ?? "";
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!uid || !token) {
    return (
      <p role="alert" className="text-sm text-red-600">
        This link is incomplete. <Link href="/forgot-password" className="font-semibold underline">Ask for a new one</Link>.
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      await api("/api/auth/password-reset/confirm/", { method: "POST", body: JSON.stringify({ uid, token, new_password: password }) });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429
        ? "Too many attempts. Please try again later."
        : errorMessage(err).replace(/^new_password: /, ""));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="space-y-4">
        <p className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900">Your password has been reset.</p>
        <Link href="/login" className="btn-primary rounded-xl py-3">Log in</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <IconInput icon="lock" label="New password" type="password" autoComplete="new-password" placeholder="New password" required minLength={8}
                 value={password} onChange={(e) => setPassword(e.target.value)} />
      <IconInput icon="lock" label="Repeat new password" type="password" autoComplete="new-password" placeholder="Repeat new password" required
                 value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error} {error.includes("expired") && <Link href="/forgot-password" className="font-semibold underline">Ask for a new link</Link>}
        </p>
      )}
      <button className="btn-primary rounded-xl py-3" disabled={busy}>{busy ? "Saving…" : "Set new password"}</button>
    </form>
  );
}
