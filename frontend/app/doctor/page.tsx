"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import DashboardShell, { EmptyState, IconTile, Panel, pillFor, SkeletonRows, StatCard, StatusPill } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtTime, isoDate, type Appointment, type Doctor } from "@/lib/types";

/** Python's Monday=0 weekday, as used by WeeklyAvailability. */
const todayWeekday = () => (new Date().getDay() + 6) % 7;
const hhmm = (t: string) => t.slice(0, 5);

/** "+2 from yesterday", "−1 from yesterday" or "Same as yesterday". */
function vsYesterday(today: number, yesterday: number): string {
  const d = today - yesterday;
  return d === 0 ? "Same as yesterday" : `${d > 0 ? "+" : "−"}${Math.abs(d)} from yesterday`;
}

export default function DoctorDashboard() {
  const { user } = useAuth();
  const [today, setToday] = useState<Appointment[] | null>(null);
  const [yesterdayCount, setYesterdayCount] = useState<number | null>(null);
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
    // "+N from yesterday" (reference design, Part 3): yesterday's visits, cancelled ones not counted.
    const y = new Date();
    y.setDate(y.getDate() - 1);
    api<Appointment[]>(`/api/appointments/?date=${isoDate(y)}`)
      .then((list) => setYesterdayCount(list.filter((a) => a.status !== "cancelled").length))
      .catch(() => setYesterdayCount(null));
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
  // The first name: in Tamil Nadu the last name is often just an initial ("Jeevitha D" -> "Dr. Jeevitha").
  const callName = user?.first_name || user?.last_name || "";

  return (
    <DashboardShell
      role="doctor"
      heading="Doctor dashboard"
      greeting={`${new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}, Dr. ${callName}!`}
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
              {yesterdayCount !== null && <span className="block font-[650] text-[#0f2f3a]">{vsYesterday(visits.length, yesterdayCount)}</span>}
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
                    <span className="block truncate text-sm font-[650] text-[#0f2f3a]">{a.patient_name}</span>
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

          <RecordsQuickAccess />
        </div>
      </div>
    </DashboardShell>
  );
}

/** Patient ID box: opens the Patient records page for that ID. */
function RecordsQuickAccess() {
  const router = useRouter();
  const [id, setId] = useState("");
  return (
    <section className="dash-card p-5" aria-label="Patient records quick access">
      <div className="flex items-center gap-3">
        <IconTile icon="file" tone="orange" size="sm" />
        <p className="text-sm font-[650] text-[#0f2f3a]">Quick access to patient records</p>
      </div>
      <p className="mt-2 text-xs text-slate-500">Any patient&apos;s medical history, with their patient ID. Each view is logged for the patient.</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = id.trim().toUpperCase();
          if (v) router.push(`/doctor/records?id=${encodeURIComponent(v)}`);
        }}
      >
        <input
          aria-label="Patient ID"
          className="input rounded-xl py-2 font-mono uppercase"
          placeholder="Enter patient ID…"
          maxLength={12}
          value={id}
          onChange={(e) => setId(e.target.value)}
        />
        <button className="btn-solid shrink-0 rounded-xl px-3 py-2" aria-label="Open patient records">
          <Icon name="search" className="h-4 w-4" />
        </button>
      </form>
    </section>
  );
}
