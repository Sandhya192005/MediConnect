"use client";

/**
 * A time picker with AM/PM (owner request 2026-11-21): hour 1–12 · minutes · AM/PM dropdowns.
 * The browser's own <input type="time"> shows AM/PM only on some computers (it follows the system's
 * clock setting), so it showed 24-hour time with no AM/PM for the owner. The value stays "HH:MM"
 * (24-hour), which is what the API stores.
 */

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 00, 05 … 55

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:30" → { hour12: 2, minute: 30, pm: true } */
function split(value: string) {
  const [h, m] = value.split(":").map(Number);
  const hours = Number.isFinite(h) ? h : 9;
  return { hour12: hours % 12 === 0 ? 12 : hours % 12, minute: Number.isFinite(m) ? m : 0, pm: hours >= 12 };
}

function join(hour12: number, minute: number, pm: boolean) {
  const h = (hour12 % 12) + (pm ? 12 : 0);
  return `${pad(h)}:${pad(minute)}`;
}

/** "14:30" → "2:30 PM" (for showing a saved time). */
export function fmt12(value: string) {
  const { hour12, minute, pm } = split(value.slice(0, 5));
  return `${hour12}:${pad(minute)} ${pm ? "PM" : "AM"}`;
}

export default function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const { hour12, minute, pm } = split(value);
  // Keep an unusual saved minute (e.g. 07) selectable instead of silently changing it.
  const minutes = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort((a, b) => a - b);
  const select = "input w-auto px-2 py-2";
  return (
    <span role="group" aria-label={label} className="inline-flex items-center gap-1">
      <select className={select} aria-label={`${label}: hour`} value={hour12} onChange={(e) => onChange(join(Number(e.target.value), minute, pm))}>
        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
      </select>
      <span aria-hidden="true">:</span>
      <select className={select} aria-label={`${label}: minutes`} value={minute} onChange={(e) => onChange(join(hour12, Number(e.target.value), pm))}>
        {minutes.map((m) => <option key={m} value={m}>{pad(m)}</option>)}
      </select>
      <select className={select} aria-label={`${label}: AM or PM`} value={pm ? "PM" : "AM"} onChange={(e) => onChange(join(hour12, minute, e.target.value === "PM"))}>
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </span>
  );
}
