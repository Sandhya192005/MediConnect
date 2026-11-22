"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { IconTile } from "@/components/DashboardShell";
import DoctorAppointmentsPanel from "@/components/DoctorAppointmentsPanel";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import type { DoctorAppointments } from "@/lib/types";

/**
 * A MediConnect doctor's appointments at this hospital, by their doctor account id (links from Appointments and
 * from doctors not on the staff list yet). Doctors on the staff list have a full page under Doctor management.
 */
export default function DoctorAppointmentsPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<DoctorAppointments["doctor"] | null>(null);
  const onLoaded = useCallback((data: DoctorAppointments) => setD(data.doctor), []);

  return (
    <RoleGuard role="hospital">
      <Link href="/admin/doctors" className="dash-link mb-3">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> Doctor management
      </Link>
      <div className="space-y-6">
        {d && (
          <section aria-label="Doctor" className="dash-card flex flex-wrap items-center gap-4 p-5">
            <IconTile icon="stethoscope" tone="blue" />
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-bold text-[#00295c]">{d.name}</h1>
              <p className="text-sm text-slate-600">{[d.specialization, d.department].filter(Boolean).join(" · ") || "No specialization yet"} · {d.email}</p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-[650] ring-1 ${d.is_bookable ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
              {d.is_bookable ? "Taking bookings" : "Not bookable yet"}
            </span>
          </section>
        )}
        <DoctorAppointmentsPanel doctorId={id} onLoaded={onLoaded} />
      </div>
    </RoleGuard>
  );
}
