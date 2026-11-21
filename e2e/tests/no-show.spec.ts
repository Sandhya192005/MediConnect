import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

// No-show (owner request 2026-11-20): the doctor or the hospital marks by hand that a patient didn't come.
// e2e_setup gives "Mani Noshow" one visit two days ago, already auto-completed by the hourly job.
test("doctor and hospital mark a missed visit; the patient is told; reports count it", async ({ page }) => {
  const { name, email } = e2e().no_show;

  // Doctor: Past → "Didn't come" → Missed; Undo → completed again.
  await login(page, e2e().doctor.email);
  await page.goto("/doctor/appointments");
  await page.getByRole("button", { name: "past" }).click();
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toContainText("completed");
  await row.getByRole("button", { name: `Didn't come for ${name}` }).click();
  await expect(row).toContainText("Missed");
  await expect(row).toContainText("The patient didn't come (marked by the doctor).");
  await expect(row.getByRole("button", { name: /Write note/ })).toHaveCount(0); // no note for a visit that didn't happen
  await row.getByRole("button", { name: `Undo missed for ${name}` }).click();
  await expect(row).toContainText("completed");
  await expect(row.getByRole("button", { name: `Didn't come for ${name}` })).toBeVisible();

  // Hospital: Past tab → "Didn't come".
  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, e2e().admin.email);
  await page.goto("/admin/appointments");
  await page.getByRole("tab", { name: "Past" }).click();
  const item = page.getByRole("listitem", { name: new RegExp(`^${name} with`) });
  await item.getByRole("button", { name: `Didn't come for ${name}` }).click();
  await expect(item).toContainText("Missed");
  await expect(item).toContainText("didn't come (marked by the hospital)");

  // Reports count it.
  await page.goto("/admin/reports");
  await expect(page.getByText(/1 missed \(no-show\)/)).toBeVisible();

  // The patient sees it, with a notification.
  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, email);
  await page.goto("/patient");
  await expect(page.getByLabel("Quick search")).toBeVisible();
  await expect(page.getByText("Emergency? Call")).toBeVisible(); // patients keep the emergency numbers
  await page.goto("/patient/records");
  await expect(page.getByRole("heading", { name: /medical records/i })).toBeVisible();
  await expect(page.getByLabel("Quick search")).toHaveCount(0); // no top-bar search here (2026-11-21)
  await page.goto("/patient/appointments");
  await expect(page.getByLabel("Quick search")).toHaveCount(0);
  await page.getByRole("button", { name: "past" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "You didn't come to this visit" })).toContainText("Missed");
  await page.getByRole("button", { name: /Notifications/ }).click();
  await expect(page.getByText("Missed appointment").first()).toBeVisible();
});
