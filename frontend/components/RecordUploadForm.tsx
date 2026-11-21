"use client";

import { useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { isoDate, RECORD_TYPES, type RecordType } from "@/lib/types";
import { Panel } from "./DashboardShell";
import Icon from "./Icons";

const MAX_MB = 10;

/**
 * Upload a medical record (PDF, JPG or PNG). The patient uploads to /api/records/; a hospital uploads for a
 * patient to /api/hospital-admin/patients/<id>/records/ (Patient management, 2026-11-21).
 */
export default function RecordUploadForm({ onUploaded, endpoint = "/api/records/", title: panelTitle = "Add a record" }: {
  onUploaded: () => void;
  endpoint?: string;
  title?: string;
}) {
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
      await api(endpoint, { method: "POST", body: form });
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
    <Panel title={panelTitle}>
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
