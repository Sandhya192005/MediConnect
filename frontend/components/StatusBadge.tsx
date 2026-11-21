import type { AppointmentStatus } from "@/lib/types";

const styles: Record<AppointmentStatus, string> = {
  booked: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  confirmed: "bg-teal-50 text-teal-800 ring-1 ring-teal-200",
  cancelled: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  completed: "bg-navy-50 text-navy-800 ring-1 ring-navy-100",
  no_show: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
};
const LABELS: Partial<Record<AppointmentStatus, string>> = { no_show: "Missed" };

/**
 * The booking status; while a request isn't accepted yet: "Waiting for hospital" (the hospital assigns it)
 * or "Waiting for doctor" (the doctor accepts or rejects it). Booking flow, 2026-11-21.
 */
export default function StatusBadge({ status, awaiting = false, awaitingDoctor = false }: { status: AppointmentStatus; awaiting?: boolean; awaitingDoctor?: boolean }) {
  if (awaiting && status === "booked") {
    return <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-orange-200">Waiting for hospital</span>;
  }
  if (awaitingDoctor && status === "booked") {
    return <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">Waiting for doctor</span>;
  }
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[status]}`}>{LABELS[status] ?? status}</span>;
}
