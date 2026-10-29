"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppointmentList from "@/components/AppointmentList";
import RoleGuard from "@/components/RoleGuard";

function BookedBanner() {
  const booked = useSearchParams().get("booked");
  return booked ? (
    <p className="mb-4 rounded-md bg-teal-50 p-3 text-sm text-teal-800">Your appointment is booked. A confirmation email is on its way, and we&apos;ll remind you 24 hours and 1 hour before.</p>
  ) : null;
}

export default function PatientAppointmentsPage() {
  return (
    <RoleGuard role="patient">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">My appointments</h1>
        <Link href="/doctors" className="rounded-md bg-teal-600 px-3 py-1.5 text-sm text-white">Book new</Link>
      </div>
      <Suspense>
        <BookedBanner />
      </Suspense>
      <AppointmentList viewer="patient" />
    </RoleGuard>
  );
}
