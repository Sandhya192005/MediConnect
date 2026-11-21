"use client";

import Link from "next/link";
import PageHeader from "@/components/PageHeader";
import { useEffect, useState } from "react";
import RoleGuard from "@/components/RoleGuard";
import TimeSelect from "@/components/TimeSelect";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtDateTime, WEEKDAYS, type Appointment, type Availability } from "@/lib/types";

function AvailabilityEditor() {
  const [rows, setRows] = useState<Availability[] | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<Availability[]>("/api/doctors/me/availability/").then((r) =>
      setRows(r.map((a) => ({ ...a, start_time: a.start_time.slice(0, 5), end_time: a.end_time.slice(0, 5) }))),
    );
  }, []);

  if (!rows) return <p className="text-slate-500">Loading…</p>;

  const update = (i: number, patch: Partial<Availability>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setMsg("");
    setError("");
    try {
      await api("/api/doctors/me/availability/", {
        method: "PUT",
        body: JSON.stringify(rows!.map(({ weekday, start_time, end_time }) => ({ weekday, start_time, end_time }))),
      });
      setMsg("Working hours saved.");
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="max-w-3xl space-y-3 card p-6">
      {rows.length === 0 && <p className="text-sm text-slate-500">No working hours yet. Add a time block below.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select className="input w-40" aria-label={`Day, block ${i + 1}`} value={r.weekday} onChange={(e) => update(i, { weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
          </select>
          <TimeSelect label={`From, block ${i + 1}`} value={r.start_time} onChange={(v) => update(i, { start_time: v })} />
          <span>to</span>
          <TimeSelect label={`To, block ${i + 1}`} value={r.end_time} onChange={(v) => update(i, { end_time: v })} />
          <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-sm text-red-600">Remove</button>
        </div>
      ))}
      <div className="flex gap-3 pt-2">
        <button
          onClick={() => setRows([...rows, { weekday: 0, start_time: "09:00", end_time: "13:00" }])}
          className="btn-outline"
        >
          + Add time block
        </button>
        <button onClick={save} className="btn-solid">Save</button>
      </div>
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/**
 * "Duty assigned for you" (booking flow, owner decision 2026-11-21): the appointments the doctor accepted
 * that are still ahead, plus how many requests still wait for their answer (they answer on Appointments).
 */
function AssignedDuty() {
  const [items, setItems] = useState<Appointment[] | null>(null);
  const [toAnswer, setToAnswer] = useState(0);

  useEffect(() => {
    const load = () => {
      api<Appointment[]>("/api/appointments/?when=upcoming&status=confirmed").then(setItems).catch(() => setItems([]));
      api<Appointment[]>("/api/appointments/?awaiting=doctor").then((l) => setToAnswer(l.length)).catch(() => {});
    };
    load();
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, []);

  return (
    <section aria-label="Duty assigned for you" className="card mb-6 max-w-3xl p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="section-title">Duty assigned for you</h2>
        {toAnswer > 0 && (
          <Link href="/doctor/appointments" className="text-sm font-semibold text-amber-800 hover:underline">
            {toAnswer} request{toAnswer === 1 ? "" : "s"} waiting for your answer →
          </Link>
        )}
      </div>
      <p className="text-sm text-slate-500">Appointments you accepted that are still ahead.</p>
      {items === null ? (
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-slate-100" />
      ) : items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nothing assigned yet. Appointments you accept appear here.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="font-semibold text-navy-800">{fmtDateTime(a.start)}</span>
              <span className="min-w-0 flex-1 text-slate-600">
                {a.patient_name}{a.reason ? ` · ${a.reason}` : ""}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {a.source === "hospital" ? `From ${a.hospital_name ?? "the hospital"}` : "Personal request"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AvailabilityPage() {
  return (
    <RoleGuard role="doctor">
      <div className="mb-6"><PageHeader icon="clock" title="Duty schedule" subtitle="Your accepted duties, and the weekly hours patients can book." /></div>
      <AssignedDuty />
      <h2 className="section-title mb-3">Weekly working hours</h2>
      <AvailabilityEditor />
    </RoleGuard>
  );
}
