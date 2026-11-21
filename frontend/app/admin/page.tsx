"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import ConnectHospital from "@/components/ConnectHospital";
import DashboardShell, { EmptyState, IconTile, Panel, SkeletonRows, StatCard } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import { LineChart } from "@/components/Charts";
import StaffChart from "@/components/StaffChart";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { greetingFor } from "@/lib/greeting";
import { fmtRupees, timeAgo, type AppointmentRequest, type ConnectionRequest, type HospitalOverview, type PlatformOverview, type SupportInboxItem } from "@/lib/types";

type Counts = { connections: ConnectionRequest[]; support: SupportInboxItem[] };

/** Hospital admins see their hospital; the platform admin (Django superuser) sees approvals and requests. */
/** Staff cards compare today with the last day of last month (2026-11-21). */
const STAFF_TREND = "since the end of last month";

export default function AdminDashboard() {
  return (
    <RoleGuard role={["hospital", "admin"]}>
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
  const { user } = useAuth();
  const [o, setO] = useState<HospitalOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<HospitalOverview>("/api/hospital-admin/overview/").then(setO).catch((e) => setError(errorMessage(e)));
  }, []);

  const n = (v: number | undefined) => (o ? v : "…");

  return (
    <DashboardShell
      role="hospital"
      heading="Hospital dashboard"
      greeting={greetingFor(user)}
      subtitle={`Hospital overview${o ? ` · ${o.hospital.name}${o.hospital.city ? `, ${o.hospital.city}` : ""}` : ""} · Manage your hospital operations efficiently.`}
    >
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {o && !o.hospital.connected && <ConnectHospital />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          icon="stethoscope"
          tone="blue"
          label="Total doctors"
          value={n(o?.counts.doctors)}
          detail={o?.counts.doctor_accounts_without_record ? `${o.counts.doctor_accounts_without_record} doctor account(s) without a staff record` : "On staff today"}
          trend={o?.trends.doctors.change_pct} trendLabel={STAFF_TREND}
          link={{ href: "/admin/doctors", label: "Manage doctors" }}
        />
        <StatCard icon="nurse" tone="rose" label="Total nurses" value={n(o?.counts.nurses)} detail="On staff today"
                  trend={o?.trends.nurses.change_pct} trendLabel={STAFF_TREND} link={{ href: "/admin/nurses", label: "Manage nurses" }} />
        <StatCard icon="user" tone="orange" label="Other staff" value={n(o?.counts.other_staff)} detail="Lab, pharmacy, front desk and more"
                  trend={o?.trends.other_staff.change_pct} trendLabel={STAFF_TREND}
                  link={{ href: "/admin/staff", label: "Manage staff" }} />
        <StatCard icon="users" tone="teal" label="Total patients" value={n(o?.counts.patients)} detail="With a visit booked or done here"
                  trend={o?.trends.patients.change_pct} trendLabel="since the start of the month" link={{ href: "/admin/patients", label: "View patients" }} />
        <StatCard
          icon="calendar"
          tone="indigo"
          label="Today's appointments"
          value={n(o?.counts.appointments_today)}
          trend={o?.trends.appointments_today.change_pct}
          trendLabel={o ? `vs ${o.trends.appointments_today.before} last ${new Date().toLocaleDateString("en-IN", { weekday: "long" })}` : ""}
          detail={o ? `${o.counts.waiting_now} waiting right now${o.counts.to_confirm ? ` · ${o.counts.to_confirm} booking${o.counts.to_confirm === 1 ? "" : "s"} to confirm` : ""}` : undefined}
          link={{ href: "/admin/appointments", label: o?.counts.to_confirm ? "Confirm bookings" : "View appointments" }}
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
                    <p className="truncate text-sm font-[650] text-[#00295c]">{a.title}</p>
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

/**
 * The platform admin's dashboard (the MediConnect owner): how many patients, doctors and hospitals use the
 * platform, how that grows, and what's waiting for approval. Numbers from /api/platform/overview/.
 */
function PlatformDashboard() {
  const { user } = useAuth();
  const [o, setO] = useState<PlatformOverview | null>(null);
  const [counts, setCounts] = useState<Partial<Counts>>({});
  const [requests, setRequests] = useState<AppointmentRequest[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const fail = () => setFailed(true);
    api<PlatformOverview>("/api/platform/overview/").then(setO).catch(fail);
    // Hospitals join only through their own connection request (2026-11-20: the old "Add hospital" /
    // approval toggle page is now "Connected hospitals").
    api<ConnectionRequest[]>("/api/platform/connection-requests/?status=pending")
      .then((rs) => setCounts((c) => ({ ...c, connections: rs })))
      .catch(fail);
    api<SupportInboxItem[]>("/api/support/inbox/?status=open")
      .then((rs) => setCounts((c) => ({ ...c, support: rs })))
      .catch(fail);
    api<AppointmentRequest[]>("/api/appointment-requests/?status=pending")
      .then(setRequests)
      .catch(() => {
        setRequests([]);
        fail();
      });
  }, []);

  const newThisMonth = (n: number | undefined) => (n ? `+${n} this month` : "None new this month");

  return (
    <DashboardShell role="admin" heading="Admin dashboard" greeting={greetingFor(user)} subtitle="Platform overview · How many people use MediConnect, and how it grows.">
      {failed && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Some numbers couldn&apos;t be loaded. Refresh the page to try again.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard icon="users" tone="teal" label="Patient accounts" value={o ? o.patients.total : "…"}
                  trend={o?.patients.change_pct} trendLabel="since the start of the month" detail={o ? newThisMonth(o.patients.new_this_month) : undefined} />
        <StatCard icon="stethoscope" tone="blue" label="Doctor accounts" value={o ? o.doctors.total : "…"}
                  trend={o?.doctors.change_pct} trendLabel="since the start of the month" detail={o ? newThisMonth(o.doctors.new_this_month) : undefined} />
        <StatCard icon="hospital" tone="indigo" label="Connected hospitals" value={o ? o.hospitals.total : "…"}
                  trend={o?.hospitals.change_pct} trendLabel="since the start of the month"
                  detail={o ? `${o.hospitals.bookable} with instant booking` : undefined}
                  link={{ href: "/admin/reports#growth", label: "Hospital growth" }} />
        <StatCard icon="settings" tone="rose" label="Hospital accounts" value={o ? o.hospital_accounts.total : "…"}
                  trend={o?.hospital_accounts.change_pct} trendLabel="since the start of the month"
                  detail={o ? `Run staff & patient records here · ${o.hospital_accounts.with_staff_records} with staff records` : undefined} />
        <StatCard icon="calendar" tone="orange" label="Appointments this month" value={o ? o.appointments.this_month : "…"}
                  trend={o?.appointments.change_pct} trendLabel="vs the same days last month" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Platform usage" action={{ href: "/admin/reports", label: "Reports & analytics" }} className="lg:col-span-3">
          <p className="-mt-2 mb-3 text-xs text-slate-500">Patients and doctors with at least one appointment each month.</p>
          {o === null ? <SkeletonRows rows={4} /> : (
            <LineChart
              ariaLabel="Active patients and doctors per month, last 6 months"
              labels={o.activity.months}
              series={[
                { label: "Patients", values: o.activity.active_patients },
                { label: "Doctors", values: o.activity.active_doctors },
              ]}
            />
          )}
        </Panel>

        <Panel title="Recent activity" className="lg:col-span-2">
          {o === null ? (
            <SkeletonRows rows={4} />
          ) : o.recent.length === 0 ? (
            <EmptyState icon="activity" title="Nothing yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {o.recent.map((e, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <IconTile icon={e.kind === "hospital" ? "hospital" : e.kind === "hospital_account" ? "settings" : e.kind === "doctor" ? "stethoscope" : "user"}
                            tone={e.kind === "hospital" ? "indigo" : e.kind === "hospital_account" ? "rose" : e.kind === "doctor" ? "blue" : "teal"} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#00295c]">{e.title}</p>
                    <p className="truncate text-xs text-slate-500">{e.detail} · {e.estimated ? "date approx." : timeAgo(e.at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div>
        <Panel title="Waiting for you" action={{ href: "/admin/requests", label: "View all" }}>
          {requests === null ? (
            <SkeletonRows rows={3} />
          ) : requests.length === 0 && (counts.connections?.length ?? 0) === 0 && (counts.support?.length ?? 0) === 0 ? (
            <EmptyState icon="check" title="All caught up" text="No connection requests, appointment requests or support messages waiting." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {(counts.connections ?? []).slice(0, 3).map((r) => (
                <li key={`c${r.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <IconTile icon="hospital" tone="indigo" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#00295c]">Hospital wants to connect</p>
                    <p className="truncate text-xs text-slate-500">{r.hospital_name} · {r.hospital_city} · {timeAgo(r.created_at)}</p>
                  </div>
                  <Link href="/admin/connections" className="dash-link text-xs">Review</Link>
                </li>
              ))}
              {(counts.support ?? []).slice(0, 3).map((m) => (
                <li key={`s${m.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <IconTile icon="chat" tone="rose" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#00295c]">Support message</p>
                    <p className="truncate text-xs text-slate-500">{m.subject} · {m.sender_name} ({m.sender_role}) · {timeAgo(m.created_at)}</p>
                  </div>
                  <Link href="/admin/support" className="dash-link text-xs">Reply</Link>
                </li>
              ))}
              {requests.slice(0, 4).map((r) => (
                <li key={`r${r.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <IconTile icon="calendar" tone="orange" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-[650] text-[#00295c]">Appointment request</p>
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
