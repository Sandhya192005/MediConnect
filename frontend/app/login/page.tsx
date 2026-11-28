"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import AuthLayout, { IconInput } from "@/components/AuthLayout";
import Icon from "@/components/Icons";
import { errorMessage } from "@/lib/api";
import { dashboardFor, useAuth, WrongRoleError, type LoginTab } from "@/lib/auth";

/**
 * The chosen role must match the account (owner requests 2026-11-17/18): Patient, Doctor, Hospital (the
 * hospital's own account) and Admin (the MediConnect platform team). A mismatch stores nothing and offers to
 * log in as the right role. The server still checks the account on every request; this is about clarity.
 * Layout (owner request 2026-11-28): three role cards; the platform team's sign-in is a small link at the bottom.
 */
type RoleOption = { tab: LoginTab; label: string; icon: string; short: string; hint: string; signup?: { href: string; label: string } };
const ROLES: RoleOption[] = [
  {
    tab: "patient", label: "Patient", icon: "user", short: "Book visits, see records",
    hint: "See your appointments, records and hospitals near you.", signup: { href: "/register?as=patient", label: "Create a patient account" },
  },
  {
    tab: "doctor", label: "Doctor", icon: "stethoscope", short: "Schedule and queue",
    hint: "See today's schedule, your queue and your patients.", signup: { href: "/register?as=doctor", label: "Create a doctor account" },
  },
  {
    tab: "hospital", label: "Hospital", icon: "hospital", short: "Staff and patients",
    hint: "Use your hospital's email to manage its doctors, staff and patients.", signup: { href: "/register?as=hospital", label: "Create a hospital account" },
  },
];
const TEAM: RoleOption = { tab: "admin", label: "Admin", icon: "shield", short: "Platform administration", hint: "For the MediConnect platform team only." };
const ALL = [...ROLES, TEAM];
const optionFor = (tab: LoginTab) => ALL.find((r) => r.tab === tab)!;
const withArticle = (w: string) => `${/^[aeiou]/i.test(w) ? "an" : "a"} ${w.toLowerCase()}`;

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<LoginTab>("patient");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [rightRole, setRightRole] = useState<LoginTab | null>(null); // set when the account belongs to another role
  const [busy, setBusy] = useState(false);
  const current = optionFor(tab);

  function choose(next: LoginTab) {
    setTab(next);
    setError("");
    setRightRole(null);
  }

  async function logIn(as: LoginTab) {
    setBusy(true);
    setError("");
    setRightRole(null);
    try {
      const user = await login(email, password, remember, as);
      router.push(dashboardFor(user.role));
    } catch (err) {
      if (err instanceof WrongRoleError) {
        setError(`This is ${withArticle(optionFor(err.actual).label)} account, not ${withArticle(optionFor(as).label)} account.`);
        setRightRole(err.actual);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title="Welcome back!" subtitle="Sign in to continue to MediConnect.">
      {tab === "admin" ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#00295c] text-white">
              <Icon name="shield" className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-[650] text-[#00295c]">MediConnect team</span>
              <span className="block text-xs text-slate-500">{TEAM.short}</span>
            </span>
          </span>
          <button type="button" onClick={() => choose("patient")} className="text-sm font-medium text-teal-700 hover:underline">
            Back
          </button>
        </div>
      ) : (
        <>
          <p id="role-label" className="text-sm font-[650] text-[#00295c]">Sign in as</p>
          <div role="tablist" aria-labelledby="role-label" className="mt-2 grid grid-cols-3 gap-2.5">
            {ROLES.map((r) => {
              const on = tab === r.tab;
              return (
                <button
                  key={r.tab}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  aria-label={r.label}
                  aria-describedby={`role-${r.tab}`}
                  onClick={() => choose(r.tab)}
                  className={`relative flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition ${
                    on ? "border-teal-600 bg-teal-50 ring-1 ring-teal-600" : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${on ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                    <Icon name={r.icon} className="h-5 w-5" />
                  </span>
                  <span className={`text-sm font-[650] ${on ? "text-[#00295c]" : "text-slate-800"}`}>{r.label}</span>
                  <span id={`role-${r.tab}`} className="text-xs leading-snug text-slate-500">{r.short}</span>
                  {on && <Icon name="check" className="absolute right-2.5 top-2.5 h-4 w-4 text-teal-600" />}
                </button>
              );
            })}
          </div>
        </>
      )}
      <p className="mt-3 text-xs text-slate-500">{current.hint}</p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          logIn(tab);
        }}
        className="mt-5 space-y-4"
      >
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
        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
            {error}
            {rightRole && (
              <button
                type="button"
                onClick={() => {
                  setTab(rightRole);
                  logIn(rightRole);
                }}
                className="mt-1.5 block font-[650] text-[#00295c] underline underline-offset-2 hover:no-underline"
              >
                Log in as {rightRole === "admin" ? "MediConnect team" : optionFor(rightRole).label}
              </button>
            )}
          </div>
        )}
        <button className="btn-primary rounded-xl py-3" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>

      {current.signup && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
          </div>
          <Link href={current.signup.href} className="btn-outline w-full rounded-xl py-3">
            {current.signup.label}
          </Link>
          <p className="mt-6 text-center text-xs text-slate-500">
            Part of the MediConnect team?{" "}
            <button type="button" onClick={() => choose("admin")} className="font-medium text-teal-700 hover:underline">
              Team sign-in
            </button>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
