import type { AppointmentStatus } from "@/lib/types";

const styles: Record<AppointmentStatus, string> = {
  booked: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  confirmed: "bg-teal-50 text-teal-800 ring-1 ring-teal-200",
  cancelled: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  completed: "bg-navy-50 text-navy-800 ring-1 ring-navy-100",
};

/** The booking status; "Waiting for hospital" while a booked visit waits for the hospital's Confirm. */
export default function StatusBadge({ status, awaiting = false }: { status: AppointmentStatus; awaiting?: boolean }) {
  if (awaiting && status === "booked") {
    return <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-800 ring-1 ring-orange-200">Waiting for hospital</span>;
  }
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[status]}`}>{status}</span>;
}
