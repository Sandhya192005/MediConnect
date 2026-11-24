import Link from "next/link";
import { areaOf } from "@/lib/types";
import HospitalThumb from "./HospitalThumb";
import Icon from "./Icons";

/** One hospital in a list (Book appointment: other hospitals, Near me). */
export type HospitalRowData = {
  id: number;
  name: string;
  address: string;
  city: string;
  departments: string[];
  is_partner: boolean;
  distance_km?: number | null;
  location_verified?: boolean;
  latitude: number | null;
  longitude: number | null;
};

/**
 * A hospital card: name, a badge (Instant booking / Request appointment), area without house numbers,
 * distance when known, specialties, and the next step (Book appointment / View details).
 */
export default function HospitalRow({ h, selected = false, onShowOnMap }: { h: HospitalRowData; selected?: boolean; onShowOnMap?: (id: number) => void }) {
  return (
    <article
      id={`hospital-${h.id}`}
      aria-label={h.name}
      className={`dash-card flex scroll-mt-24 flex-col gap-4 p-4 transition hover:ring-1 hover:ring-teal-200 sm:flex-row sm:items-center ${selected ? "ring-2 ring-amber-400" : ""}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <HospitalThumb className="h-14 w-14" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/hospitals/${h.id}`} className="font-[650] text-[#00295c] hover:text-teal-700">{h.name}</Link>
            {h.is_partner ? (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-[650] text-teal-700 ring-1 ring-teal-200">Instant booking</span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">Request appointment</span>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-slate-500">
            <span className="flex items-center gap-1"><Icon name="pin" className="h-3.5 w-3.5" /> {areaOf(h)}</span>
            {h.distance_km != null && <span>{h.location_verified === false ? "about " : ""}{h.distance_km.toFixed(1)} km away</span>}
          </p>
          {h.departments.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-1.5">
              {h.departments.slice(0, 4).map((d) => (
                <span key={d} className="rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">{d}</span>
              ))}
              {h.departments.length > 4 && <span className="text-xs text-slate-400">+{h.departments.length - 4} more</span>}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {onShowOnMap && h.latitude != null && (
          <button type="button" onClick={() => onShowOnMap(h.id)} className="btn-outline rounded-xl px-3 py-2 text-sm" aria-label={`Show ${h.name} on map`}>
            <Icon name="pin" className="h-4 w-4" /> Show on map
          </button>
        )}
        <Link href={`/hospitals/${h.id}`} className={`${h.is_partner ? "btn-solid" : "btn-outline"} rounded-xl px-4 py-2 text-center`}>
          {h.is_partner ? "Book appointment" : "View details"}
        </Link>
      </div>
    </article>
  );
}
