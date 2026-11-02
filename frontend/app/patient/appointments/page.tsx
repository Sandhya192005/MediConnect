"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppointmentList from "@/components/AppointmentList";
import ExternalAppointmentList from "@/components/ExternalAppointmentList";
import RequestList from "@/components/RequestList";
import Icon from "@/components/Icons";
import PageHeader from "@/components/PageHeader";
import RoleGuard from "@/components/RoleGuard";

function BookedBanner() {
  const booked = useSearchParams().get("booked");
  return booked ? (
    <p className="mb-4 flex items-start gap-2 rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm text-teal-900"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0" />Your appointment is booked. A confirmation email is on its way, and we&apos;ll remind you 24 hours and 1 hour before.</p>
  ) : null;
}

export default function PatientAppointmentsPage() {
  return (
    <RoleGuard role="patient">
      <div className="mb-6">
        <PageHeader icon="calendar" title="My appointments" subtitle="Your MediConnect bookings, requests and visits booked directly with hospitals.">
          <Link href="/doctors" className="btn-solid"><Icon name="search" className="h-4 w-4" /> Book new</Link>
        </PageHeader>
      </div>
      <Suspense>
        <BookedBanner />
      </Suspense>
      <AppointmentList viewer="patient" />
      <RequestList />
      <ExternalAppointmentList />
    </RoleGuard>
  );
}
