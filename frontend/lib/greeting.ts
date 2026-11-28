import type { User } from "./api";

/**
 * The dashboard greeting, the same for every role (owner request 2026-11-19): time of day + first name,
 * "Dr." for doctors. The first name, because in Tamil Nadu the last name is often just an initial
 * ("Jeevitha D" -> "Good evening, Dr. Jeevitha!").
 */
export function greetingFor(user: Pick<User, "first_name" | "last_name" | "role"> | null, now = new Date()): string {
  const hour = now.getHours();
  // Morning until 11:59, afternoon 12:00–15:59, evening from 16:00 (owner request 2026-11-28).
  const part = hour < 12 ? "Good morning" : hour < 16 ? "Good afternoon" : "Good evening";
  const name = user?.first_name?.trim() || user?.last_name?.trim() || "";
  const who = name && user?.role === "doctor" && !/^dr\.?\s/i.test(name) ? `Dr. ${name}` : name;
  return who ? `${part}, ${who}!` : `${part}!`;
}