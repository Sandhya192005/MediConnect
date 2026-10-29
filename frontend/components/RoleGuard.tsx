"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Role } from "@/lib/api";
import { dashboardFor, useAuth } from "@/lib/auth";

/** Only renders children for a logged-in user with the given role. */
export default function RoleGuard({ role, children }: { role: Role; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.role !== role) router.replace(dashboardFor(user.role));
  }, [user, loading, role, router]);

  if (loading || !user || user.role !== role) {
    return <p className="p-8 text-center text-slate-500">Loading…</p>;
  }
  return <>{children}</>;
}
