"use client";

import { useParams } from "next/navigation";
import RoleGuard from "@/components/RoleGuard";
import SlipPage from "@/components/SlipPage";

/** A payment slip, printable (hospital, 2026-11-21). */
export default function HospitalSlipPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <RoleGuard role="hospital">
      <SlipPage endpoint={`/api/hospital-admin/payments/${id}/`} back={{ href: "/admin/patients", label: "Patient management" }} />
    </RoleGuard>
  );
}
