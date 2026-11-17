import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

export const API = "http://localhost:8000";

/** Ids and logins created by `manage.py e2e_setup` (see global-setup.ts). */
export type E2EData = {
  password: string;
  patient: { email: string; id: number; patient_id: string };
  doctor: { email: string; id: number; name: string };
  /** Hospital admin of the E2E Partner Hospital. */
  admin: { email: string };
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
  await page.getByLabel("Password", { exact: true }).fill(password); // exact: the "Show password" button also matches
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
}

/** Tomorrow as YYYY-MM-DD in India time (matches the app's slot dates). */
export function tomorrow(): string {
  const d = new Date(Date.now() + 24 * 3600 * 1000);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** Today as YYYY-MM-DD in India time. */
export function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Deletes all of a test user's notifications (POST /api/notifications/clear/). Other tests' bookings
 * notify the E2E doctor too, so a test that counts unread notifications starts from zero with this.
 */
export async function clearNotifications(request: APIRequestContext, email: string) {
  const auth = await request.post(`${API}/api/auth/login/`, { data: { email, password: e2e().password } });
  const { access } = await auth.json();
  const res = await request.post(`${API}/api/notifications/clear/`, { headers: { Authorization: `Bearer ${access}` } });
  expect(res.ok()).toBeTruthy();
}

/** An API access token for the E2E patient. */
export async function patientToken(request: APIRequestContext) {
  const auth = await request.post(`${API}/api/auth/login/`, { data: { email: e2e().patient.email, password: e2e().password } });
  expect(auth.ok()).toBeTruthy();
  return (await auth.json()).access as string;
}

/**
 * Cancels the E2E patient's active bookings. Tests share the patient (e.g. the chatbot test leaves a booking
 * behind), so a test that needs a clean start calls this first.
 */
export async function cancelPatientBookings(request: APIRequestContext) {
  const headers = { Authorization: `Bearer ${await patientToken(request)}` };
  for (const when of ["upcoming", "past"]) {
    const res = await request.get(`${API}/api/appointments/?when=${when}`, { headers });
    for (const a of (await res.json()) as { id: number; status: string }[]) {
      if (a.status === "booked" || a.status === "confirmed") {
        expect((await request.post(`${API}/api/appointments/${a.id}/cancel/`, { headers })).ok()).toBeTruthy();
      }
    }
  }
}

/** Books the E2E doctor for the E2E patient through the API (first free slot on `day`); returns the appointment id. */
export async function bookAsPatient(request: APIRequestContext, day = tomorrow(), reason = "Booked by an e2e test") {
  const res = await request.post(`${API}/api/appointments/`, {
    headers: { Authorization: `Bearer ${await patientToken(request)}` },
    data: { doctor: e2e().doctor.id, start: await firstFreeSlot(request, day), reason },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).id as number;
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
