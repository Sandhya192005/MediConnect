import type { AppointmentStatus } from "@/lib/types";

const styles: Record<AppointmentStatus, string> = {
  booked: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  confirmed: "bg-teal-50 text-teal-800 ring-1 ring-teal-200",
  cancelled: "bg-slate-100 text-slate-600 ring-1 ring-slate-200",
  completed: "bg-navy-50 text-navy-800 ring-1 ring-navy-100",
};

export default function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${styles[status]}`}>{status}</span>;
}
