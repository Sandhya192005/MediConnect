"use client";

import { useParams } from "next/navigation";
import RoleGuard from "@/components/RoleGuard";
import SlipPage from "@/components/SlipPage";

/** One of the patient's payment slips, printable (2026-11-21). */
export default function PatientSlipPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RoleGuard role="patient">
      <SlipPage endpoint={`/api/payments/${id}/`} back={{ href: "/patient/payments", label: "My payments" }} />
    </RoleGuard>
  );
}
