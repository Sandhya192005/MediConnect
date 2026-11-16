"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import DashboardShell, { EmptyState, IconTile, Panel, SkeletonRows, SoonBadge, StatCard } from "@/components/DashboardShell";
import { api } from "@/lib/api";
import { isoDate, timeAgo, type Appointment, type AppointmentRequest, type Hospital } from "@/lib/types";

type Counts = { partners: number; awaiting: Hospital[]; doctors: number; today: number };

export default function AdminDashboard() {
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
    <DashboardShell role="admin" heading="Admin dashboard" greeting="Hospital overview" subtitle="Manage your hospital operations efficiently." wave={false}>
      {failed && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Some numbers couldn&apos;t be loaded. Refresh the page to try again.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon="stethoscope" tone="blue" label="Bookable doctors" value={show(counts.doctors)} detail="Active doctors at approved hospitals" />
        <StatCard icon="nurse" tone="rose" label="Nurses" soon="Step 4" detail="Nurse records with join date and salary" />
        <StatCard
          icon="hospital"
          tone="teal"
          label="Partner hospitals"
          value={show(counts.partners)}
          detail="Approved on MediConnect"
          link={{ href: "/admin/hospitals", label: "Manage" }}
        />
        <StatCard icon="calendar" tone="indigo" label="Today's appointments" value={show(counts.today)} detail="Across all doctors, not cancelled" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Staff summary" className="lg:col-span-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-slate-500">Doctors and nurses who joined, month by month.</p>
            <SoonBadge phase="Step 4" />
          </div>
          {/* The chart needs staff join dates, which arrive in Phase 4, so nothing is drawn yet. */}
          <div className="mt-4">
            <EmptyState icon="chart" title="No staff records yet" text="The chart appears once doctors and nurses are added with their join dates." />
          </div>
        </Panel>

        <Panel title="Waiting for you" action={{ href: "/admin/requests", label: "View all" }} className="lg:col-span-2">
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
