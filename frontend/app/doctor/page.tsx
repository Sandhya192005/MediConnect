"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import DashboardShell, { EmptyState, IconTile, Panel, pillFor, SkeletonRows, StatCard, StatusPill } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import { fmt12 } from "@/components/TimeSelect";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { greetingFor } from "@/lib/greeting";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtTime, isoDate, type Appointment, type Doctor } from "@/lib/types";

/** Python's Monday=0 weekday, as used by WeeklyAvailability. */
const todayWeekday = () => (new Date().getDay() + 6) % 7;


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
    // No comparison with yesterday on the card (owner request 2026-11-25).
  }, [loadToday]);

  // Refresh when a live notification arrives (a booking, a cancellation, a patient checking in), and every 30 s.
  useEffect(() => {
    const timer = setInterval(loadToday, 30_000);
    window.addEventListener(NOTIFICATION_EVENT, loadToday);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATION_EVENT, loadToday);
    };
  }, [loadToday]);

  const visits = today?.filter((a) => a.status !== "cancelled") ?? [];
  const waiting = visits.filter((a) => a.queue_status === "waiting").sort((a, b) => (a.token ?? 0) - (b.token ?? 0));
  const current = visits.find((a) => a.queue_status === "in_consultation");
  const hours = me?.availability.filter((a) => a.weekday === todayWeekday()) ?? [];

  return (
    <DashboardShell
      role="doctor"
      heading="Doctor dashboard"
      greeting={greetingFor(user)}
      subtitle="Here's your schedule for today."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          icon="calendar"
          tone="blue"
          label="Today's appointments"
          value={today === null ? "…" : visits.length}
          detail={today === null ? undefined : (
            <>
              {visits.filter((a) => a.status === "completed").length} completed
            </>
          )}
        />
        <StatCard
          icon="users"
          tone="teal"
          label="Patients waiting"
          value={today === null ? "…" : waiting.length}
          detail={waiting.length ? `Next: token ${waiting[0].token}, ${waiting[0].patient_name}` : "Checked in and waiting to be called"}
          link={{ href: "/doctor/queue", label: "Open the queue" }}
        />
        <StatCard
          icon="clock"
          tone="indigo"
          label="Current patient"
          value={today === null ? "…" : current ? `#${current.token}` : "—"}
          detail={current ? `${current.patient_name} · consulting…` : today === null ? undefined : "No one in consultation"}
          link={current ? { href: "/doctor/queue", label: "Patient details & treatment note" } : undefined}
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
                    <span className="block truncate text-sm font-[650] text-[#00295c]">{a.patient_name}</span>
                    {a.reason && <span className="block truncate text-xs text-slate-500">{a.reason}</span>}
                  </span>
                  {a.token && <span className="text-xs tabular-nums text-slate-400">#{a.token}</span>}
                  <StatusPill status={pillFor(a)} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6 lg:col-span-2">
          <Panel title="Today's duty" action={{ href: "/doctor/availability", label: "Edit schedule" }}>
            {me === null ? (
              <SkeletonRows rows={2} />
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <IconTile icon="hospital" tone="teal" size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-[650] text-[#00295c]">{me.hospital_name ?? "No hospital set"}</p>
                    <p className="truncate text-xs text-slate-500">
                      {[me.specialization || me.department_name, me.hospital_city].filter(Boolean).join(" · ") || "Add your specialization in your profile"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <IconTile icon="clock" tone="blue" size="sm" />
                  <p className="text-sm text-[#00295c]">
                    {hours.length > 0 ? hours.map((h) => `${fmt12(h.start_time)} – ${fmt12(h.end_time)}`).join(", ") : "Not on duty today"}
                  </p>
                </div>
                {!me.hospital_name && (
                  <Link href="/doctor/profile" className="dash-link">Set your hospital <Icon name="arrow" className="h-4 w-4" /></Link>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </DashboardShell>
  );
}
