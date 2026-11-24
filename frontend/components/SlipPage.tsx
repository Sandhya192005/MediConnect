"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { PaymentSlip } from "@/lib/types";
import Icon from "./Icons";
import PaymentSlipView from "./PaymentSlipView";

/** One slip with Print (→ "Save as PDF" in the browser's print dialog) and a way back. Hospital and patient. */
export default function SlipPage({ endpoint, back }: { endpoint: string; back: { href: string; label: string } }) {
  const [slip, setSlip] = useState<PaymentSlip | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<PaymentSlip>(endpoint).then(setSlip).catch((e) => setError(errorMessage(e)));
  }, [endpoint]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={back.href} className="dash-link"><Icon name="arrow" className="h-4 w-4 rotate-180" /> {back.label}</Link>
        {slip && (
          <button onClick={() => window.print()} className="btn-solid rounded-xl px-4 py-2 text-sm">
            <Icon name="file" className="h-4 w-4" /> Print or save as PDF
          </button>
        )}
      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
      {!slip && !error && <div className="mx-auto h-96 max-w-2xl animate-pulse rounded-2xl bg-slate-100" />}
      {slip && <PaymentSlipView s={slip} />}
    </div>
  );
}
