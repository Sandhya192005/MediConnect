import type { HospitalPlaceData } from "./types";

/**
 * Directions to a hospital in Google Maps (owner request 2026-11-18). The patient's own phone/browser
 * fills in where they are; MediConnect never sees it. An unverified pin could be wrong, so then we send
 * the hospital's name and address and let Maps find it.
 */
export function directionsUrl(name: string, place: Partial<HospitalPlaceData> | null): string {
  const destination = place?.latitude != null && place.location_verified
    ? `${place.latitude},${place.longitude}`
    : [name, place?.address, place?.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}
