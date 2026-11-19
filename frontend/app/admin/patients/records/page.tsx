"use client";

import Link from "next/link";
import { Suspense } from "react";
import Icon from "@/components/Icons";
import PatientRecordsLookup from "@/components/PatientRecordsLookup";
import RoleGuard from "@/components/RoleGuard";

export default function AdminPatientRecordsPage() {
  return (
    <RoleGuard role="hospital">
      <Link href="/admin/patients" className="dash-link mb-3">
        <Icon name="arrow" className="h-4 w-4 rotate-180" /> All patients
      </Link>
      <div className="mb-6">
        <h1 className="page-title">Patient records</h1>
        <p className="page-subtitle text-sm">
          Enter a patient&apos;s ID to see their medical history: reports, scans and X-rays. Each view is shown to the patient.
        </p>
      </div>
      <Suspense>
        <PatientRecordsLookup basePath="/admin/patients/records" />
      </Suspense>
    </RoleGuard>
  );
}
