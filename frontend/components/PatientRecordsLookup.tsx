"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import type { PatientLookup } from "@/lib/types";
import { EmptyState, IconTile, Panel, SkeletonRows } from "./DashboardShell";
import Icon from "./Icons";
import RecordList from "./RecordList";

/**
 * Open a patient's records by patient ID (doctors and admins). The patient ID is a general ID:
 * any doctor or admin can open any patient's records with it (owner decision 2026-11-17).
 * The ID lives in the URL (?id=P123456), so links, the back button and the dashboard's quick access work.
 * The server decides who may see what, and logs every view for the patient.
 */
export default function PatientRecordsLookup({ basePath }: { basePath: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const current = (params.get("id") ?? "").trim().toUpperCase();
  const [input, setInput] = useState(current);
  const [result, setResult] = useState<PatientLookup | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "notfound" | "error">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    setInput(current);
    if (!current) {
      setState("idle");
      return;
    }
    setState("loading");
    api<PatientLookup>(`/api/records/patients/${encodeURIComponent(current)}/`)
      .then((r) => {
        setResult(r);
        setState("done");
      })
      .catch((e) => {
        setResult(null);
        if (e instanceof ApiError && e.status === 404) setState("notfound");
        else {
          setError(e instanceof ApiError && e.status === 429 ? "Too many lookups. Please wait a minute and try again." : errorMessage(e));
          setState("error");
        }
      });
  }, [current]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const id = input.trim().toUpperCase();
    if (id) router.push(`${basePath}?id=${encodeURIComponent(id)}`);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} role="search" className="dash-card flex flex-col gap-3 p-5 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm font-medium text-slate-700">
          Patient ID
          <input
            className="input mt-1 font-mono uppercase"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. P483920"
            maxLength={12}
            autoFocus
          />
        </label>
        <button className="btn-solid rounded-xl px-5 py-2.5">
          <Icon name="search" className="h-4 w-4" /> Open records
        </button>
      </form>

      {state === "loading" && <Panel title="Looking up…"><SkeletonRows rows={3} /></Panel>}
      {state === "notfound" && (
        <EmptyState
          icon="users"
          title={`No patient with ID ${current}`}
          text="Check the ID with the patient: it looks like P483920."
        />
      )}
      {state === "error" && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      {state === "done" && result && (
        <>
          <section className="dash-card flex flex-wrap items-center gap-4 p-5" aria-label="Patient">
            <IconTile icon="user" tone="teal" />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-bold text-[#0f2f3a]">{result.patient.name}</p>
              <p className="text-sm text-slate-500">
                Patient ID <span className="font-mono">{result.patient.patient_id}</span>
              </p>
            </div>
            <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <Icon name="eye" className="h-4 w-4" /> This visit is shown in the patient&apos;s access log.
            </p>
          </section>
          <Panel title={`Records (${result.records.length})`}>
            <RecordList records={result.records} empty={{ title: "This patient hasn't uploaded any records yet" }} />
          </Panel>
        </>
      )}
    </div>
  );
}
