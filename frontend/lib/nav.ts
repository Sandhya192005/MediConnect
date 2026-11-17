import { API_URL, type Role } from "./api";

/**
 * Sidebar menu for each role.
 * An item without `href` is a planned feature: it is shown greyed out with "Soon" (its step of the
 * dashboards plan in the tooltip),
 * so the menu matches the plan without pretending the page exists.
 */
export type NavItem = { label: string; icon: string; href?: string; soon?: string; external?: boolean };

export const NAV: Record<Role, NavItem[]> = {
  patient: [
    { label: "Dashboard", icon: "grid", href: "/patient" },
    { label: "Find hospitals", icon: "hospital", href: "/hospitals" },
    { label: "Find doctors", icon: "stethoscope", href: "/doctors" },
    { label: "My appointments", icon: "calendar", href: "/patient/appointments" },
    { label: "My medical records", icon: "folder", href: "/patient/records" },
    { label: "Profile & settings", icon: "settings", soon: "Later" },
  ],
  doctor: [
    { label: "Dashboard", icon: "grid", href: "/doctor" },
    { label: "My hospital & profile", icon: "hospital", href: "/doctor/profile" },
    { label: "Duty schedule", icon: "clock", href: "/doctor/availability" },
    { label: "Appointments", icon: "calendar", href: "/doctor/appointments" },
    { label: "Patient queue", icon: "queue", soon: "Step 3" },
    { label: "Patient records", icon: "file", href: "/doctor/records" },
  ],
  admin: [
    { label: "Dashboard", icon: "grid", href: "/admin" },
    { label: "Hospital management", icon: "hospital", href: "/admin/hospitals" },
    { label: "Appointment requests", icon: "calendar", href: "/admin/requests" },
    { label: "Doctors", icon: "stethoscope", soon: "Step 4" },
    { label: "Nurses", icon: "nurse", soon: "Step 4" },
    { label: "Patients", icon: "users", soon: "Step 4" },
    { label: "Staff & salary", icon: "rupee", soon: "Step 4" },
    { label: "Reports", icon: "chart", soon: "Step 4" },
    { label: "Django admin", icon: "external", href: `${API_URL}/admin/`, external: true },
  ],
};

/** Pages that open inside the dashboard layout for a logged-in user (besides /patient, /doctor, /admin). */
export const SHELL_PATHS = ["/patient", "/doctor", "/admin", "/doctors", "/hospitals"];

/** Login and sign-up use their own full-screen layout. */
export const AUTH_PATHS = ["/login", "/register"];

export const matches = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** The most specific menu item for the current page ("/doctor/profile" beats "/doctor"). */
export function activeHref(pathname: string, items: NavItem[]) {
  return items
    .filter((i) => i.href && !i.external && matches(pathname, i.href))
    .sort((a, b) => b.href!.length - a.href!.length)[0]?.href;
}
