"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, type Role } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { useAuth } from "@/lib/auth";
import { activeHref, navFor, type NavItem } from "@/lib/nav";
import Icon from "./Icons";
import NotificationBell from "./NotificationBell";

/**
 * Layout for logged-in users: a sidebar with the role's menu, a top bar with search,
 * notifications and the user, and the page content.
 * Following the reference design, patients get a dark teal sidebar; doctors and admins a light one.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const role: Role = user?.role ?? (pathname.startsWith("/doctor/") || pathname === "/doctor" ? "doctor" : pathname.startsWith("/admin") ? "hospital" : "patient");
  const dark = role === "patient";

  useEffect(() => setMenuOpen(false), [pathname]); // close the phone menu after navigating

  return (
    <div className="app-shell min-h-screen">
      {/* Desktop sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 hidden w-64 flex-col lg:flex ${
          dark ? "bg-gradient-to-b from-[#0b3a78] to-[#00295c] text-white" : "border-r border-slate-200/80 bg-white"
        }`}
      >
        <Sidebar role={role} dark={dark} />
      </aside>

      {/* Phone/tablet sidebar (slides in) */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          {/* The dimmed backdrop also closes the menu; it's a mouse/touch target only (the ✕ button is the accessible one). */}
          <div className="absolute inset-0 bg-slate-900/40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
          <aside
            className={`relative flex h-full w-72 max-w-[85vw] flex-col shadow-xl ${
              dark ? "bg-gradient-to-b from-[#0b3a78] to-[#00295c] text-white" : "bg-white"
            }`}
          >
            <button
              onClick={() => setMenuOpen(false)}
              aria-label="Close menu"
              className={`absolute right-3 top-5 rounded-xl p-2 ${dark ? "text-white/80 hover:bg-white/10" : "text-slate-500 hover:bg-slate-100"}`}
            >
              <Icon name="close" />
            </button>
            <Sidebar role={role} dark={dark} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <TopBar onMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({ role, dark }: { role: Role; dark: boolean }) {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const items = navFor(role, user);
  const current = activeHref(pathname, items);

  function doLogout() {
    logout();
    router.push("/login");
  }

  return (
    <div className="flex h-full flex-col px-4 py-5">
      <Link href={`/${role}`} className="flex items-center gap-2.5 px-2" aria-label="MediConnect dashboard">
        {/* The clear logo has see-through white parts, so it sits on a white tile on the dark sidebar. */}
        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${dark ? "bg-white" : ""}`}>
          <Image src="/logo-mark-clear.png" alt="" width={34} height={34} priority />
        </span>
        <span className={`text-xl font-[650] tracking-tight ${dark ? "text-white" : "text-[#00295c]"}`}>MediConnect</span>
      </Link>

      <nav className="mt-8 flex-1 space-y-1 overflow-y-auto" aria-label="Main menu">
        {items.map((item) => (
          <SidebarItem key={item.label} item={item} active={item.href === current} dark={dark} />
        ))}
      </nav>

      {/* Reference design: "Need Help? Contact Support". The emergency numbers stay just below it. The platform
          admin IS the support, so they get their Support inbox here instead (owner request 2026-11-20). */}
      {user?.is_platform_admin ? (
        <SupportInboxLink />
      ) : (
        <Link href="/support" className={`mt-4 flex items-center gap-3 rounded-2xl p-4 transition ${dark ? "bg-white/10 hover:bg-white/15" : "bg-teal-50 hover:bg-teal-100"}`}>
          <Icon name="chat" className={`h-5 w-5 ${dark ? "text-white" : "text-teal-700"}`} />
          <span>
            <span className={`block text-sm font-[650] ${dark ? "text-white" : "text-[#00295c]"}`}>Need help?</span>
            <span className={`block text-xs ${dark ? "text-white/75" : "text-slate-500"}`}>Contact support</span>
          </span>
        </Link>
      )}
      <p className={`mt-2 px-1 text-[11px] ${dark ? "text-white/70" : "text-red-700"}`}>
        Emergency? Call <a href="tel:112" className="font-[650] underline">112</a> or ambulance{" "}
        <a href="tel:108" className="font-[650] underline">108</a>.
      </p>

      <button
        onClick={doLogout}
        className={`mt-3 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          dark ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <Icon name="logout" className="h-[18px] w-[18px]" />
        Log out
      </button>
    </div>
  );
}

function SidebarItem({ item, active, dark }: { item: NavItem; active: boolean; dark: boolean }) {
  const base = "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition";
  const content = (
    <>
      <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.soon && (
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${dark ? "bg-white/10 text-white/70" : "bg-slate-100 text-slate-500"}`}>
          Soon
        </span>
      )}
      {item.external && <Icon name="external" className="h-3.5 w-3.5 opacity-60" />}
    </>
  );

  if (!item.href) {
    // Planned feature: visible so the menu matches the plan, but not clickable.
    return (
      <span aria-disabled="true" title={`Coming soon (${item.soon})`} className={`${base} cursor-default ${dark ? "text-white/45" : "text-slate-400"}`}>
        {content}
      </span>
    );
  }

  const tone = active
    ? dark
      ? "bg-[#dbe6f6] font-[650] text-[#00295c] shadow-sm"
      : "bg-teal-50 font-[650] text-teal-800"
    : dark
      ? "text-white/85 hover:bg-white/10 hover:text-white"
      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900";

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noreferrer" className={`${base} ${tone}`}>
        {content}
      </a>
    );
  }
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={`${base} ${tone}`}>
      {content}
    </Link>
  );
}

/** How many support messages are waiting for the platform admin; refreshed when a notification arrives. */
function useOpenSupportCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const load = () => api<unknown[]>("/api/support/inbox/?status=open").then((rows) => setCount(rows.length)).catch(() => {});
    load();
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, [enabled]);
  return count;
}

/** The platform admin's sidebar box (in place of "Need help?"): their Support inbox, with the open count. */
function SupportInboxLink() {
  const open = useOpenSupportCount(true);
  return (
    <Link href="/admin/support" className="mt-4 flex items-center gap-3 rounded-2xl bg-teal-50 p-4 transition hover:bg-teal-100">
      <Icon name="chat" className="h-5 w-5 text-teal-700" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-[650] text-[#00295c]">Support inbox</span>
        <span className="block text-xs text-slate-500">
          {open === null ? "Messages from users" : open === 0 ? "No open messages" : `${open} open message${open === 1 ? "" : "s"}`}
        </span>
      </span>
      {!!open && <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-[650] text-white" aria-hidden="true">{open}</span>}
    </Link>
  );
}

/** The avatar in the top bar (reference design): opens Profile & settings, Contact support and Log out. */
function UserMenu({ initials, name, email }: { initials: string; name: string; email: string }) {
  const { logout, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const item = "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100";
  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-sm font-[650] text-white" aria-hidden="true">
          {initials}
        </span>
        <span className="hidden min-w-0 text-left leading-tight sm:block">
          <span className="block max-w-44 truncate text-sm font-[650] text-slate-900">{name}</span>
          {email && <span className="block max-w-44 truncate text-xs text-slate-500">{email}</span>}
        </span>
        <Icon name="arrow" className="hidden h-3.5 w-3.5 rotate-90 text-slate-400 sm:block" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10">
          <Link role="menuitem" href="/settings" className={item}><Icon name="settings" className="h-4 w-4" /> Profile &amp; settings</Link>
          {user?.is_platform_admin
            ? <Link role="menuitem" href="/admin/support" className={item}><Icon name="chat" className="h-4 w-4" /> Support inbox</Link>
            : <Link role="menuitem" href="/support" className={item}><Icon name="chat" className="h-4 w-4" /> Contact support</Link>}
          <button
            role="menuitem"
            onClick={() => {
              logout();
              router.push("/login");
            }}
            className={`${item} text-red-700 hover:bg-red-50`}
          >
            <Icon name="logout" className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const fullName = user ? `${user.first_name} ${user.last_name}`.trim() : "";
  const name = !user ? "" : !fullName ? user.email : user.role === "doctor" && !/^dr\.?\s/i.test(fullName) ? `Dr. ${fullName}` : fullName;
  const initials = user ? (`${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}` || user.email[0]).toUpperCase() : "";

  // Patients (and the platform admin) search hospitals and doctors here. Doctors and hospitals get no top-bar
  // search: finding a patient by ID is the "Patient records" menu item (owner request 2026-11-21).
  const showSearch = user?.role !== "doctor" && user?.role !== "hospital" && pathname !== "/doctors";

  function search(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    router.push(term ? `/doctors?q=${encodeURIComponent(term)}` : "/doctors");
  }

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <button onClick={onMenu} className="rounded-xl p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
          <Icon name="menu" />
        </button>

        {/* The search page has its own search box, so the quick search is hidden there. */}
        {showSearch ? (
          <form onSubmit={search} role="search" className="relative max-w-md flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Quick search"
              placeholder="Search doctors, hospitals…"
              className="w-full rounded-full border border-transparent bg-slate-100 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-400 focus:bg-white focus:ring-4 focus:ring-teal-100"
            />
          </form>
        ) : (
          <div className="flex-1" />
        )}

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {user && <NotificationBell />}
          {user && <UserMenu initials={initials} name={name} email={fullName ? user.email : ""} />}
        </div>
      </div>
    </header>
  );
}
