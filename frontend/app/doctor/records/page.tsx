"use client";

import { Suspense } from "react";
import PatientRecordsLookup from "@/components/PatientRecordsLookup";
import RoleGuard from "@/components/RoleGuard";

export default function DoctorRecordsPage() {
  return (
    <RoleGuard role="doctor">
      <div className="mb-6">
        <h1 className="page-title">Patient records</h1>
        <p className="page-subtitle text-sm">
          Enter a patient&apos;s ID to see their medical history: reports, scans and X-rays. Each view is shown to the patient.
        </p>
      </div>
      <Suspense>
        <PatientRecordsLookup basePath="/doctor/records" />
      </Suspense>
    </RoleGuard>
  );
}
