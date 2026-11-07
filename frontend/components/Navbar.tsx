"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { dashboardFor, useAuth } from "@/lib/auth";
import Icon from "./Icons";
import NotificationBell from "./NotificationBell";

const LINKS = [
  { href: "/doctors", label: "Find hospitals or doctors", short: "Find", icon: "search" },
  { href: "/hospitals", label: "Map", short: "Map", icon: "map" },
];

export default function Navbar() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]); // close the phone menu after navigating

  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const linkClass = (href: string) =>
    `inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
      active(href) ? "bg-teal-50 text-teal-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
    }`;
  const initials = user ? (`${user.first_name?.[0] ?? ""}${user.last_name?.[0] ?? ""}` || user.email[0]).toUpperCase() : "";

  function doLogout() {
    logout();
    router.push("/login");
  }

  return (
    <header className="sticky top-0 z-30 border-b border-navy-800/10 bg-[#f4f7fa]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2" aria-label="MediConnect home">
          <Image src="/logo-mark-clear.png" alt="" width={32} height={32} priority />
          <span className="hidden font-display text-xl tracking-tight text-navy-800 sm:inline">MediConnect</span>
        </Link>

        {/* Desktop */}
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={linkClass(l.href)}>
              <Icon name={l.icon} className="h-4 w-4" />
              {l.label}
            </Link>
          ))}
          {user && (
            <Link href={dashboardFor(user.role)} className={linkClass(dashboardFor(user.role))}>
              <Icon name="grid" className="h-4 w-4" />
              Dashboard
            </Link>
          )}
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <>
              <NotificationBell />
              <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-3 sm:flex">
                <span className="bg-brand-gradient flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white">
                  {initials}
                </span>
                <span className="max-w-40 truncate text-sm text-slate-600">{user.email}</span>
              </div>
              <button onClick={doLogout} className="btn-ghost hidden px-3 py-2 sm:inline-flex" title="Log out">
                <Icon name="logout" className="h-4 w-4" />
                Log out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="btn-ghost hidden px-3 py-2 sm:inline-flex">Log in</Link>
              <Link href="/register" className="btn-solid px-4 py-2">Sign up</Link>
            </>
          )}
          <button
            onClick={() => setOpen(!open)}
            className="btn-ghost p-2 md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </nav>

      {/* Phone menu */}
      {open && (
        <div className="border-t border-slate-200 bg-white px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={linkClass(l.href)}>
                <Icon name={l.icon} className="h-4 w-4" />
                {l.label}
              </Link>
            ))}
            {user ? (
              <>
                <Link href={dashboardFor(user.role)} className={linkClass(dashboardFor(user.role))}>
                  <Icon name="grid" className="h-4 w-4" />
                  Dashboard
                </Link>
                <p className="px-3 pt-2 text-xs text-slate-500">Signed in as {user.email}</p>
                <button onClick={doLogout} className="btn-outline mt-1">
                  <Icon name="logout" className="h-4 w-4" />
                  Log out
                </button>
              </>
            ) : (
              <Link href="/login" className={linkClass("/login")}>
                <Icon name="user" className="h-4 w-4" />
                Log in
              </Link>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
