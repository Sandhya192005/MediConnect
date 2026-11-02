"use client";

import PageHeader from "@/components/PageHeader";
import AppointmentList from "@/components/AppointmentList";
import RoleGuard from "@/components/RoleGuard";

export default function DoctorAppointmentsPage() {
  return (
    <RoleGuard role="doctor">
      <div className="mb-6"><PageHeader icon="calendar" title="My appointments" subtitle="Confirm new bookings, mark visits done, or cancel." /></div>
      <AppointmentList viewer="doctor" />
    </RoleGuard>
  );
}
