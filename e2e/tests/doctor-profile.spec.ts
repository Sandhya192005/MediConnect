import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

// "My hospital & profile" (owner request 2026-11-21): a read-only profile first, Edit opens the form,
// saving goes back to the profile.
test("the doctor's profile: view, edit, cancel and save", async ({ page }) => {
  await login(page, e2e().doctor.email);
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "My hospital & profile" }).click();
  await expect(page.getByRole("heading", { name: "My hospital & profile" })).toBeVisible();

  const profile = page.getByRole("region", { name: "Profile" });
  await expect(profile).toContainText("Dr. Eshwar Testdoctor");
  await expect(profile).toContainText("Accepting bookings");
  await expect(profile).toContainText("Cardiologist · MBBS, MD");
  await expect(profile).toContainText("₹700"); // not "700.00"
  await expect(page.getByRole("region", { name: "Hospital" })).toContainText(e2e().partner_hospital.name);
  await expect(page.getByRole("region", { name: "Edit profile" })).toHaveCount(0); // no form until Edit

  // Cancel throws changes away.
  await profile.getByRole("button", { name: "Edit profile" }).click();
  const form = page.getByRole("region", { name: "Edit profile" });
  await form.getByLabel("Shown on your public page").fill("Something I won't keep");
  await form.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("region", { name: "About you" })).not.toContainText("Something I won't keep");

  // Save goes back to the profile with the new text.
  await profile.getByRole("button", { name: "Edit profile" }).click();
  await form.getByLabel("Shown on your public page").fill("Heart specialist with 9 years of experience.");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved.");
  await expect(form).toHaveCount(0);
  await expect(page.getByRole("region", { name: "About you" })).toContainText("Heart specialist with 9 years of experience.");

  // Put the bio back for the other tests.
  await profile.getByRole("button", { name: "Edit profile" }).click();
  await form.getByLabel("Shown on your public page").fill("");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("region", { name: "About you" })).toContainText("Not added yet");
});
