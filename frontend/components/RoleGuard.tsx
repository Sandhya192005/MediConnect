"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { Role } from "@/lib/api";
import { dashboardFor, useAuth } from "@/lib/auth";

/**
 * Only renders children for a logged-in user with the given role (or one of the given roles).
 * Without `role` (shared pages like Profile & settings), any logged-in user may see them.
 */
export default function RoleGuard({ role, children }: { role?: Role | Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const fits = !!user && (!role || (Array.isArray(role) ? role.includes(user.role) : user.role === role));
  const allowed = fits;

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!fits) router.replace(dashboardFor(user.role));
  }, [user, loading, fits, router]);

  if (loading || !allowed) {
    return <p className="p-8 text-center text-slate-500">Loading…</p>;
  }
  return <>{children}</>;
}
