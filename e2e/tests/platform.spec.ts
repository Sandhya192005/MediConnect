import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

test("platform admin sees platform totals, usage charts and hospital growth", async ({ page }) => {
  await login(page, e2e().platform.email);
  await expect(page.getByText("Platform overview")).toBeVisible();

  // Totals for the whole platform, with the growth line under each.
  for (const label of ["Patients", "Doctors", "Connected hospitals", "Appointments this month"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Platform usage" }).getByRole("img", { name: /Active patients and doctors/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent activity" })).toBeVisible();

  // Reports & analytics: usage and hospital growth, with the connected hospitals table.
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Reports & analytics" }).click();
  await expect(page.getByRole("heading", { name: "Reports & analytics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Platform usage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hospital growth" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Connected hospitals at the end of each month, last 12 months/ })).toBeVisible();
  const table = page.getByRole("region", { name: /^Connected hospitals \(/ });
  await expect(table.getByText("E2E Partner Hospital")).toBeVisible();

  // Changing the period reloads the charts for that range.
  await page.getByRole("button", { name: "24 months" }).click();
  await expect(page.getByRole("img", { name: /Connected hospitals at the end of each month, last 24 months/ })).toBeVisible();
});

test("hospital admins don't get the platform reports", async ({ page }) => {
  await login(page, e2e().admin.email);
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Reports & analytics" })).toHaveCount(0);
  await page.goto("/admin/reports");
  await expect(page.getByText("Platform reports are for the MediConnect platform admin")).toBeVisible();
});
