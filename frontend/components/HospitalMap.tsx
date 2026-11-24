"use client";

// Leaflet touches `window`, so this file is only ever loaded in the browser
// (pages import it with next/dynamic and ssr: false).
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { Circle, CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import { directionsUrl } from "@/lib/directions";
import type { Hospital, LatLng } from "@/lib/types";

/** What a pin needs: any hospital-like row with coordinates (null = no pin yet). */
type Pin = Pick<Hospital, "id" | "name" | "address" | "city"> & {
  latitude: number | null;
  longitude: number | null;
  location_verified?: boolean;
  distance_km?: number | null;
  is_partner?: boolean;
};

type Props = {
  hospitals: Pin[];
  user?: LatLng | null;
  radiusKm?: number;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  height?: number;
};

/** Zooms/pans the map so every marker (and the user) is visible. */
function FitToMarkers({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = JSON.stringify(points);
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 14);
    else if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

export default function HospitalMap({ hospitals, user, radiusKm, selectedId, onSelect, height = 420 }: Props) {
  const pinned = hospitals.filter((h) => h.latitude != null && h.longitude != null);
  const points: [number, number][] = pinned.map((h) => [h.latitude!, h.longitude!]);
  if (user) points.push([user.lat, user.lng]);
  const start: [number, number] = points[0] ?? [13.0827, 80.2707]; // Chennai if nothing to show

  return (
    <MapContainer center={start} zoom={12} style={{ height, width: "100%" }} className="z-0 rounded-xl" scrollWheelZoom>
      {/* OpenStreetMap tiles are free; their usage policy requires this attribution. */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitToMarkers points={points} />

      {user && (
        <>
          {radiusKm && <Circle center={[user.lat, user.lng]} radius={radiusKm * 1000} pathOptions={{ color: "#1f4f9e", weight: 1, fillOpacity: 0.05 }} />}
          <CircleMarker center={[user.lat, user.lng]} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#0f8f7e", fillOpacity: 1 }}>
            <Popup>You are here</Popup>
          </CircleMarker>
        </>
      )}

      {pinned.map((h) => {
        const selected = h.id === selectedId;
        const partner = h.is_partner !== false; // single-hospital maps don't pass the flag
        return (
          <CircleMarker
            key={h.id}
            center={[h.latitude!, h.longitude!]}
            radius={selected ? 12 : partner ? 9 : 7}
            eventHandlers={{ click: () => onSelect?.(h.id) }}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              // brand blue = MediConnect partner (instant booking), grey = other hospitals; the patient is teal
              fillColor: selected ? "#b45309" : partner ? "#1f4f9e" : "#64748b",
              fillOpacity: 1,
              // Unverified pins are drawn dashed so they read as "approximate".
              dashArray: h.location_verified ? undefined : "3 3",
            }}
          >
            <Popup>
              <strong>{h.name}</strong>
              {h.is_partner === true && <> · <em>MediConnect partner</em></>}
              <br />
              {[h.address, h.city].filter(Boolean).join(", ")}
              {h.distance_km != null && (
                <>
                  <br />
                  {h.distance_km} km away
                </>
              )}
              {!h.location_verified && (
                <>
                  <br />
                  <em>Approximate location</em>
                </>
              )}
              <br />
              <a href={`/hospitals/${h.id}`}>View hospital →</a>
              {/* Directions on the map too (owner request 2026-11-24), the same link as on appointments. */}
              {" · "}
              <a href={directionsUrl(h.name, h)} target="_blank" rel="noopener noreferrer">Get directions ↗</a>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
