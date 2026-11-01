import { expect, test } from "@playwright/test";
import { e2e } from "./helpers";

test("search tolerates typos and finds doctors and hospitals", async ({ page }) => {
  await page.goto("/doctors");
  await expect(page.getByRole("heading", { name: /Find hospitals or doctors/ })).toBeVisible();
  const box = page.getByLabel("Search doctors");

  // "Testdoctr" (typo) still finds Dr. Eshwar Testdoctor through Elasticsearch fuzzy matching.
  await box.fill("Testdoctr");
  const doctorCard = page.locator(`a[href="/doctors/${e2e().doctor.id}"]`).first();
  await expect(doctorCard).toBeVisible();
  await expect(doctorCard).toContainText("Cardiologist");

  // Hospitals are searched too, and open the hospital page.
  await box.fill("E2E Partner");
  const hospitalCard = page.locator(`a[href="/hospitals/${e2e().partner_hospital.id}"]`).first();
  await expect(hospitalCard).toBeVisible();
  await hospitalCard.click();
  await expect(page.getByRole("heading", { name: e2e().partner_hospital.name })).toBeVisible();
  await expect(page.getByText("MediConnect partner · instant booking")).toBeVisible();
});

test("autocomplete suggests while typing", async ({ page }) => {
  await page.goto("/doctors");
  await page.getByLabel("Search doctors").fill("Eshw");
  const suggestion = page.getByRole("button", { name: /Dr\. Eshwar Testdoctor/ });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page).toHaveURL(new RegExp(`/doctors/${e2e().doctor.id}$`));
});
