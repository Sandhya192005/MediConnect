"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthLayout, { IconInput } from "@/components/AuthLayout";
import Icon from "@/components/Icons";
import { errorMessage, type Role } from "@/lib/api";
import { dashboardFor, useAuth, WrongRoleError } from "@/lib/auth";

/**
 * The tab must match the account: a patient account can only log in on the Patient tab, and so on
 * (owner request 2026-11-17). A mismatch shows which tab to use and stores nothing.
 * The server still checks the role on every request; the tabs are about clarity.
 */
const TABS: { role: Role; label: string; hint: string }[] = [
  { role: "patient", label: "Patient", hint: "See your appointments and hospitals near you." },
  { role: "doctor", label: "Doctor", hint: "See today's schedule and your patients." },
  { role: "admin", label: "Admin", hint: "Manage your hospital, staff and requests." },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Role>("patient");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = TABS.find((t) => t.role === tab)!;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await login(email, password, remember, tab);
      router.push(dashboardFor(user.role));
    } catch (err) {
      if (err instanceof WrongRoleError) {
        const right = TABS.find((t) => t.role === err.actual)!.label;
        setError(`This is a ${right.toLowerCase()} account, not a ${current.label.toLowerCase()} account. Choose the ${right} tab to log in.`);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back!" subtitle="Sign in to continue to MediConnect.">
      <div role="tablist" aria-label="I am signing in as" className="grid grid-cols-3 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.role}
            type="button"
            role="tab"
            aria-selected={tab === t.role}
            onClick={() => setTab(t.role)}
            className={`-mb-px border-b-2 pb-2.5 text-sm transition ${
              tab === t.role ? "border-teal-600 font-[650] text-teal-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">{current.hint}</p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4">
        <IconInput
          icon="mail"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="Email address"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <IconInput
          icon="lock"
          label="Password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <Icon name={showPassword ? "eyeOff" : "eye"} className="h-[18px] w-[18px]" />
            </button>
          }
        />
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600" title="Unticked: you're logged out when the browser closes">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 accent-teal-600"
            />
            Remember me
          </label>
          <Link href="/forgot-password" className="text-sm font-medium text-teal-700 hover:underline">Forgot password?</Link>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary rounded-xl py-3" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>

      {tab === "admin" ? (
        <p className="mt-6 text-center text-xs text-slate-500">Admin accounts are created by MediConnect. Ask your platform administrator for access.</p>
      ) : (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
          </div>
          <Link href="/register" className="btn-outline w-full rounded-xl py-3">
            Create an account
          </Link>
        </>
      )}
    </AuthLayout>
  );
}
