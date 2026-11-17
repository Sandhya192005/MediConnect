"use client";

import Link from "next/link";
import type { Role } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Appointment, AppointmentStatus } from "@/lib/types";
import Icon from "./Icons";
import RoleGuard from "./RoleGuard";

/**
 * Building blocks for the three dashboards (reference design):
 * a greeting, a row of stat cards, and panels with lists.
 * Planned features show a "Soon" state instead of made-up numbers.
 */
export default function DashboardShell({
  role,
  heading,
  greeting,
  subtitle,
  wave = true,
  badge = false,
  children,
}: {
  role: Role;
  /** The page's h1, e.g. "Patient dashboard" (kept for screen readers and tests). */
  heading: string;
  /** Big friendly line, e.g. "Hello Nila!". Defaults to a time-of-day greeting. */
  greeting?: string;
  subtitle: string;
  /** 👋 after a personal greeting. */
  wave?: boolean;
  /** "Your health, our priority" badge (patient dashboard). */
  badge?: boolean;
  children: React.ReactNode;
}) {
  return (
    <RoleGuard role={role}>
      <Greeting heading={heading} greeting={greeting} subtitle={subtitle} wave={wave} badge={badge} />
      <div className="mt-6 space-y-6">{children}</div>
    </RoleGuard>
  );
}

function Greeting({ heading, greeting, subtitle, wave, badge }: { heading: string; greeting?: string; subtitle: string; wave: boolean; badge: boolean }) {
  const { user } = useAuth();
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = user?.first_name || user?.email || "";
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xs font-[650] uppercase tracking-[0.14em] text-teal-700">{heading}</h1>
        <p className="mt-1 text-2xl font-bold tracking-tight text-[#0f2f3a] sm:text-[1.75rem]">
          {greeting ?? `${hello}, ${name}!`} {wave && <span aria-hidden="true">👋</span>}
        </p>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      {badge && (
        <p className="hidden items-center gap-2 rounded-2xl border border-teal-100 bg-white/80 px-4 py-2.5 text-xs text-slate-500 shadow-sm sm:flex">
          <Icon name="heart" className="h-5 w-5 text-teal-600" />
          <span>
            <span className="block font-[650] text-[#0f2f3a]">Your health</span>
            Our priority
          </span>
        </p>
      )}
    </div>
  );
}

const TONES = {
  teal: "bg-teal-50 text-teal-600",
  blue: "bg-sky-50 text-sky-600",
  orange: "bg-orange-50 text-orange-500",
  indigo: "bg-indigo-50 text-indigo-500",
  rose: "bg-rose-50 text-rose-500",
} as const;
export type Tone = keyof typeof TONES;

export function IconTile({ icon, tone = "teal", size = "md" }: { icon: string; tone?: Tone; size?: "sm" | "md" }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl ${TONES[tone]} ${size === "md" ? "h-12 w-12" : "h-10 w-10"}`}>
      <Icon name={icon} className={size === "md" ? "h-6 w-6" : "h-5 w-5"} />
    </span>
  );
}

/** One stat card: icon, label, big value, a detail line and an optional link. */
export function StatCard({
  icon,
  tone,
  label,
  value,
  detail,
  link,
  soon,
  children,
}: {
  icon: string;
  tone?: Tone;
  label: string;
  value?: React.ReactNode;
  detail?: React.ReactNode;
  link?: { href: string; label: string };
  /** Planned feature: show which phase brings it instead of a number. */
  soon?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={`dash-card flex flex-col p-5 ${soon ? "border-dashed" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <IconTile icon={icon} tone={tone} />
        {soon && <SoonBadge phase={soon} />}
      </div>
      <p className="mt-4 text-sm font-[650] text-[#0f2f3a]">{label}</p>
      {value !== undefined && <p className="mt-1 text-2xl font-bold tracking-tight text-[#0f2f3a]">{value}</p>}
      {detail && <p className="mt-1 text-sm text-slate-500">{detail}</p>}
      {children}
      {link && (
        <Link href={link.href} className="dash-link mt-auto pt-4">
          {link.label} <Icon name="arrow" className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

/** A titled white panel with an optional "View all" style link. */
export function Panel({
  title,
  action,
  className = "",
  children,
}: {
  title: string;
  action?: { href: string; label: string; external?: boolean };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`dash-card p-5 ${className}`} aria-label={title}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base text-[#0f2f3a]">{title}</h2>
        {action &&
          (action.external ? (
            <a href={action.href} target="_blank" rel="noreferrer" className="dash-link text-xs">
              {action.label} <Icon name="external" className="h-3.5 w-3.5" />
            </a>
          ) : (
            <Link href={action.href} className="dash-link text-xs">
              {action.label} <Icon name="arrow" className="h-3.5 w-3.5" />
            </Link>
          ))}
      </div>
      {children}
    </section>
  );
}

/** "Soon" tag for a planned feature; which step of the dashboards plan brings it is in the tooltip. */
export function SoonBadge({ phase }: { phase: string }) {
  return (
    <span title={`Coming soon (${phase})`} className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-500">
      Soon
    </span>
  );
}

/** Friendly empty or "coming soon" state inside a panel. */
export function EmptyState({ icon, title, text, children }: { icon: string; title: string; text?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-xl bg-slate-50/80 px-4 py-8 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
        <Icon name={icon} />
      </span>
      <p className="mt-3 text-sm font-[650] text-[#0f2f3a]">{title}</p>
      {text && <p className="mt-1 max-w-xs text-xs text-slate-500">{text}</p>}
      {children}
    </div>
  );
}

/** Loading placeholder rows. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-11 animate-pulse rounded-xl bg-slate-100" />
      ))}
    </div>
  );
}

/** Coloured status pill used in dashboard lists (reference: Completed / In progress / Waiting / Confirmed). */
export type PillStatus = AppointmentStatus | "waiting" | "in_consultation";
const PILL: Record<PillStatus, { label: string; cls: string }> = {
  booked: { label: "Booked", cls: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  confirmed: { label: "Confirmed", cls: "bg-teal-50 text-teal-700 ring-teal-200" },
  waiting: { label: "Waiting", cls: "bg-amber-50 text-amber-700 ring-amber-200" },
  in_consultation: { label: "In progress", cls: "bg-sky-50 text-sky-700 ring-sky-200" },
  completed: { label: "Completed", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  cancelled: { label: "Cancelled", cls: "bg-slate-100 text-slate-500 ring-slate-200" },
};

/** The pill for an appointment: its place in today's queue if it has one, otherwise its booking status. */
export function pillFor(a: Appointment): PillStatus {
  if (a.queue_status === "waiting" || a.queue_status === "in_consultation") return a.queue_status;
  return a.status;
}

export function StatusPill({ status }: { status: PillStatus }) {
  const p = PILL[status];
  return <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-[650] ring-1 ${p.cls}`}>{p.label}</span>;
}
