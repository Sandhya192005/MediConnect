import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

// Duty schedule with AM/PM (owner request 2026-11-21): hour · minutes · AM/PM dropdowns instead of the
// browser's time box (which showed 24-hour time on some computers). The E2E doctor works 6 AM–10 PM every
// day and other tests book inside those hours, so this test puts the time back at the end.
test("the doctor sets working hours with AM/PM", async ({ page }) => {
  await login(page, e2e().doctor.email);
  await expect(page.getByRole("region", { name: "Today's duty" })).toContainText("6:00 AM – 10:00 PM"); // dashboard panel

  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Duty schedule" }).click();
  const to = page.getByRole("group", { name: "To, block 1" });
  await expect(to.getByLabel("To, block 1: hour")).toHaveValue("10");
  await expect(to.getByLabel("To, block 1: minutes")).toHaveValue("0");
  await expect(to.getByLabel("To, block 1: AM or PM")).toHaveValue("PM");

  // 10:00 PM → 9:30 PM, saved and still there after a reload.
  await to.getByLabel("To, block 1: hour").selectOption("9");
  await to.getByLabel("To, block 1: minutes").selectOption("30");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Working hours saved.")).toBeVisible();
  await page.reload();
  await expect(to.getByLabel("To, block 1: hour")).toHaveValue("9");
  await expect(to.getByLabel("To, block 1: minutes")).toHaveValue("30");
  await expect(to.getByLabel("To, block 1: AM or PM")).toHaveValue("PM");

  // Back to 10:00 PM for the other tests.
  await to.getByLabel("To, block 1: hour").selectOption("10");
  await to.getByLabel("To, block 1: minutes").selectOption("0");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Working hours saved.")).toBeVisible();
});
