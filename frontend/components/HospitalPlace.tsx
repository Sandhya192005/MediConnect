"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { directionsUrl } from "@/lib/directions";
import { areaOf, type HospitalPlaceData } from "@/lib/types";
import Icon from "./Icons";

export { directionsUrl }; // kept here too: older imports use it from this file

// Leaflet needs the browser: load the map only there, and only when "Show on map" is pressed.
const HospitalMap = dynamic(() => import("./HospitalMap"), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse rounded-xl bg-slate-100" />,
});

/**
 * Where the hospital is, on an appointment, a request or a visit booked directly with a hospital:
 * its area, "Get directions", "Show on map" (a small map in place) and "Call hospital".
 * `place` may be null for a hospital typed in by hand: directions then search its name.
 */
export default function HospitalPlace({ name, place, phone }: { name: string; place: HospitalPlaceData | null; phone?: string }) {
  const [open, setOpen] = useState(false);
  const tel = (place?.phone || phone || "").replace(/\s+/g, "");
  const pinned = place?.latitude != null && place.longitude != null;

  return (
    <div className="w-full">
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {place && (place.address || place.city) && (
          <span className="flex items-center gap-1 text-slate-600"><Icon name="pin" className="h-3.5 w-3.5" /> {areaOf(place)}</span>
        )}
        <a href={directionsUrl(name, place)} target="_blank" rel="noopener noreferrer"
           className="btn-outline px-3 py-1 text-xs" aria-label={`Get directions to ${name}`}>
          <Icon name="map" className="h-3.5 w-3.5" /> Get directions
        </a>
        {pinned && (
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="btn-ghost px-3 py-1 text-xs">
            <Icon name="pin" className="h-3.5 w-3.5" /> {open ? "Hide map" : "Show on map"}
          </button>
        )}
        {tel && (
          <a href={`tel:${tel}`} className="btn-ghost px-3 py-1 text-xs"><Icon name="phone" className="h-3.5 w-3.5" /> Call hospital</a>
        )}
      </div>
      {open && pinned && (
        <div role="region" aria-label={`Map of ${name}`} className="mt-3 overflow-hidden rounded-xl">
          <HospitalMap
            hospitals={[{ id: place!.id, name, address: place!.address, city: place!.city, latitude: place!.latitude,
                          longitude: place!.longitude, location_verified: place!.location_verified, is_partner: true }]}
            height={220}
          />
          {!place!.location_verified && (
            <p className="mt-1 text-xs text-slate-500">Approximate location: confirm with the hospital before you travel.</p>
          )}
        </div>
      )}
    </div>
  );
}
