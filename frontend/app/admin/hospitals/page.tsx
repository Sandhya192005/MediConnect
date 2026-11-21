"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, IconTile, SkeletonRows } from "@/components/DashboardShell";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, type ConnectedHospital } from "@/lib/types";

/**
 * Connected hospitals (owner request 2026-11-20), for the platform admin. Replaces the old "Add hospital" /
 * approval toggle page: hospitals now join only through their own sign-up and connection request
 * (/admin/connections). Here the platform admin sees who is connected and can disconnect one, with a reason
 * the hospital is told.
 */
export default function ConnectedHospitalsPage() {
  return (
    <RoleGuard role="admin">
      <ConnectedHospitals />
    </RoleGuard>
  );
}

function ConnectedHospitals() {
  const [rows, setRows] = useState<ConnectedHospital[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const load = useCallback((query: string) => {
    api<ConnectedHospital[]>(`/api/platform/connected-hospitals/${query ? `?q=${encodeURIComponent(query)}` : ""}`)
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(q.trim()), 250); // wait for typing to pause
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Connected hospitals</h1>
          <p className="page-subtitle text-sm">
            Hospitals patients can find and book. New hospitals join by signing up and asking to connect: see{" "}
            <Link href="/admin/connections" className="dash-link">Connection requests</Link>.
          </p>
        </div>
        <label className="w-full sm:w-72">
          <span className="sr-only">Search connected hospitals</span>
          <input className="input" type="search" placeholder="Search by name or city" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {done && <p role="status" className="mb-4 rounded-xl bg-green-50 px-4 py-2 text-sm text-green-800">{done}</p>}

      {rows === null ? (
        !error && <SkeletonRows rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon="hospital" title={q ? "No connected hospital matches" : "No hospitals connected yet"}
                    text={q ? undefined : "When a hospital asks to connect, approve it under Connection requests."}>
          {!q && <Link href="/admin/connections" className="dash-link mt-3">Connection requests</Link>}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {rows.map((h) => (
            <HospitalCard key={h.id} h={h} onDisconnected={() => {
              setDone(`${h.name} was disconnected. It has been told why and can ask to connect again.`);
              load(q.trim());
            }} />
          ))}
        </ul>
      )}
    </>
  );
}

function HospitalCard({ h, onDisconnected }: { h: ConnectedHospital; onDisconnected: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function disconnect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/api/platform/connected-hospitals/${h.id}/disconnect/`, { method: "POST", body: JSON.stringify({ note }) });
      onDisconnected();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <li aria-label={h.name} className="dash-card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <IconTile icon="hospital" tone="indigo" size="sm" />
        <div className="min-w-0 flex-1">
          <p className="font-[650] text-[#00295c]">{h.name}</p>
          <p className="text-sm text-slate-600">{[h.address, h.city].filter(Boolean).join(", ") || "No address"}{h.phone && ` · ${h.phone}`}</p>
          <p className="mt-1 text-xs text-slate-500">
            {h.account_emails.length ? `Hospital account: ${h.account_emails.join(", ")}` : "No hospital account (added before sign-ups)"}
            {" · "}{h.doctor_count === 1 ? "1 doctor" : `${h.doctor_count} doctors`}
            {" · "}{h.has_pin ? "Map pin set" : "No map pin"}
            {h.approved_at && <> · Connected {h.approved_at_estimated ? "about " : ""}{fmtDate(h.approved_at)}</>}
          </p>
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} className="btn-outline px-4 py-2 text-sm text-red-700">Disconnect</button>
        )}
      </div>
      {open && (
        <form onSubmit={disconnect} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-600">
            Patients won&apos;t find or book {h.name} any more. Appointments already booked stay. The hospital keeps its
            account and can ask to connect again.
          </p>
          <label className="block text-sm font-medium text-slate-700">Reason (the hospital sees this)
            <input className="input mt-1" required maxLength={500} placeholder="e.g. Licence expired" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button className="rounded-xl bg-red-600 px-4 py-2 text-sm font-[650] text-white hover:bg-red-700 disabled:opacity-60" disabled={busy}>
              {busy ? "Disconnecting…" : <>Disconnect<span className="sr-only"> {h.name}</span></>}
            </button>
            <button type="button" onClick={() => { setOpen(false); setNote(""); setError(""); }} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
      )}
    </li>
  );
}
