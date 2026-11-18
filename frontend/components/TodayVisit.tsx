"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtTime, isoDate, type Appointment } from "@/lib/types";
import { directionsUrl } from "./AppointmentList";
import Icon from "./Icons";

const REFRESH_MS = 30_000;

/**
 * The patient's visit(s) today and their place in the doctor's queue:
 * "I've arrived" → token + people ahead → "It's your turn". Shows nothing on days without a visit.
 */
export default function TodayVisit() {
  const [visits, setVisits] = useState<Appointment[]>([]);

  const load = useCallback(() => {
    api<Appointment[]>(`/api/appointments/?date=${isoDate(new Date())}`)
      .then((items) => setVisits(items.filter((a) => a.status === "booked" || a.status === "confirmed")))
      .catch(() => {});
  }, []);

  // Refresh on live notifications ("It's your turn") and every 30 s (others ahead being called in).
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATION_EVENT, load);
    };
  }, [load]);

  if (visits.length === 0) return null;
  return (
    <div className="space-y-4">
      {visits.map((a) => (
        <VisitCard key={a.id} a={a} onChange={load} />
      ))}
    </div>
  );
}

function VisitCard({ a, onChange }: { a: Appointment; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const where = [a.doctor_name, a.hospital_name].filter(Boolean).join(" · ");

  async function checkIn() {
    setBusy(true);
    setError("");
    try {
      await api(`/api/appointments/${a.id}/check-in/`, { method: "POST" });
      onChange();
    } catch (e) {
      setError(errorMessage(e).replace(/^start: /, ""));
    } finally {
      setBusy(false);
    }
  }

  if (a.queue_status === "in_consultation") {
    return (
      <section aria-label="Today's visit" className="dash-card flex items-center gap-4 border-sky-200 bg-sky-50 p-5">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-600 text-white">
          <Icon name="stethoscope" />
        </span>
        <div>
          <p className="text-lg font-bold text-sky-900">It&apos;s your turn</p>
          <p className="text-sm text-sky-800">{a.doctor_name} is ready to see you now. Token {a.token}.</p>
        </div>
      </section>
    );
  }

  if (a.queue_status === "waiting") {
    const ahead = a.people_ahead ?? 0;
    return (
      <section aria-label="Today's visit" className="dash-card flex flex-wrap items-center gap-5 p-5">
        <span className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-amber-500 font-bold text-white">
          <span className="text-[10px] font-medium uppercase opacity-80">Token</span>
          <span className="text-2xl leading-none" data-testid="my-token">{a.token}</span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-[650] uppercase tracking-wider text-amber-700">You&apos;re checked in</p>
          <p className="text-lg font-bold text-[#0f2f3a]" data-testid="people-ahead">
            {ahead === 0 ? "You're next" : `${ahead} ${ahead === 1 ? "person" : "people"} ahead of you`}
          </p>
          <p className="truncate text-sm text-slate-500">{where} · booked {fmtTime(a.start)}</p>
        </div>
        <p className="text-xs text-slate-400">We&apos;ll notify you when it&apos;s your turn.</p>
      </section>
    );
  }

  return (
    <section aria-label="Today's visit" className="dash-card flex flex-wrap items-center gap-4 border-teal-200 p-5">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
        <Icon name="calendar" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-[650] uppercase tracking-wider text-teal-700">Your visit today</p>
        <p className="text-lg font-bold text-[#0f2f3a]">{fmtTime(a.start)} · {a.doctor_name}</p>
        <p className="truncate text-sm text-slate-500">
          {a.hospital_name ?? ""} · Check in when you reach the hospital (from 2 hours before).
        </p>
        {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {/* On the way: directions to the hospital (owner request 2026-11-18). */}
        {a.hospital && (
          <a href={directionsUrl(a.hospital_name ?? "", a.hospital)} target="_blank" rel="noopener noreferrer"
             className="btn-outline px-4 py-2.5" aria-label={`Get directions to ${a.hospital_name}`}>
            <Icon name="map" className="h-4 w-4" /> Directions
          </a>
        )}
        <button onClick={checkIn} disabled={busy} className="btn-solid px-5 py-2.5">
          <Icon name="pin" className="h-4 w-4" />
          {busy ? "Checking in…" : "I've arrived"}
        </button>
      </div>
    </section>
  );
}
