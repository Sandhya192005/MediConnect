"use client";

import type { Role } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import RoleGuard from "./RoleGuard";

type Card = { title: string; text: string; phase: string };

/** Shared dashboard layout; the cards are placeholders filled in by later phases. */
export default function DashboardShell({ role, heading, cards }: { role: Role; heading: string; cards: Card[] }) {
  return (
    <RoleGuard role={role}>
      <Greeting heading={heading} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div key={c.title} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold">{c.title}</h3>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{c.phase}</span>
            </div>
            <p className="mt-1 text-sm text-slate-600">{c.text}</p>
          </div>
        ))}
      </div>
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
