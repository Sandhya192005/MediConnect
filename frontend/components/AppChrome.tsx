"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { AUTH_PATHS, matches, SHELL_PATHS } from "@/lib/nav";
import AppShell from "./AppShell";
import Footer from "./Footer";
import Navbar from "./Navbar";

const ROLE_AREAS = ["/patient", "/doctor", "/admin"];

/**
 * Picks the page frame:
 * - login and sign-up: full-screen, no navigation;
 * - logged-in users on app pages: the dashboard layout (sidebar + top bar);
 * - everyone else: the public top navigation and footer.
 */
export default function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading } = useAuth();

  if (AUTH_PATHS.some((p) => matches(pathname, p))) {
    return <main className="flex-1">{children}</main>;
  }

  const inShellArea = SHELL_PATHS.some((p) => matches(pathname, p));
  const inRoleArea = ROLE_AREAS.some((p) => matches(pathname, p));
  // While the session is being restored, role pages already show the dashboard frame (no flash of the public bar).
  if ((user && inShellArea) || (loading && inRoleArea)) {
    return <AppShell>{children}</AppShell>;
  }

  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      <Footer />
    </>
  );
}
