"use client";

import Link from "next/link";
import type { Role } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import Icon from "./Icons";
import RoleGuard from "./RoleGuard";

type Card = { title: string; text: string; href?: string; phase?: string; icon?: string };

/** Picks an icon from the card's title when none is given. */
function iconFor(c: Card) {
  if (c.icon) return c.icon;
  const t = c.title.toLowerCase();
  if (/book|appointment|schedule/.test(t)) return "calendar";
  if (/hours|availability|time/.test(t)) return "clock";
  if (/hospital|near|map/.test(t)) return "hospital";
  if (/profile|account/.test(t)) return "user";
  if (/request/.test(t)) return "chat";
  if (/doctor/.test(t)) return "doctor";
  return "grid";
}

/** Shared dashboard layout. Cards with an href link to a page; others show the phase they arrive in. */
export default function DashboardShell({
  role,
  heading,
  cards,
  children,
}: {
  role: Role;
  heading: string;
  cards: Card[];
  children?: React.ReactNode;
}) {
  return (
    <RoleGuard role={role}>
      <Greeting heading={heading} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-50 text-teal-700 transition group-hover:bg-teal-600 group-hover:text-white">
                  <Icon name={iconFor(c)} />
                </span>
                {c.phase && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{c.phase}</span>}
              </div>
              <h3 className="mt-4 font-semibold text-navy-800">{c.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{c.text}</p>
              {c.href && <p className="mt-3 text-sm font-semibold text-teal-700">Open →</p>}
            </>
          );
          return c.href ? (
            <Link key={c.title} href={c.href} className="card-hover group p-5">
              {body}
            </Link>
          ) : (
            <div key={c.title} className="rounded-2xl border border-dashed border-slate-200 bg-white p-5 opacity-70">
              {body}
            </div>
          );
        })}
      </div>
      {children}
    </RoleGuard>
  );
}

function Greeting({ heading }: { heading: string }) {
  const { user } = useAuth();
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return (
    <div className="bg-brand-gradient relative overflow-hidden rounded-3xl px-6 py-8 text-white sm:px-8">
      <div className="pointer-events-none absolute -right-10 -top-12 h-48 w-48 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute -bottom-16 right-32 h-40 w-40 rounded-full bg-white/10" />
      <h1 className="relative text-sm font-medium text-teal-50/90">{heading}</h1>
      <p className="relative mt-1 text-2xl font-bold sm:text-3xl">
        {hello}, {user?.first_name || user?.email}
      </p>
      <p className="relative mt-1 text-teal-50">What would you like to do today?</p>
    </div>
  );
}
