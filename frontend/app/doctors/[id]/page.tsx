"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import Icon from "@/components/Icons";
import { Avatar } from "@/components/PageHeader";
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

  // Slots grouped by part of the day, so a long list is easy to scan.
  const PARTS = [
    { name: "Morning", icon: "sparkles", from: 0, to: 12 },
    { name: "Afternoon", icon: "clock", from: 12, to: 17 },
    { name: "Evening", icon: "clock", from: 17, to: 24 },
  ];
  const freeCount = slots?.filter((s) => s.available).length ?? 0;

  // Next 14 days for the date picker.
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="space-y-6">
      <Link href="/doctors" className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline">← Find hospitals or doctors</Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <aside className="space-y-4 lg:col-span-1">
          <div className="card overflow-hidden">
            <div className="bg-brand-gradient h-20" />
            <div className="px-5 pb-5">
              <div className="-mt-8 w-fit rounded-full border-4 border-white"><Avatar name={doctor.name} size="lg" /></div>
              <h1 className="mt-3 text-xl font-bold text-navy-800">Dr. {doctor.name}</h1>
              <p className="font-medium text-teal-700">{doctor.specialization}</p>
              {doctor.qualification && <p className="mt-0.5 text-sm text-slate-500">{doctor.qualification}</p>}
              <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-bold text-navy-800">{doctor.experience_years}</p><p className="text-xs text-slate-500">years experience</p></div>
                <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-bold text-navy-800">₹{Number(doctor.fee).toFixed(0)}</p><p className="text-xs text-slate-500">consultation fee</p></div>
              </div>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex gap-2"><Icon name="hospital" className="h-4 w-4 shrink-0 text-teal-700" /><dd>{doctor.hospital_name}, {doctor.hospital_city}</dd></div>
                {doctor.department_name && <div className="flex gap-2"><Icon name="stethoscope" className="h-4 w-4 shrink-0 text-teal-700" /><dd>{doctor.department_name}</dd></div>}
              </dl>
              {doctor.bio && <p className="mt-4 text-sm text-slate-600">{doctor.bio}</p>}
            </div>
          </div>
          {doctor.availability.length > 0 && (
            <div className="card p-5">
              <h2 className="section-title flex items-center gap-2"><Icon name="clock" className="h-4 w-4 text-teal-700" /> Working hours</h2>
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {doctor.availability.map((a) => (
                  <li key={a.id} className="flex justify-between py-1.5">
                    <span className="text-slate-600">{WEEKDAYS[a.weekday]}</span>
                    <span className="font-medium text-slate-800">{a.start_time.slice(0, 5)}–{a.end_time.slice(0, 5)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        <section className="card p-5 sm:p-6 lg:col-span-2">
          <h2 className="section-title flex items-center gap-2"><Icon name="calendar" className="h-5 w-5 text-teal-700" />Book an appointment</h2>
          <p className="text-sm text-slate-500">Choose a day, then a free time.</p>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {days.map((d, i) => {
              const v = isoDate(d);
              const on = day === v;
              return (
                <button
                  key={v}
                  onClick={() => setDay(v)}
                  aria-pressed={on}
                  className={`min-w-16 shrink-0 rounded-xl border px-3 py-2 text-center transition ${
                    on ? "border-teal-600 bg-teal-600 text-white shadow-md shadow-teal-600/25" : "border-slate-200 bg-white hover:border-teal-400"
                  }`}
                >
                  <div className={`text-xs ${on ? "text-teal-50" : "text-slate-500"}`}>{i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                  <div className="text-lg font-bold">{d.getDate()}</div>
                  <div className={`text-[10px] uppercase ${on ? "text-teal-50" : "text-slate-400"}`}>{d.toLocaleDateString(undefined, { month: "short" })}</div>
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            {slots === null ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {Array.from({ length: 10 }, (_, i) => <span key={i} className="h-9 animate-pulse rounded-lg bg-slate-100" />)}
              </div>
            ) : freeCount === 0 ? (
              <div className="flex flex-col items-center rounded-xl bg-slate-50 p-8 text-center">
                <Icon name="calendar" className="h-8 w-8 text-slate-300" />
                <p className="mt-2 font-medium text-slate-700">No free slots on this day.</p>
                <p className="text-sm text-slate-500">Try another date.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-slate-500">{freeCount} free slot{freeCount === 1 ? "" : "s"}</p>
                {PARTS.map((part) => {
                  const inPart = slots.filter((s) => {
                    const h = new Date(s.start).getHours();
                    return h >= part.from && h < part.to;
                  });
                  if (inPart.length === 0) return null;
                  return (
                    <div key={part.name}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{part.name}</p>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                        {inPart.map((s) => (
                          <button
                            key={s.start}
                            disabled={!s.available}
                            onClick={() => setPicked(s)}
                            className={`rounded-lg border px-2 py-2 text-sm font-medium transition ${
                              picked?.start === s.start
                                ? "border-teal-600 bg-teal-600 text-white shadow-md shadow-teal-600/25"
                                : s.available
                                  ? "border-slate-200 bg-white text-slate-700 hover:border-teal-500 hover:text-teal-700"
                                  : "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300 line-through"
                            }`}
                          >
                            {fmtTime(s.start)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {picked && (
            <div className="mt-6 space-y-3 rounded-2xl border border-teal-200 bg-teal-50/60 p-4">
              <p className="flex items-center gap-2 text-sm text-navy-800">
                <Icon name="check" className="h-4 w-4 text-teal-700" />
                Selected: <strong>{fmtDateTime(picked.start)}</strong> with Dr. {doctor.name}
              </p>
              <input className="input" placeholder="Reason for visit (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
              {user && user.role !== "patient" ? (
                <p className="text-sm text-slate-500">Only patient accounts can book appointments.</p>
              ) : (
                <button className="btn-primary py-3" onClick={book} disabled={busy}>
                  {busy ? "Booking…" : user ? "Confirm booking" : "Log in to book"}
                </button>
              )}
            </div>
          )}
          {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        </section>
      </div>
    </div>
  );
}
