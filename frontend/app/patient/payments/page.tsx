"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, Panel, SkeletonRows } from "@/components/DashboardShell";
import Icon from "@/components/Icons";
import PageHeader from "@/components/PageHeader";
import { SlipStatus } from "@/components/PaymentSlipView";
import RoleGuard from "@/components/RoleGuard";
import { api, errorMessage } from "@/lib/api";
import { NOTIFICATION_EVENT } from "@/lib/notifications";
import { fmtDate, fmtMoney, type PaymentList } from "@/lib/types";

/** The patient's payment slips from every hospital (owner request 2026-11-21). Read-only; each one printable. */
export default function MyPaymentsPage() {
  const [data, setData] = useState<PaymentList | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => api<PaymentList>("/api/payments/").then(setData).catch((e) => setError(errorMessage(e)));
    load();
    window.addEventListener(NOTIFICATION_EVENT, load);
    return () => window.removeEventListener(NOTIFICATION_EVENT, load);
  }, []);

  return (
    <RoleGuard role="patient">
      <div className="mb-6"><PageHeader icon="rupee" title="My payments" subtitle="Payment slips from your hospitals." /></div>
      {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      <Panel title={`Payment slips${data ? ` (${data.slips.length})` : ""}`}>
        {data === null ? (
          <SkeletonRows rows={3} />
        ) : data.slips.length === 0 ? (
          <EmptyState icon="rupee" title="No payment slips yet" text="When a hospital bills you on MediConnect, the slip appears here." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.slips.map((s) => (
              <li key={s.id} aria-label={`Slip ${s.number}`} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-[650] text-[#00295c]">
                    {s.hospital.name} <SlipStatus s={s} />
                  </p>
                  <p className="text-xs text-slate-500">
                    <span className="font-mono">{s.number}</span> · {fmtDate(s.issued_on)} · {s.items.map((i) => i.description).join(", ")}
                    {s.status === "completed" && s.paid_on && ` · paid ${fmtDate(s.paid_on)} by ${s.method_label}`}
                  </p>
                </div>
                <span className="text-sm font-bold tabular-nums text-[#00295c]">{fmtMoney(s.total)}</span>
                <Link href={`/patient/payments/${s.id}`} className="btn-outline px-3 py-1.5 text-xs" aria-label={`Open slip ${s.number}`}>
                  <Icon name="file" className="h-3.5 w-3.5" /> Slip
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </RoleGuard>
  );
}
