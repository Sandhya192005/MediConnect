"use client";

import AppointmentList from "@/components/AppointmentList";
import RoleGuard from "@/components/RoleGuard";

export default function DoctorAppointmentsPage() {
  return (
    <RoleGuard role="doctor">
      <h1 className="mb-4 text-2xl font-bold">My appointments</h1>
      <AppointmentList viewer="doctor" />
    </RoleGuard>
  );
}
