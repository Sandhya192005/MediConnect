"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { WEEKDAYS, type Doctor } from "@/lib/types";
import { Avatar } from "./PageHeader";

export const specialtyOf = (d: Doctor) => d.department_name || d.specialization || "General";

/** A MediConnect hospital's doctors, grouped by specialty, with chips to show one specialty. */
export default function SpecialistList({ doctors, searching }: { doctors: Doctor[]; searching: boolean }) {
  const [picked, setPicked] = useState("");

  // /hospitals/12?specialty=Cardiology (from the search page) opens on that specialty.
  useEffect(() => {
    setPicked(new URLSearchParams(window.location.search).get("specialty") ?? "");
  }, []);

  const groups = new Map<string, Doctor[]>();
  for (const d of doctors) groups.set(specialtyOf(d), [...(groups.get(specialtyOf(d)) ?? []), d]);
  const names = [...groups.keys()].sort();
  const shown = picked && groups.has(picked) ? [picked] : names;

  if (doctors.length === 0) {
    return <p className="text-sm text-slate-500">{searching ? "No MediConnect doctor matches your search." : "No doctors listed yet."}</p>;
  }

  return (
    <div>
      {names.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Specialties">
          <button
            onClick={() => setPicked("")}
            aria-pressed={!picked}
            className={!picked ? "chip-active" : "chip"}
          >
            All specialties ({doctors.length})
          </button>
          {names.map((n) => (
            <button
              key={n}
              onClick={() => setPicked(n)}
              aria-pressed={picked === n}
              className={picked === n ? "chip-active" : "chip"}
            >
              {n} ({groups.get(n)!.length})
            </button>
          ))}
        </div>
      )}

      <div className="space-y-5">
        {shown.map((n) => (
          <section key={n} aria-label={n}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-700">{n}</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {groups.get(n)!.map((d) => (
                <Link key={d.id} href={`/doctors/${d.id}`} className="card-hover flex gap-3 p-4">
                  <Avatar name={d.name} />
                  <div className="min-w-0 flex-1">
                  <p className="font-semibold text-navy-800">Dr. {d.name}</p>
                  <p className="text-sm text-teal-700">{d.specialization}</p>
                  {d.qualification && <p className="text-xs text-slate-500">{d.qualification}</p>}
                  <p className="mt-1 text-sm text-slate-600">{d.experience_years} yrs experience · ₹{Number(d.fee).toFixed(0)}</p>
                  {d.availability.length > 0 && (
                    <p className="text-xs text-slate-500">
                      Works {[...new Set(d.availability.map((a) => WEEKDAYS[a.weekday]?.slice(0, 3)))].join(", ")}
                    </p>
                  )}
                  <p className="mt-2 text-sm font-semibold text-teal-700">See free slots & book →</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
