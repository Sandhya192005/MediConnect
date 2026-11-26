"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Panel, SkeletonRows } from "@/components/DashboardShell";
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
              Any doctor or hospital on MediConnect can open your records with your patient ID. Every time they do, it&apos;s saved in your access history.
            </p>
            {/* The full list lives on its own page with filters (owner request 2026-11-26). */}
            {log === null ? (
              <SkeletonRows rows={1} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Icon name="shield" className="h-5 w-5 shrink-0 text-slate-400" />
                <p className="min-w-0 flex-1 text-sm text-slate-600">
                  {log.length === 0 ? "No one has opened your records yet." : (
                    <>
                      Opened <b>{log.length >= 200 ? "200+" : log.length}</b> {log.length === 1 ? "time" : "times"}. Last by{" "}
                      <b>{log[0].viewer_role === "doctor" ? `Dr. ${log[0].viewer_name}` : log[0].viewer_name}</b>, {timeAgo(log[0].created_at)}.
                    </>
                  )}
                </p>
                <Link href="/patient/records/access" className="btn-outline px-3 py-1.5 text-sm">
                  View access history <Icon name="arrow" className="h-4 w-4" />
                </Link>
              </div>
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
