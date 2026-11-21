"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Find hospitals moved into Book appointment (/doctors) (owner request 2026-11-18). Old links to /hospitals
 * (bookmarks, emails) keep working: forward them, keeping the search words.
 */
export default function HospitalsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(`/doctors${window.location.search}`);
  }, [router]);
  return <p className="p-8 text-center text-sm text-slate-500">Opening Book an appointment…</p>;
}