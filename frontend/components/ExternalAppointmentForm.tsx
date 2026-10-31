"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { ScrapedDoctor } from "@/lib/types";

/**
 * "I booked this with the hospital": the patient adds an appointment they made on the
 * hospital's own website/phone, so MediConnect can send reminders. We can't verify it.
 */
export default function ExternalAppointmentForm({
  hospitalId,
  hospitalName,
  doctors = [],
  onSaved,
}: {
  hospitalId?: number;
  hospitalName?: string;
  doctors?: ScrapedDoctor[];
  onSaved?: () => void;
}) {
  const [form, setForm] = useState({ hospital_name: "", doctor_name: "", start: "", booking_reference: "", notes: "" });
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/external-appointments/", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          hospital: hospitalId ?? null,
          hospital_name: hospitalId ? "" : form.hospital_name,
          // <input type="datetime-local"> has no time zone; the browser's local time is what the patient meant.
          start: form.start ? new Date(form.start).toISOString() : "",
        }),
      });
      setSaved(true);
      setForm({ hospital_name: "", doctor_name: "", start: "", booking_reference: "", notes: "" });
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (saved && hospitalId) {
    return (
      <p className="rounded-md bg-teal-50 p-3 text-sm text-teal-800">
        ✓ Added. We&apos;ll remind you 24 hours and 1 hour before. For changes, contact the hospital.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">
        Booked on the hospital&apos;s own website or by phone? Add it here and we&apos;ll send you reminders.
        We can&apos;t confirm it with the hospital.
      </p>
      {hospitalId ? (
        <p className="text-sm">Hospital: <strong>{hospitalName}</strong></p>
      ) : (
        <label className="block text-sm">Hospital<input className="input mt-1" required maxLength={200} value={form.hospital_name} onChange={set("hospital_name")} placeholder="e.g. Apollo Hospital, Greams Road" /></label>
      )}
      <label className="block text-sm">
        Doctor (optional)
        <input className="input mt-1" list="ext-doctors" maxLength={150} value={form.doctor_name} onChange={set("doctor_name")} />
        <datalist id="ext-doctors">{doctors.map((d) => <option key={d.id} value={d.name} />)}</datalist>
      </label>
      <label className="block text-sm">Date and time<input className="input mt-1" type="datetime-local" required value={form.start} onChange={set("start")} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm">Booking ID (optional)<input className="input mt-1" maxLength={60} value={form.booking_reference} onChange={set("booking_reference")} /></label>
        <label className="block text-sm">Notes (optional)<input className="input mt-1" maxLength={300} value={form.notes} onChange={set("notes")} /></label>
      </div>
      {saved && <p className="text-sm text-teal-700">✓ Added. We&apos;ll remind you 24 h and 1 h before.</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Add appointment"}</button>
    </form>
  );
}
