"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DashboardShell, { EmptyState, IconTile, Panel, SkeletonRows, StatCard } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import StaffChart from "@/components/StaffChart";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtRupees, isoDate, timeAgo, type Appointment, type AppointmentRequest, type Hospital, type HospitalOverview } from "@/lib/types";

type Counts = { partners: number; awaiting: Hospital[]; doctors: number; today: number };

/** Hospital admins see their hospital; the platform admin (Django superuser) sees approvals and requests. */
export default function AdminDashboard() {
  return (
    <RoleGuard role="admin">
      <Pick />
    </RoleGuard>
  );
}

function Pick() {
  const { user } = useAuth();
  if (user?.admin_hospital) return <HospitalDashboard />;
  if (user?.is_platform_admin) return <PlatformDashboard />;
  return (
    <div className="mx-auto max-w-lg py-16">
      <h1 className="sr-only">Admin dashboard</h1>
      <EmptyState
        icon="hospital"
        title="Your account isn't linked to a hospital yet"
        text="A MediConnect platform administrator links each hospital admin to their hospital. Please contact them."
      />
    </div>
  );
}

function HospitalDashboard() {
  const [o, setO] = useState<HospitalOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<HospitalOverview>("/api/hospital-admin/overview/").then(setO).catch((e) => setError(errorMessage(e)));
  }, []);

  const n = (v: number | undefined) => (o ? v : "…");

  return (
    <DashboardShell
      role="admin"
      heading="Admin dashboard"
      greeting="Hospital overview"
      subtitle={o ? `${o.hospital.name}${o.hospital.city ? `, ${o.hospital.city}` : ""} · Manage your hospital operations efficiently.` : "Manage your hospital operations efficiently."}
      wave={false}
    >
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon="stethoscope"
          tone="blue"
          label="Total doctors"
          value={n(o?.counts.doctors)}
          detail={o?.counts.doctor_accounts_without_record ? `${o.counts.doctor_accounts_without_record} doctor account(s) without a staff record` : "On staff today"}
          link={{ href: "/admin/doctors", label: "Manage doctors" }}
        />
        <StatCard icon="nurse" tone="rose" label="Total nurses" value={n(o?.counts.nurses)} detail="On staff today" link={{ href: "/admin/nurses", label: "Manage nurses" }} />
        <StatCard icon="users" tone="teal" label="Total patients" value={n(o?.counts.patients)} detail="With a visit booked or done here" link={{ href: "/admin/patients", label: "View patients" }} />
        <StatCard
          icon="calendar"
          tone="indigo"
          label="Today's appointments"
          value={n(o?.counts.appointments_today)}
          detail={o ? `${o.counts.waiting_now} waiting right now` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Staff summary" action={{ href: "/admin/salary", label: "Staff & salary" }} className="lg:col-span-3">
          {o === null ? (
            <SkeletonRows rows={4} />
          ) : o.counts.doctors + o.counts.nurses === 0 && o.staff_chart.every((p) => p.doctors + p.nurses === 0) ? (
            <EmptyState icon="chart" title="No staff records yet" text="Add your doctors and nurses with their join dates to see the chart.">
              <Link href="/admin/doctors" className="dash-link mt-3">Add a doctor <Icon name="arrow" className="h-4 w-4" /></Link>
            </EmptyState>
          ) : (
            <>
              <p className="-mt-2 mb-3 text-xs text-slate-500">
                Staff at the end of each month · payroll this month {fmtRupees(o.payroll.monthly_total)}
              </p>
              <StaffChart data={o.staff_chart} />
            </>
          )}
        </Panel>

        <Panel title="Recent activity" className="lg:col-span-2">
          {o === null ? (
            <SkeletonRows rows={4} />
          ) : o.recent_activity.length === 0 ? (
            <EmptyState icon="activity" title="Nothing yet" text="New staff records and bookings appear here." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {o.recent_activity.map((a, i) => (
                <li key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <IconTile icon={a.kind === "staff" ? "user" : "calendar"} tone={a.kind === "staff" ? "blue" : "teal"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#0f2f3a]">{a.title}</p>
                    <p className="truncate text-xs text-slate-500">{a.detail} · {timeAgo(a.at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </DashboardShell>
  );
}

function PlatformDashboard() {
  const [counts, setCounts] = useState<Partial<Counts>>({});
  const [requests, setRequests] = useState<AppointmentRequest[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fail = () => setFailed(true);
    api<Hospital[]>("/api/hospitals/")
      .then((hs) =>
        setCounts((c) => ({
          ...c,
          partners: hs.filter((h) => h.is_approved).length,
          // Map imports (source "osm") are listed automatically and don't need approval.
          awaiting: hs.filter((h) => !h.is_approved && (h.source as string) !== "osm"),
        })),
      )
      .catch(fail);
    api<unknown[]>("/api/doctors/").then((d) => setCounts((c) => ({ ...c, doctors: d.length }))).catch(fail);
    api<Appointment[]>(`/api/appointments/?date=${isoDate(new Date())}`)
      .then((a) => setCounts((c) => ({ ...c, today: a.filter((x) => x.status !== "cancelled").length })))
      .catch(fail);
    api<AppointmentRequest[]>("/api/appointment-requests/?status=pending")
      .then(setRequests)
      .catch(() => {
        setRequests([]);
        fail();
      });
  }, []);

  const show = (n: number | undefined) => (n === undefined ? "…" : n);

  return (
    <DashboardShell role="admin" heading="Admin dashboard" greeting="Platform overview" subtitle="Approve hospitals and answer requests to hospitals that aren't on MediConnect yet." wave={false}>
      {failed && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Some numbers couldn&apos;t be loaded. Refresh the page to try again.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon="stethoscope" tone="blue" label="Bookable doctors" value={show(counts.doctors)} detail="Active doctors at approved hospitals" />
        <StatCard
          icon="hospital"
          tone="teal"
          label="Partner hospitals"
          value={show(counts.partners)}
          detail="Approved on MediConnect"
          link={{ href: "/admin/hospitals", label: "Review approvals" }}
        />
        <StatCard icon="calendar" tone="indigo" label="Today's appointments" value={show(counts.today)} detail="Across all doctors, not cancelled" />
      </div>

      <div>
        <Panel title="Waiting for you" action={{ href: "/admin/requests", label: "View all" }}>
          {requests === null ? (
            <SkeletonRows rows={3} />
          ) : requests.length === 0 && (counts.awaiting?.length ?? 0) === 0 ? (
            <EmptyState icon="check" title="All caught up" text="No appointment requests or hospitals waiting for approval." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(counts.awaiting ?? []).slice(0, 3).map((h) => (
                <li key={`h${h.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <IconTile icon="hospital" tone="teal" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#0f2f3a]">Hospital awaiting approval</p>
                    <p className="truncate text-xs text-slate-500">{h.name}{h.city && ` · ${h.city}`}</p>
                  </div>
                  <Link href="/admin/hospitals" className="dash-link text-xs">Review</Link>
                </li>
              ))}
              {requests.slice(0, 4).map((r) => (
                <li key={`r${r.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <IconTile icon="calendar" tone="orange" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#0f2f3a]">Appointment request</p>
                    <p className="truncate text-xs text-slate-500">
                      {r.hospital_name} · {timeAgo(r.created_at)}
                    </p>
                  </div>
                  <Link href="/admin/requests" className="dash-link text-xs">Review</Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

    </DashboardShell>
  );
}
