"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, Panel, SkeletonRows } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { timeAgo, type RecordAccess } from "@/lib/types";

type Who = "doctor" | "hospital" | "admin";
type Filter = "all" | Who;

/** Who looked: a doctor, a hospital account, or the MediConnect (platform) admin. Older hospital entries say "admin". */
const whoOf =(e: RecordAccess): Who =>
  e.viewer_role === "doctor" ? "doctor" : e.viewer_role === "hospital" || e.hospital_name ? "hospital" : "admin";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "doctor", label: "Doctors" },
  { key: "hospital", label: "Hospitals" },
  { key: "admin", label: "MediConnect admin" },
];

/**
 * Access history (owner request 2026-11-26): every time a doctor, hospital or the MediConnect admin opened the
 * patient's records or a file, on its own page with filters. My records links here.
 */
export default function AccessHistoryPage() {
  const [log, setLog] = useState<RecordAccess[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    api<RecordAccess[]>("/api/records/access-log/").then(setLog).catch((e) => { setLog([]); setError(errorMessage(e)); });
  }, []);

  const count = (f: Filter) => (log ?? []).filter((e) => f === "all" || whoOf(e) === f).length;
  // The admin chip only appears if the MediConnect admin ever looked.
  const filters = FILTERS.filter((f) => f.key !== "admin" || count("admin") > 0);
  const shown = (log ?? []).filter((e) => filter === "all" || whoOf(e) === filter);

  return (
    <RoleGuard role="patient">
      <Link href="/patient/records" className="dash-link mb-4 inline-flex items-center gap-1 text-sm">← My medical records</Link>
      <div className="mb-6">
        <h1 className="page-title">Access history</h1>
        <p className="page-subtitle text-sm">
          Any doctor or hospital on MediConnect can open your records with your patient ID. Every time they do, it&apos;s listed here.
        </p>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <Panel title={`Who opened your records${log ? ` (${shown.length})` : ""}`}>
        {log !== null && log.length > 0 && (
          <div className="-mt-1 mb-4 flex flex-wrap gap-2" role="group" aria-label="Show">
            {filters.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
                      className={filter === f.key ? "chip-active" : "chip"}>
                {f.label} ({count(f.key)})
              </button>
            ))}
          </div>
        )}
        {log === null ? (
          <SkeletonRows rows={4} />
        ) : log.length === 0 ? (
          <EmptyState icon="shield" title="No one has opened your records" />
        ) : shown.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing here for this filter.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((e) => {
              const who = whoOf(e);
              return (
                <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                  <Icon name={e.action === "download" ? "file" : "eye"} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1">
                    <span className="font-[650] text-[#00295c]">{who === "doctor" ? `Dr. ${e.viewer_name}` : e.viewer_name}</span>
                    {who !== "doctor" && <span className="text-slate-500"> ({who === "hospital" ? "hospital" : "MediConnect admin"})</span>}
                    {e.hospital_name && e.hospital_name !== e.viewer_name && <span className="text-slate-500"> · {e.hospital_name}</span>}
                    <span className="block text-xs text-slate-500">
                      {e.action_label}
                      {e.record_title && `: ${e.record_title}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-slate-400" title={new Date(e.created_at).toLocaleString()}>
                    {timeAgo(e.created_at)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {log !== null && log.length >= 200 && (
          <p className="mt-3 text-xs text-slate-400">Showing the latest 200 times.</p>
        )}
      </Panel>
    </RoleGuard>
  );
}
