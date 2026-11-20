"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, type HospitalConnection } from "@/lib/types";
import { IconTile } from "./DashboardShell";
import Icon from "./Icons";

/**
 * On the hospital dashboard while the hospital isn't connected: ask MediConnect to connect it, then
 * follow the request (waiting / declined with the reason and "Ask again"). Hidden once connected.
 */
export default function ConnectHospital({ onConnected }: { onConnected?: () => void }) {
  const [c, setC] = useState<HospitalConnection | null>(null);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ address: "", phone: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let stale = false;
    api<HospitalConnection>("/api/hospital-admin/connection/")
      .then((d) => {
        if (stale) return;
        setC(d);
        setF({ address: d.hospital.address, phone: d.hospital.phone, message: "" });
        if (d.connected) onConnected?.();
      })
      .catch((e) => !stale && setError(errorMessage(e)));
    return () => {
      stale = true;
    };
  }, [onConnected]);

  if (!c || c.connected) return error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/hospital-admin/connection/", { method: "POST", body: JSON.stringify(f) });
      setC(await api<HospitalConnection>("/api/hospital-admin/connection/"));
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const req = c.request;
  const pending = req?.status === "pending";
  const declined = req?.status === "declined";
  const disconnected = req?.status === "disconnected"; // by the platform admin, with a reason (2026-11-20)
  const label = "block text-sm font-medium text-slate-700";

  return (
    <section aria-label="Connection" className="dash-card p-5">
      <div className="flex flex-wrap items-center gap-4">
        <IconTile icon="hospital" tone={pending ? "orange" : "indigo"} />
        <div className="min-w-0 flex-1">
          <p className="font-[650] text-[#00295c]">
            {pending ? "Waiting for MediConnect to connect your hospital"
              : disconnected ? "Disconnected from MediConnect" : "Not connected to MediConnect yet"}
          </p>
          <p className="text-sm text-slate-500">
            {pending
              ? `You asked on ${fmtDate(req!.created_at)}. You'll get a notification when MediConnect answers.`
              : "You can manage your doctors, staff, salaries and patient records now. Connect your hospital so patients can find it and book your doctors."}
          </p>
          {(declined || disconnected) && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span className="font-[650]">{disconnected ? "Disconnected" : "Declined"} on {fmtDate(req!.decided_at ?? req!.created_at)}:</span> {req!.admin_note}
            </p>
          )}
        </div>
        {!pending && !open && (
          <button onClick={() => setOpen(true)} className="btn-solid rounded-xl px-4 py-2.5">
            <Icon name="arrow" className="h-4 w-4" /> {declined || disconnected ? "Ask again" : "Request connection"}
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={send} className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
          <p className="text-sm text-slate-600 sm:col-span-2">
            Patients will see this address and phone once your hospital is connected. MediConnect checks them first.
          </p>
          <label className={`${label} sm:col-span-2`}>
            Hospital address
            <input className="input mt-1" required minLength={5} maxLength={300} placeholder="Street, area"
                   value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
          </label>
          <label className={label}>
            Hospital phone
            <input className="input mt-1" type="tel" required maxLength={30} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </label>
          <label className={label}>
            Message to MediConnect <span className="font-normal text-slate-400">(optional)</span>
            <input className="input mt-1" maxLength={500} placeholder="e.g. We have 5 doctors ready to take bookings"
                   value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
          </label>
          {error && <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p>}
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-ghost px-4 py-2.5">Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
