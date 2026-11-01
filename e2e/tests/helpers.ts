import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API = "http://localhost:8000";

/** Ids and logins created by `manage.py e2e_setup` (see global-setup.ts). */
export type E2EData = {
  password: string;
  patient: { email: string; id: number };
  doctor: { email: string; id: number; name: string };
  partner_hospital: { id: number; name: string };
  mock_hospital: { id: number; name: string };
  location: { lat: number; lng: number };
};

let cached: E2EData | null = null;
/** Read lazily: the file is written by global setup, which may run after test files are loaded. */
export function e2e(): E2EData {
  cached ??= JSON.parse(readFileSync(path.join(__dirname, "..", ".e2e-data.json"), "utf8"));
  return cached!;
}

/** Log in through the real login form and wait for the dashboard. */
export async function login(page: Page, email: string, password = e2e().password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
}

/** Tomorrow as YYYY-MM-DD in India time (matches the app's slot dates). */
export function tomorrow(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** First free slot of the E2E doctor on a day, straight from the API. */
export async function firstFreeSlot(request: APIRequestContext, day = tomorrow()) {
  const res = await request.get(`${API}/api/doctors/${e2e().doctor.id}/slots/?date=${day}`);
  expect(res.ok()).toBeTruthy();
  const slots: { start: string; available: boolean }[] = (await res.json()).slots;
  const free = slots.find((s) => s.available);
  if (!free) throw new Error(`No free slot for the E2E doctor on ${day}`);
  return free.start;
}
