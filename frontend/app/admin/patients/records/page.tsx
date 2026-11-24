"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import RoleGuard from "@/components/RoleGuard";

/**
 * The hospital's old "Patient records" page. Since 2026-11-21 (owner request) everything about a patient is in
 * Patient management, so old links (`?id=P483920`) open that patient's page there.
 */
export default function OldPatientRecordsPage() {
  const router = useRouter();
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    router.replace(id ? `/admin/patients/${encodeURIComponent(id.trim().toUpperCase())}` : "/admin/patients");
  }, [router]);
  return (
    <RoleGuard role="hospital">
      <p className="text-sm text-slate-500">Opening Patient management…</p>
    </RoleGuard>
  );
}
