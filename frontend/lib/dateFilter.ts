/**
 * Date filter for appointment lists (owner request 2026-11-24): quick choices plus "On a date…" and
 * "Between dates…". Works on local calendar dates written as YYYY-MM-DD, which compare correctly as text.
 */
import { isoDate } from "@/lib/types";

export type DatePreset =
  | "any" | "today" | "tomorrow" | "yesterday" | "this_week" | "next_7" | "last_7" | "this_month" | "last_month"
  | "on" | "between";

export const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: "any", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "next_7", label: "Next 7 days" },
  { key: "last_7", label: "Last 7 days" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "on", label: "On a date…" },
  { key: "between", label: "Between dates…" },
];

export type DateFilter = { preset: DatePreset; on: string; from: string; to: string };
export const NO_DATE_FILTER: DateFilter = { preset: "any", on: "", from: "", to: "" };

const plusDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** The first and last day (YYYY-MM-DD, both included) the filter allows; null = no limit on that side. */
export function dateRange(f: DateFilter, now = new Date()): [string | null, string | null] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (n: number) => isoDate(plusDays(today, n));
  switch (f.preset) {
    case "today": return [day(0), day(0)];
    case "tomorrow": return [day(1), day(1)];
    case "yesterday": return [day(-1), day(-1)];
    case "this_week": { // Monday to Sunday
      const back = (today.getDay() + 6) % 7;
      return [day(-back), day(6 - back)];
    }
    case "next_7": return [day(0), day(6)];
    case "last_7": return [day(-6), day(0)];
    case "this_month":
      return [isoDate(new Date(today.getFullYear(), today.getMonth(), 1)),
              isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0))];
    case "last_month":
      return [isoDate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
              isoDate(new Date(today.getFullYear(), today.getMonth(), 0))];
    case "on": return f.on ? [f.on, f.on] : [null, null];
    case "between": {
      const [a, b] = [f.from || null, f.to || null];
      return a && b && a > b ? [b, a] : [a, b]; // dates typed the wrong way round still work
    }
    default: return [null, null];
  }
}

/** Does an appointment starting at `startIso` pass the filter? */
export function inDateFilter(startIso: string, f: DateFilter, now = new Date()): boolean {
  const [from, to] = dateRange(f, now);
  const d = isoDate(new Date(startIso));
  return (!from || d >= from) && (!to || d <= to);
}
