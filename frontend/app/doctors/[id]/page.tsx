"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDateTime, fmtTime, isoDate, WEEKDAYS, type Doctor, type Slot } from "@/lib/types";

export default function DoctorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const router = useRouter();
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [day, setDay] = useState(isoDate(new Date()));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [picked, setPicked] = useState<Slot | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Doctor>(`/api/doctors/${id}/`).then(setDoctor).catch((e) => setError(errorMessage(e)));
  }, [id]);

  useEffect(() => {
    setSlots(null);
    setPicked(null);
    api<{ slots: Slot[] }>(`/api/doctors/${id}/slots/?date=${day}`).then((r) => setSlots(r.slots));
  }, [id, day]);

  async function book() {
    if (!picked) return;
    if (!user) return router.push("/login");
    setBusy(true);
    setError("");
    try {
      await api("/api/appointments/", {
        method: "POST",
        body: JSON.stringify({ doctor: Number(id), start: picked.start, reason }),
      });
      router.push("/patient/appointments?booked=1");
    } catch (e) {
      setError(errorMessage(e));
      // Refresh slots in case someone else took it.
      api<{ slots: Slot[] }>(`/api/doctors/${id}/slots/?date=${day}`).then((r) => setSlots(r.slots));
    } finally {
      setBusy(false);
    }
  }

  if (!doctor) return <p className="text-slate-500">{error || "Loading…"}</p>;

  // Next 14 days for the date picker.
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <aside className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-1">
        <Link href="/doctors" className="text-sm text-teal-700">← All doctors</Link>
        <h1 className="mt-2 text-2xl font-bold">Dr. {doctor.name}</h1>
        <p className="text-teal-700">{doctor.specialization}</p>
        <p className="mt-1 text-sm text-slate-500">{doctor.qualification}</p>
        <dl className="mt-4 space-y-1 text-sm">
          <div><dt className="inline text-slate-500">Hospital: </dt><dd className="inline">{doctor.hospital_name}, {doctor.hospital_city}</dd></div>
          <div><dt className="inline text-slate-500">Department: </dt><dd className="inline">{doctor.department_name}</dd></div>
          <div><dt className="inline text-slate-500">Experience: </dt><dd className="inline">{doctor.experience_years} years</dd></div>
          <div><dt className="inline text-slate-500">Fee: </dt><dd className="inline">₹{Number(doctor.fee).toFixed(0)}</dd></div>
        </dl>
        {doctor.bio && <p className="mt-4 text-sm text-slate-600">{doctor.bio}</p>}
        <h3 className="mt-4 text-sm font-semibold">Working hours</h3>
        <ul className="mt-1 text-sm text-slate-600">
          {doctor.availability.map((a) => (
            <li key={a.id}>{WEEKDAYS[a.weekday]}: {a.start_time.slice(0, 5)}–{a.end_time.slice(0, 5)}</li>
          ))}
        </ul>
      </aside>

      <section className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
        <h2 className="text-lg font-semibold">Book an appointment</h2>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
          {days.map((d) => {
            const v = isoDate(d);
            return (
              <button
                key={v}
                onClick={() => setDay(v)}
                className={`min-w-16 rounded-lg border px-3 py-2 text-center text-sm ${day === v ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300"}`}
              >
                <div className="text-xs">{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                <div className="font-semibold">{d.getDate()}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          {slots === null ? (
            <p className="text-slate-500">Loading slots…</p>
          ) : slots.filter((s) => s.available).length === 0 ? (
            <p className="text-slate-500">No free slots on this day. Try another date.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {slots.map((s) => (
                <button
                  key={s.start}
                  disabled={!s.available}
                  onClick={() => setPicked(s)}
                  className={`rounded-md border px-2 py-1.5 text-sm ${
                    picked?.start === s.start
                      ? "border-teal-600 bg-teal-600 text-white"
                      : s.available
                        ? "border-slate-300 hover:border-teal-500"
                        : "cursor-not-allowed border-slate-100 text-slate-300 line-through"
                  }`}
                >
                  {fmtTime(s.start)}
                </button>
              ))}
            </div>
          )}
        </div>

        {picked && (
          <div className="mt-6 space-y-3 border-t border-slate-100 pt-4">
            <p className="text-sm">Selected: <strong>{fmtDateTime(picked.start)}</strong></p>
            <input className="input" placeholder="Reason for visit (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            {user && user.role !== "patient" ? (
              <p className="text-sm text-slate-500">Only patient accounts can book appointments.</p>
            ) : (
              <button className="btn-primary" onClick={book} disabled={busy}>
                {busy ? "Booking…" : user ? "Confirm booking" : "Log in to book"}
              </button>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      </section>
    </div>
  );
}
