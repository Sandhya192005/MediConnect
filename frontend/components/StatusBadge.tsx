import type { AppointmentStatus } from "@/lib/types";

const styles: Record<AppointmentStatus, string> = {
  booked: "bg-amber-100 text-amber-800",
  confirmed: "bg-teal-100 text-teal-800",
  cancelled: "bg-slate-200 text-slate-600",
  completed: "bg-indigo-100 text-indigo-800",
};

export default function StatusBadge({ status }: { status: AppointmentStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[status]}`}>{status}</span>;
}
