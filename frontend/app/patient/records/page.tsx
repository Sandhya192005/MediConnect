"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, Panel, SkeletonRows } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import RecordList from "@/components/RecordList";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isoDate, RECORD_TYPES, timeAgo, type MedicalRecord, type RecordAccess, type RecordType } from "@/lib/types";

const MAX_MB = 10;

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
                      <span className="font-[650] text-[#0f2f3a]">{e.viewer_role === "admin" ? e.viewer_name : `Dr. ${e.viewer_name}`}</span>
                      {e.viewer_role === "admin" && <span className="text-slate-500"> (hospital admin)</span>}
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
          <UploadForm onUploaded={load} />
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
      <div className="bg-gradient-to-br from-[#0d5a5f] to-[#0a4248] p-5 text-white">
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

function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<RecordType>("lab_report");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function pick(f: File | null) {
    setError("");
    setDone(false);
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setError(`The file is too large. The limit is ${MAX_MB} MB.`);
      f = null;
      if (fileInput.current) fileInput.current.value = "";
    }
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Choose a file to upload.");
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append("title", title);
    form.append("record_type", type);
    if (date) form.append("record_date", date);
    form.append("notes", notes);
    form.append("file", file);
    try {
      await api("/api/records/", { method: "POST", body: form });
      setTitle("");
      setDate("");
      setNotes("");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      setDone(true);
      onUploaded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Add a record">
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          File
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-teal-50 file:px-4 file:py-2 file:text-sm file:font-[650] file:text-teal-700 hover:file:bg-teal-100"
          />
          <span className="mt-1 block text-xs font-normal text-slate-400">PDF, JPG or PNG, up to {MAX_MB} MB</span>
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Title
          <input className="input mt-1" required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Blood test" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700">
            Type
            <select className="input mt-1" value={type} onChange={(e) => setType(e.target.value as RecordType)}>
              {RECORD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Date
            <input className="input mt-1" type="date" max={isoDate(new Date())} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Notes <span className="font-normal text-slate-400">(optional)</span>
          <textarea className="input mt-1" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {done && <p role="status" className="text-sm text-teal-700">Uploaded.</p>}
        <button className="btn-primary rounded-xl" disabled={busy}>
          <Icon name="folder" className="h-4 w-4" />
          {busy ? "Uploading…" : "Upload record"}
        </button>
      </form>
    </Panel>
  );
}
