"use client";

import PageHeader from "@/components/PageHeader";
import { useEffect, useState } from "react";
import RoleGuard from "@/components/RoleGuard";
import TimeSelect from "@/components/TimeSelect";
import { api, errorMessage } from "@/lib/api";
import { WEEKDAYS, type Availability } from "@/lib/types";

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

export default function AvailabilityPage() {
  return (
    <RoleGuard role="doctor">
      <div className="mb-6"><PageHeader icon="clock" title="Weekly working hours" subtitle="Patients can book free slots inside these hours." /></div>
      <AvailabilityEditor />
    </RoleGuard>
  );
}
