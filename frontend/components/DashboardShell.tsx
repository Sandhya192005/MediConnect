"use client";

import Link from "next/link";
import type { Role } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import RoleGuard from "./RoleGuard";

type Card = { title: string; text: string; href?: string; phase?: string };

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
                <h3 className="font-semibold">{c.title}</h3>
                {c.phase && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{c.phase}</span>}
              </div>
              <p className="mt-1 text-sm text-slate-600">{c.text}</p>
            </>
          );
          return c.href ? (
            <Link key={c.title} href={c.href} className="rounded-xl border border-slate-200 bg-white p-5 hover:border-teal-400 hover:shadow-sm">
              {body}
            </Link>
          ) : (
            <div key={c.title} className="rounded-xl border border-dashed border-slate-200 bg-white p-5 opacity-70">
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
  return (
    <div>
      <h1 className="text-2xl font-bold">{heading}</h1>
      <p className="text-slate-600">Welcome, {user?.first_name || user?.email}</p>
    </div>
  );
}
