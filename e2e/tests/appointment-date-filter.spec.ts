import { expect, test } from "@playwright/test";
import { bookAsPatient, cancelPatientBookings, e2e, login } from "./helpers";

/** A local calendar date n days from today, as YYYY-MM-DD. */
function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Hospital appointments: filter by date next to the doctor filter (owner request 2026-11-24).
test("the hospital filters appointments by date", async ({ page, request }) => {
  await cancelPatientBookings(request);
  await bookAsPatient(request, inDays(1));
  await bookAsPatient(request, inDays(3));

  await login(page, e2e().admin.email);
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Appointments" }).click();
  await page.getByRole("tab", { name: "Upcoming" }).click();
  await expect(page.getByRole("region", { name: "Upcoming (2)" })).toBeVisible();

  const date = page.getByLabel("Date", { exact: true });
  await date.selectOption({ label: "Tomorrow" });
  await expect(page.getByRole("region", { name: "Upcoming (1)" })).toBeVisible();

  await date.selectOption({ label: "On a date…" });
  await page.getByLabel("On date").fill(inDays(3));
  await expect(page.getByRole("region", { name: "Upcoming (1)" })).toBeVisible();
  await page.getByLabel("On date").fill(inDays(2));
  await expect(page.getByText("No appointments match these filters")).toBeVisible();

  await date.selectOption({ label: "Between dates…" });
  await page.getByLabel("From date").fill(inDays(1));
  await page.getByLabel("To date").fill(inDays(3));
  await expect(page.getByRole("region", { name: "Upcoming (2)" })).toBeVisible();

  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(date).toHaveValue("any");
  await expect(page.getByRole("region", { name: "Upcoming (2)" })).toBeVisible();
});
