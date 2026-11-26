"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, Panel, SkeletonRows } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RecordList from "@/components/RecordList";
import RecordUploadForm from "@/components/RecordUploadForm";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { timeAgo, type MedicalRecord, type RecordAccess } from "@/lib/types";

export default function PatientRecordsPage() {
  const [records, setRecords] = useState<MedicalRecord[] | null>(null);
  const [log, setLog] = useState<RecordAccess[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<MedicalRecord[]>("/api/records/").then(setRecords).catch((e) => {
      setRecords([]);
      setError(errorMessage(e));
    });
    api<RecordAccess[]>("/api/records/access-log/").then(setLog).catch(() => setLog([]));
  }, []);

  useEffect(load, [load]);

  async function remove(r: MedicalRecord) {
    await api(`/api/records/${r.id}/`, { method: "DELETE" });
    setRecords((rs) => rs?.filter((x) => x.id !== r.id) ?? null);
  }

  return (
    <RoleGuard role="patient">
      <div className="mb-6">
        <h1 className="page-title">My medical records</h1>
        <p className="page-subtitle text-sm">Keep your reports, scans and X-rays in one place, ready for your doctor.</p>
      </div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title={`My records${records ? ` (${records.length})` : ""}`}>
            {records === null ? (
              <SkeletonRows rows={3} />
            ) : (
              <RecordList
                records={records}
                onDelete={remove}
                empty={{ title: "No records yet", text: "Upload your first report, scan or X-ray with the form." }}
              />
            )}
          </Panel>

          <Panel title="Who opened your records">
            <p className="-mt-2 mb-4 text-xs text-slate-500">
              Any doctor or hospital admin on MediConnect can open your records with your patient ID. Every time they do, it&apos;s listed here.
            </p>
            {log === null ? (
              <SkeletonRows rows={2} />
            ) : log.length === 0 ? (
              <EmptyState icon="shield" title="No one has opened your records" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {log.map((e) => (
                  <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                    <Icon name={e.action === "download" ? "file" : "eye"} className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <span className="min-w-0 flex-1">
                      <span className="font-[650] text-[#00295c]">{e.viewer_role === "doctor" ? `Dr. ${e.viewer_name}` : e.viewer_name}</span>
                      {e.viewer_role !== "doctor" && <span className="text-slate-500"> ({e.viewer_role === "hospital" ? "hospital" : "MediConnect admin"})</span>}
                      {e.hospital_name && <span className="text-slate-500"> · {e.hospital_name}</span>}
                      <span className="block text-xs text-slate-500">
                        {e.action_label}
                        {e.record_title && `: ${e.record_title}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400" title={new Date(e.created_at).toLocaleString()}>
                      {timeAgo(e.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* On phones the ID and upload form come first; on wide screens they sit on the right. */}
        <div className="order-first space-y-6 lg:order-none">
          <PatientIdCard />
          <RecordUploadForm onUploaded={load} />
        </div>
      </div>
    </RoleGuard>
  );
}

function PatientIdCard() {
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const id = user?.patient_id ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the ID is still visible to copy by hand */
    }
  }

  return (
    <section className="dash-card overflow-hidden" aria-label="Your patient ID">
      <div className="bg-gradient-to-br from-[#0b3a78] to-[#00295c] p-5 text-white">
        <p className="text-xs font-[650] uppercase tracking-[0.14em] text-white/70">Your patient ID</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="font-mono text-3xl font-bold tracking-wider" data-testid="patient-id">{id || "…"}</p>
          <button onClick={copy} disabled={!id} className="rounded-xl bg-white/15 px-3 py-1.5 text-xs font-[650] hover:bg-white/25">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
      <p className="p-5 text-xs text-slate-500">
        Your general health ID: show it at any hospital, and any doctor there can see your medical history. You can see each time someone does.
      </p>
    </section>
  );
}
