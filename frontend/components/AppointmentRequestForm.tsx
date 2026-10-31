"use client";

import Link from "next/link";
import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { isoDate, type ScrapedDoctor } from "@/lib/types";

/** For hospitals that aren't MediConnect partners: a request, never a confirmed booking. */
export default function AppointmentRequestForm({ hospitalId, doctors, presetDoctor }: { hospitalId: number; doctors: ScrapedDoctor[]; presetDoctor?: number | null }) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [form, setForm] = useState({
    scraped_doctor: presetDoctor ? String(presetDoctor) : "",
    preferred_date: isoDate(tomorrow),
    preferred_time: "Morning",
    phone: "",
    reason: "",
  });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/appointment-requests/", {
        method: "POST",
        body: JSON.stringify({ ...form, hospital: hospitalId, scraped_doctor: form.scraped_doctor ? Number(form.scraped_doctor) : null }),
      });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">⏳ Request sent – pending, not confirmed yet</p>
        <p className="mt-1">This is not a booking. We&apos;ll notify you when it&apos;s confirmed. For anything urgent, call the hospital directly.</p>
        <Link href="/patient/appointments" className="mt-2 inline-block underline">See my requests</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">
        Send an <strong>appointment request</strong>. It stays <em>pending – not confirmed</em> until the hospital confirms it.
      </p>
      <label className="block text-sm">
        Doctor (optional)
        <select className="input mt-1" value={form.scraped_doctor} onChange={set("scraped_doctor")}>
          <option value="">Any doctor</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.specialization ? ` – ${d.specialization}` : ""}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Preferred date<input className="input mt-1" type="date" required min={isoDate(new Date())} value={form.preferred_date} onChange={set("preferred_date")} /></label>
        <label className="block text-sm">
          Time
          <select className="input mt-1" value={form.preferred_time} onChange={set("preferred_time")}>
            {["Morning", "Afternoon", "Evening", "Any time"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-sm">Phone for call-back<input className="input mt-1" value={form.phone} onChange={set("phone")} placeholder="Optional" /></label>
      <label className="block text-sm">Reason<input className="input mt-1" maxLength={300} value={form.reason} onChange={set("reason")} placeholder="Optional" /></label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
    </form>
  );
}
