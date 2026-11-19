"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, IconTile, Panel, SkeletonRows } from "@/components/DashboardShell";
import RoleGuard from "@/components/RoleGuard";
import { api, ApiError, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtDate, timeAgo, type ConnectionRequest } from "@/lib/types";

type Show = "pending" | "";

/**
 * Hospitals that signed up and ask to be connected with MediConnect (platform admin only).
 * Approve = patients can find and book the hospital; Decline needs a reason the hospital will see.
 */
export default function ConnectionRequestsPage() {
  const { user } = useAuth();
  const [show, setShow] = useState<Show>("pending");
  const [items, setItems] = useState<ConnectionRequest[] | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<ConnectionRequest[]>(`/api/platform/connection-requests/${show ? `?status=${show}` : ""}`)
      .then(setItems)
      .catch((e) => setError(errorMessage(e)));
  }, [show]);

  useEffect(() => {
    if (user?.is_platform_admin) load();
  }, [load, user?.is_platform_admin]);

  async function decide(r: ConnectionRequest, action: "approve" | "decline") {
    setBusy(r.id);
    setError("");
    try {
      await api(`/api/platform/connection-requests/${r.id}/${action}/`, { method: "POST", body: JSON.stringify({ note: notes[r.id] ?? "" }) });
      load();
    } catch (e) {
      // The hospital may have been deleted meanwhile (e.g. a test hospital): say so and refresh the list.
      if (e instanceof ApiError && e.status === 404) {
        setError(`The request from ${r.hospital_name} no longer exists. The list has been refreshed.`);
        load();
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <RoleGuard role="admin">
      {!user?.is_platform_admin ? (
        <EmptyState icon="hospital" title="Connection requests are for the MediConnect platform admin" />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="page-title">Connection requests</h1>
              <p className="page-subtitle text-sm">
                Hospitals that signed up and want patients to find and book them. Check the hospital is real before approving.
              </p>
            </div>
            <div role="group" aria-label="Show" className="inline-flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
              {([["pending", "Waiting"], ["", "All"]] as [Show, string][]).map(([v, label]) => (
                <button key={label} onClick={() => setShow(v)} aria-pressed={show === v}
                        className={`rounded-lg px-3 py-1.5 text-sm ${show === v ? "bg-teal-600 font-[650] text-white" : "text-slate-600 hover:bg-slate-100"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

          <Panel title={`${show ? "Waiting" : "All requests"}${items ? ` (${items.length})` : ""}`}>
            {items === null ? (
              <SkeletonRows rows={3} />
            ) : items.length === 0 ? (
              <EmptyState icon="check" title={show ? "No hospitals waiting" : "No requests yet"} text="Hospitals ask from their dashboard after signing up." />
            ) : (
              <ul className="space-y-4">
                {items.map((r) => (
                  <li key={r.id} aria-label={r.hospital_name} className="rounded-xl border border-slate-100 p-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <IconTile icon="hospital" tone={r.status === "approved" ? "teal" : r.status === "declined" ? "rose" : "indigo"} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="font-[650] text-[#00295c]">{r.hospital_name} <span className="font-normal text-slate-500">· {r.hospital_city}</span></p>
                        <p className="text-sm text-slate-600">{r.hospital_address} · {r.hospital_phone}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Asked {timeAgo(r.created_at)} by {r.requested_by_email ?? "a deleted account"} · {r.doctor_count} doctor
                          {r.doctor_count === 1 ? "" : "s"} and {r.staff_count} staff on record
                          {r.hospital_source !== "account" && " · already on the map"}
                        </p>
                        {r.message && <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">&ldquo;{r.message}&rdquo;</p>}
                        {r.status !== "pending" && (
                          <p className="mt-2 text-sm text-slate-600">
                            <span className="font-[650]">{r.status_label}</span>
                            {r.decided_at && ` on ${fmtDate(r.decided_at)}`}
                            {r.admin_note && `: ${r.admin_note}`}
                          </p>
                        )}
                      </div>
                    </div>
                    {r.status === "pending" && (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <input className="input flex-1" maxLength={500} aria-label={`Note to ${r.hospital_name}`}
                               placeholder="Note to the hospital (needed when declining)"
                               value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                        <button onClick={() => decide(r, "approve")} disabled={busy === r.id} className="btn-solid px-4 py-2">Approve</button>
                        <button onClick={() => decide(r, "decline")} disabled={busy === r.id}
                                className="btn border border-red-200 bg-white px-4 py-2 text-red-700 hover:bg-red-50">Decline</button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </RoleGuard>
  );
}
