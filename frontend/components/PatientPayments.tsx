"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import { fmtDate, fmtDateTime, fmtMoney, isoDate, PAYMENT_METHODS, type PaymentList, type PaymentMethod, type PaymentSlip } from "@/lib/types";
import { EmptyState, Panel, SkeletonRows } from "./DashboardShell";
import Icon from "./Icons";
import { SlipStatus } from "./PaymentSlipView";

const API = "/api/hospital-admin/payments/";
type Line = { description: string; quantity: string; unit_price: string };
type Visit = { id: number; start: string; doctor_name: string };

const lineAmount = (l: Line) => Math.round((Number(l.quantity) || 0) * (Number(l.unit_price) || 0) * 100) / 100;

/**
 * Payment slips for one patient, in the hospital's Patient management (owner request 2026-11-21):
 * itemised slips with a live total, Pending → Completed (method + date, then locked), back to pending with a
 * reason, cancel, and a printable slip page. The server works the real totals out.
 */
export default function PatientPayments({ patientId, visits, canAdd }: { patientId: string; visits: Visit[]; canAdd: boolean }) {
  const [data, setData] = useState<PaymentList | null>(null);
  const [form, setForm] = useState<PaymentSlip | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api<PaymentList>(`${API}?patient=${encodeURIComponent(patientId)}`).then(setData).catch((e) => setError(errorMessage(e)));
  }, [patientId]);
  useEffect(load, [load]);

  return (
    <Panel title={`Payments${data ? ` (${data.slips.length})` : ""}`}>
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="-mt-2 mb-4 flex flex-wrap items-center justify-between gap-3">
        {data && (
          <p className="text-sm text-slate-600" data-testid="payment-totals">
            Pending <span className="font-[650] text-amber-800">{fmtMoney(data.totals.pending)}</span>
            {" · "}Paid <span className="font-[650] text-emerald-700">{fmtMoney(data.totals.completed)}</span>
          </p>
        )}
        {canAdd && !form && (
          <button onClick={() => setForm("new")} className="btn-solid rounded-xl px-4 py-2 text-sm">
            <Icon name="rupee" className="h-4 w-4" /> New payment slip
          </button>
        )}
      </div>

      {form && (
        <SlipForm patientId={patientId} visits={visits} slip={form === "new" ? null : form}
                  onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />
      )}

      {data === null ? (
        <SkeletonRows rows={2} />
      ) : data.slips.length === 0 ? (
        <EmptyState icon="rupee" title="No payment slips yet" text={canAdd ? "Use “New payment slip” to bill this patient." : undefined} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.slips.map((s) => (
            <SlipRow key={s.id} s={s} onEdit={() => setForm(s)} onChanged={load} onError={setError} />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SlipRow({ s, onEdit, onChanged, onError }: { s: PaymentSlip; onEdit: () => void; onChanged: () => void; onError: (e: string) => void }) {
  const [open, setOpen] = useState<"pay" | "reopen" | "cancel" | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidOn, setPaidOn] = useState(isoDate(new Date()));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(action: "complete" | "reopen" | "cancel", body: object) {
    setBusy(true);
    onError("");
    try {
      await api(`${API}${s.id}/${action}/`, { method: "POST", body: JSON.stringify(body) });
      setOpen(null);
      setReason("");
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li aria-label={`Slip ${s.number}`} className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-[650] text-[#00295c]">
            <span className="font-mono">{s.number}</span> <SlipStatus s={s} />
            <span className="tabular-nums">{fmtMoney(s.total)}</span>
          </p>
          <p className="text-xs text-slate-500">
            {fmtDate(s.issued_on)} · {s.items.map((i) => i.description).join(", ")}
            {s.status === "completed" && s.paid_on && ` · paid ${fmtDate(s.paid_on)} by ${s.method_label}`}
            {s.visit && ` · visit ${fmtDateTime(s.visit.start)}`}
          </p>
          {s.status === "pending" && s.reopen_reason && <p className="text-xs text-amber-800">Set back to pending: {s.reopen_reason}</p>}
          {s.status === "cancelled" && s.cancel_reason && <p className="text-xs text-slate-500">Cancelled: {s.cancel_reason}</p>}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/admin/payments/${s.id}`} className="btn-ghost px-3 py-1.5" aria-label={`View and print ${s.number}`}>
            <Icon name="file" className="h-3.5 w-3.5" /> Slip
          </Link>
          {s.status === "pending" && !open && (
            <>
              <button onClick={() => setOpen("pay")} className="btn-solid px-3 py-1.5" aria-label={`Mark ${s.number} as paid`}>Mark as paid</button>
              <button onClick={onEdit} className="btn-outline px-3 py-1.5" aria-label={`Edit ${s.number}`}>Edit</button>
              <button onClick={() => setOpen("cancel")} className="btn border border-red-200 bg-white px-3 py-1.5 text-red-700 hover:bg-red-50" aria-label={`Cancel ${s.number}`}>Cancel</button>
            </>
          )}
          {s.status === "completed" && !open && (
            <button onClick={() => setOpen("reopen")} className="btn-ghost px-3 py-1.5" aria-label={`Set ${s.number} back to pending`}>Back to pending</button>
          )}
        </div>
      </div>

      {open === "pay" && (
        <form className="mt-3 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-end"
              onSubmit={(e) => { e.preventDefault(); send("complete", { method, paid_on: paidOn }); }}>
          <label className="block text-sm font-medium text-slate-700">Paid by
            <select className="input mt-1 py-2" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700">Paid on
            <input className="input mt-1 py-2" type="date" required max={isoDate(new Date())} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </label>
          <button className="btn-solid px-4 py-2 text-sm" disabled={busy}>Confirm payment of {fmtMoney(s.total)}</button>
          <button type="button" onClick={() => setOpen(null)} className="btn-ghost px-4 py-2 text-sm">Close</button>
        </form>
      )}
      {(open === "reopen" || open === "cancel") && (
        <form className="mt-3 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center"
              onSubmit={(e) => { e.preventDefault(); send(open, { reason }); }}>
          <input className="input flex-1 py-2" maxLength={300} required={open === "reopen"} value={reason} onChange={(e) => setReason(e.target.value)}
                 aria-label={open === "reopen" ? `Why ${s.number} is no longer paid` : `Why ${s.number} is cancelled`}
                 placeholder={open === "reopen" ? "Why it's no longer paid (shown on the slip), e.g. UPI payment failed" : "Reason (optional), e.g. Billed twice"} />
          <button className="btn border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50" disabled={busy}>
            {open === "reopen" ? "Set back to pending" : "Cancel slip"}
          </button>
          <button type="button" onClick={() => setOpen(null)} className="btn-ghost px-4 py-2 text-sm">Close</button>
        </form>
      )}
    </li>
  );
}

/** New or edit (pending only): lines with a live total, discount, date, visit, notes; new slips can be paid at once. */
function SlipForm({ patientId, visits, slip, onClose, onSaved }: {
  patientId: string; visits: Visit[]; slip: PaymentSlip | null; onClose: () => void; onSaved: () => void;
}) {
  const [lines, setLines] = useState<Line[]>(
    slip ? slip.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unit_price: String(i.unit_price) }))
      : [{ description: "Consultation", quantity: "1", unit_price: "" }],
  );
  const [discount, setDiscount] = useState(slip && slip.discount ? String(slip.discount) : "");
  const [issuedOn, setIssuedOn] = useState(slip?.issued_on ?? isoDate(new Date()));
  const [visit, setVisit] = useState(slip?.appointment ? String(slip.appointment) : "");
  const [notes, setNotes] = useState(slip?.notes ?? "");
  const [paidNow, setPaidNow] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const subtotal = lines.reduce((t, l) => t + lineAmount(l), 0);
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  const setLine = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = {
      items: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, unit_price: l.unit_price || "0" })),
      discount: discount || "0", issued_on: issuedOn, appointment: visit ? Number(visit) : null, notes,
    };
    try {
      if (slip) {
        await api(`${API}${slip.id}/`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(API, { method: "POST", body: JSON.stringify({ ...body, patient_id: patientId, ...(paidNow ? { status: "completed", method } : {}) }) });
      }
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "block text-sm font-medium text-slate-700";
  return (
    <section aria-label={slip ? `Edit ${slip.number}` : "New payment slip"} className="mb-5 rounded-xl border border-slate-200 p-4">
      <p className="mb-3 font-[650] text-[#00295c]">{slip ? `Edit ${slip.number}` : "New payment slip"}</p>
      <form onSubmit={save} className="space-y-4">
        <div className="space-y-2">
          <div className="hidden grid-cols-[1fr_5rem_8rem_7rem_2rem] gap-2 text-xs font-medium text-slate-500 sm:grid">
            <span>Description</span><span>Qty</span><span>Price (₹)</span><span className="text-right">Amount</span><span />
          </div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_5rem_8rem_7rem_2rem] sm:items-center">
              <input className="input col-span-2 py-2 sm:col-span-1" required maxLength={150} placeholder="e.g. Blood test" aria-label={`Line ${i + 1} description`}
                     value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
              <input className="input py-2" type="number" min={1} max={999} required aria-label={`Line ${i + 1} quantity`}
                     value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
              <input className="input py-2" type="number" min={0} step="0.01" required placeholder="0" aria-label={`Line ${i + 1} price`}
                     value={l.unit_price} onChange={(e) => setLine(i, "unit_price", e.target.value)} />
              <span className="text-right text-sm tabular-nums text-[#00295c]">{fmtMoney(lineAmount(l))}</span>
              <button type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))} disabled={lines.length === 1}
                      className="text-slate-400 hover:text-red-600 disabled:opacity-30" aria-label={`Remove line ${i + 1}`}>
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setLines([...lines, { description: "", quantity: "1", unit_price: "" }])} className="dash-link text-sm">
            + Add line
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>Discount (₹) <span className="font-normal text-slate-400">(optional)</span>
            <input className="input mt-1 py-2" type="number" min={0} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </label>
          <label className={label}>Slip date
            <input className="input mt-1 py-2" type="date" required max={isoDate(new Date())} value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} />
          </label>
          <label className={label}>Visit <span className="font-normal text-slate-400">(optional)</span>
            <select className="input mt-1 py-2" value={visit} onChange={(e) => setVisit(e.target.value)}>
              <option value="">Not for a booked visit</option>
              {visits.map((v) => <option key={v.id} value={v.id}>{fmtDateTime(v.start)} · {v.doctor_name}</option>)}
            </select>
          </label>
        </div>
        <label className={label}>Notes <span className="font-normal text-slate-400">(optional, shown on the slip)</span>
          <input className="input mt-1 py-2" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-sm text-slate-600">
            Subtotal {fmtMoney(subtotal)}{Number(discount) > 0 && ` − discount ${fmtMoney(Number(discount))}`} ={" "}
            <span className="text-base font-bold text-[#00295c]" data-testid="form-total">{fmtMoney(total)}</span>
          </p>
          {!slip && (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={paidNow} onChange={(e) => setPaidNow(e.target.checked)} /> Already paid
              {paidNow && (
                <select className="input w-auto py-1.5" aria-label="Paid by" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              )}
            </label>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button className="btn-solid rounded-xl px-5 py-2.5" disabled={busy}>{busy ? "Saving…" : slip ? "Save changes" : "Save slip"}</button>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
        </div>
      </form>
    </section>
  );
}
