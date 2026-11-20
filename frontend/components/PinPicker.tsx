"use client";

// Leaflet touches `window`: load this file with next/dynamic and ssr: false.
import "leaflet/dist/leaflet.css";
import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";

export type PinPoint = { lat: number; lng: number };

/** Clicking the map moves the pin there. */
function ClickToPin({ onPick }: { onPick: (p: PinPoint) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Keeps the pin in view when it is set from outside the map (e.g. "Use my current location"). */
function FollowPin({ pin }: { pin: PinPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (pin && !map.getBounds().contains([pin.lat, pin.lng])) map.setView([pin.lat, pin.lng], Math.max(map.getZoom(), 16));
  }, [pin, map]);
  return null;
}

/** The hospital's own map pin (owner request 2026-11-20): click the map to place it. */
export default function PinPicker({ pin, onPick, height = 320 }: { pin: PinPoint | null; onPick: (p: PinPoint) => void; height?: number }) {
  const start: [number, number] = pin ? [pin.lat, pin.lng] : [13.0827, 80.2707]; // Chennai until a pin is set
  return (
    <MapContainer center={start} zoom={pin ? 16 : 12} style={{ height, width: "100%" }} className="z-0 cursor-crosshair rounded-xl" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickToPin onPick={onPick} />
      <FollowPin pin={pin} />
      {pin && (
        <CircleMarker center={[pin.lat, pin.lng]} radius={10}
                      pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#1f4f9e", fillOpacity: 1 }} />
      )}
    </MapContainer>
  );
}
