"use client";

import { useEffect, useState } from "react";
import RoleGuard from "@/components/RoleGuard";
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
    <div className="max-w-2xl space-y-3 rounded-xl border border-slate-200 bg-white p-6">
      {rows.length === 0 && <p className="text-sm text-slate-500">No working hours yet. Add a time block below.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select className="input w-40" value={r.weekday} onChange={(e) => update(i, { weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}
          </select>
          <input className="input w-32" type="time" value={r.start_time} onChange={(e) => update(i, { start_time: e.target.value })} />
          <span>to</span>
          <input className="input w-32" type="time" value={r.end_time} onChange={(e) => update(i, { end_time: e.target.value })} />
          <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-sm text-red-600">Remove</button>
        </div>
      ))}
      <div className="flex gap-3 pt-2">
        <button
          onClick={() => setRows([...rows, { weekday: 0, start_time: "09:00", end_time: "13:00" }])}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          + Add time block
        </button>
        <button onClick={save} className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white">Save</button>
      </div>
      {msg && <p className="text-sm text-teal-700">{msg}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export default function AvailabilityPage() {
  return (
    <RoleGuard role="doctor">
      <h1 className="mb-4 text-2xl font-bold">Weekly working hours</h1>
      <AvailabilityEditor />
    </RoleGuard>
  );
}
