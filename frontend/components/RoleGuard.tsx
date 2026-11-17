"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Role } from "@/lib/api";
import { dashboardFor, useAuth } from "@/lib/auth";

/**
 * Only renders children for a logged-in user with the given role.
 * Without `role` (shared pages like Profile & settings), any logged-in user may see them.
 */
export default function RoleGuard({ role, children }: { role?: Role; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const allowed = !!user && (!role || user.role === role);

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (role && user.role !== role) router.replace(dashboardFor(user.role));
  }, [user, loading, role, router]);

  if (loading || !allowed) {
    return <p className="p-8 text-center text-slate-500">Loading…</p>;
  }
  return <>{children}</>;
}
