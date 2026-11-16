"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import DashboardShell, { EmptyState, IconTile, Panel, SkeletonRows, SoonBadge, StatCard, StatusPill, type PillStatus } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtTime, isoDate, type Appointment, type Doctor } from "@/lib/types";

const isActive = (a: Appointment) => a.status === "booked" || a.status === "confirmed";

/** "now" while the visit's time is running, otherwise the appointment's own status. */
function pillFor(a: Appointment, now: number): PillStatus {
  if (isActive(a) && new Date(a.start).getTime() <= now && now < new Date(a.end).getTime()) return "now";
  return a.status;
}

/** Python's Monday=0 weekday, as used by WeeklyAvailability. */
const todayWeekday = () => (new Date().getDay() + 6) % 7;
const hhmm = (t: string) => t.slice(0, 5);

export default function DoctorDashboard() {
  const { user } = useAuth();
  const [today, setToday] = useState<Appointment[] | null>(null);
  const [me, setMe] = useState<Doctor | null>(null);
  const [error, setError] = useState(false);

  const loadToday = useCallback(() => {
    api<Appointment[]>(`/api/appointments/?date=${isoDate(new Date())}`)
      .then(setToday)
      .catch(() => {
        setToday([]);
        setError(true);
      });
  }, []);

  useEffect(() => {
    loadToday();
    api<Doctor>("/api/doctors/me/").then(setMe).catch(() => setMe(null));
  }, [loadToday]);

  // Refresh the schedule when a live notification arrives (a new booking or a cancellation).
  useEffect(() => {
    window.addEventListener(NOTIFICATION_EVENT, loadToday);
    return () => window.removeEventListener(NOTIFICATION_EVENT, loadToday);
  }, [loadToday]);

  const now = Date.now();
  const visits = today?.filter((a) => a.status !== "cancelled") ?? [];
  const toSee = visits.filter((a) => isActive(a) && new Date(a.end).getTime() > now);
  const next = toSee[0];
  const hours = me?.availability.filter((a) => a.weekday === todayWeekday()) ?? [];
  const surname = user?.last_name || user?.first_name || "";

  return (
    <DashboardShell
      role="doctor"
      heading="Doctor dashboard"
      greeting={`${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, Dr. ${surname}!`}
      subtitle="Here's your schedule for today."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon="calendar"
          tone="blue"
          label="Today's appointments"
          value={today === null ? "…" : visits.length}
          detail={today === null ? undefined : `${visits.filter((a) => a.status === "completed").length} completed`}
        />
        <StatCard
          icon="users"
          tone="teal"
          label="Still to see today"
          value={today === null ? "…" : toSee.length}
          detail="Booked or confirmed visits not yet finished"
        />
        <StatCard
          icon="clock"
          tone="indigo"
          label="Next patient"
          value={today === null ? "…" : next ? fmtTime(next.start) : "—"}
          detail={next ? next.patient_name : today === null ? undefined : "No more visits today"}
          link={{ href: "/doctor/appointments", label: "Manage appointments" }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel title="Today's schedule" action={{ href: "/doctor/appointments", label: "View all" }} className="lg:col-span-3">
          {today === null ? (
            <SkeletonRows rows={4} />
          ) : today.length === 0 ? (
            <EmptyState
              icon="calendar"
              title={error ? "Couldn't load today's schedule" : "No appointments today"}
              text={error ? "Please try again in a moment." : "New bookings appear here instantly."}
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {today.map((a) => (
                <li key={a.id} className={`flex items-center gap-4 py-3 first:pt-0 last:pb-0 ${a.status === "cancelled" ? "opacity-60" : ""}`}>
                  <span className="w-20 shrink-0 text-sm tabular-nums text-slate-500">{fmtTime(a.start)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-[650] text-[#0f2f3a]">{a.patient_name}</span>
                    {a.reason && <span className="block truncate text-xs text-slate-500">{a.reason}</span>}
                  </span>
                  <StatusPill status={pillFor(a, now)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6 lg:col-span-2">
          <Panel title="Duty today" action={{ href: "/doctor/availability", label: "Edit schedule" }}>
            {me === null ? (
              <SkeletonRows rows={2} />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <IconTile icon="hospital" tone="teal" size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-[650] text-[#0f2f3a]">{me.hospital_name ?? "No hospital set"}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[me.specialization || me.department_name, me.hospital_city].filter(Boolean).join(" · ") || "Add your specialization in your profile"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <IconTile icon="clock" tone="blue" size="sm" />
                  <p className="text-sm text-[#0f2f3a]">
                    {hours.length > 0 ? hours.map((h) => `${hhmm(h.start_time)}–${hhmm(h.end_time)}`).join(", ") : "Not on duty today"}
                  </p>
                </div>
                {!me.hospital_name && (
                  <Link href="/doctor/profile" className="dash-link">Set your hospital <Icon name="arrow" className="h-4 w-4" /></Link>
                )}
              </div>
            )}
          </Panel>

          <section className="dash-card border-dashed p-5" aria-label="Patient records quick access">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-3">
                <IconTile icon="file" tone="orange" size="sm" />
                <p className="text-sm font-[650] text-[#0f2f3a]">Quick access to patient records</p>
              </div>
              <SoonBadge phase="Step 2" />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Enter a patient ID to see their reports, scans and X-rays, for patients of your hospital. Every view is logged.
            </p>
          </section>
        </div>
      </div>
    </DashboardShell>
  );
}
