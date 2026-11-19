import type { User } from "./api";

/**
 * The dashboard greeting, the same for every role (owner request 2026-11-19): time of day + first name,
 * "Dr." for doctors. The first name, because in Tamil Nadu the last name is often just an initial
 * ("Jeevitha D" -> "Good evening, Dr. Jeevitha!").
 */
export function greetingFor(user: Pick<User, "first_name" | "last_name" | "role"> | null, now = new Date()): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const name = user?.first_name?.trim() || user?.last_name?.trim() || "";
  const who = name && user?.role === "doctor" && !/^dr\.?\s/i.test(name) ? `Dr. ${name}` : name;
  return who ? `${part}, ${who}!` : `${part}!`;
}