"use client";

import { useState } from "react";
import { downloadFile, errorMessage } from "@/lib/api";
import { fmtDate, fmtSize, RECORD_TYPES, type MedicalRecord } from "@/lib/types";
import { EmptyState, IconTile, type Tone } from "./DashboardShell";
import Icon from "./Icons";

const TONE: Record<string, Tone> = { lab_report: "rose", scan: "indigo", xray: "blue", prescription: "teal", discharge: "orange", other: "teal" };

/** A list of medical records with Download (and Delete for the patient's own list). */
export default function RecordList({
  records,
  onDelete,
  empty,
}: {
  records: MedicalRecord[];
  /** Patient's own list only. */
  onDelete?: (r: MedicalRecord) => Promise<void>;
  empty: { title: string; text?: string };
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function run(id: number, task: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  if (records.length === 0) return <EmptyState icon="folder" title={empty.title} text={empty.text} />;

  return (
    <>
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <ul className="divide-y divide-slate-100">
        {records.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <IconTile icon={RECORD_TYPES.find((t) => t.value === r.record_type)?.icon ?? "file"} tone={TONE[r.record_type]} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-sm font-[650] text-[#00295c]">{r.title}</p>
                <p className="truncate text-xs text-slate-500">
                  {r.record_type_label}
                  {r.record_date && ` · ${fmtDate(r.record_date)}`} · {fmtSize(r.size)} · {r.original_name}
                </p>
                {r.notes && <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{r.notes}</p>}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => run(r.id, () => downloadFile(`/api/records/${r.id}/file/`, r.original_name))}
                disabled={busy === r.id}
                className="btn-outline px-3 py-1.5 text-xs"
                aria-label={`Download ${r.title}`}
              >
                <Icon name="arrow" className="h-3.5 w-3.5 rotate-90" />
                Download
              </button>
              {onDelete && (
                <button
                  onClick={() => window.confirm(`Delete "${r.title}"? The file is removed for good.`) && run(r.id, () => onDelete(r))}
                  disabled={busy === r.id}
                  className="btn border border-red-200 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-50"
                  aria-label={`Delete ${r.title}`}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
