import { expect, test } from "@playwright/test";
import { e2e } from "./helpers";

test("search shows MediConnect hospitals with their matching specialists", async ({ page }) => {
  const { doctor, partner_hospital } = e2e();
  await page.goto("/doctors");
  await expect(page.getByRole("heading", { name: /Find hospitals or doctors/ })).toBeVisible();
  const partners = page.getByRole("region", { name: "MediConnect hospitals" });

  // "Testdoctr" (typo) still finds Dr. Eshwar Testdoctor, shown inside his hospital's card.
  await page.getByLabel("Search doctors").fill("Testdoctr");
  const card = partners.getByRole("article", { name: partner_hospital.name });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Matching specialists");
  await expect(card.getByRole("link", { name: "Dr. Eshwar Testdoctor" })).toHaveAttribute("href", `/doctors/${doctor.id}`);
  await expect(card).toContainText("Cardiology");

  // An everyday word finds hospitals that have that kind of specialist.
  await page.getByLabel("Search doctors").fill("heart");
  await expect(partners.getByRole("link", { name: partner_hospital.name })).toBeVisible();
  await page.getByLabel("Search doctors").fill("skin");
  await expect(partners.getByRole("link", { name: partner_hospital.name })).toHaveCount(0); // no dermatologist there

  // Opening the hospital shows its doctors grouped by specialty, on the specialty searched for.
  await page.getByLabel("Search doctors").fill("Testdoctr");
  await partners.getByRole("link", { name: partner_hospital.name }).click();
  await expect(page).toHaveURL(new RegExp(`/hospitals/${partner_hospital.id}\\?specialty=Cardiology$`));
  await expect(page.getByRole("heading", { name: "Our specialists" })).toBeVisible();
  const cardiology = page.getByRole("region", { name: "Cardiology" });
  await expect(cardiology.getByText("Dr. Eshwar Testdoctor")).toBeVisible();
  await cardiology.getByRole("link", { name: /Dr\. Eshwar Testdoctor/ }).click();
  await expect(page).toHaveURL(new RegExp(`/doctors/${doctor.id}$`));
});

test("a hospital name search lists it with its specialties", async ({ page }) => {
  const { partner_hospital } = e2e();
  await page.goto("/doctors");
  await page.getByLabel("Search doctors").fill("E2E Partner");
  const partners = page.getByRole("region", { name: "MediConnect hospitals" });
  await expect(partners.getByRole("link", { name: partner_hospital.name })).toBeVisible();
  await expect(partners.getByRole("link", { name: /^Cardiology/ })).toBeVisible();
  await expect(page.getByText("Instant booking").first()).toBeVisible();
});

test("autocomplete suggests while typing", async ({ page }) => {
  await page.goto("/doctors");
  await page.getByLabel("Search doctors").fill("Eshw");
  const suggestion = page.getByRole("button", { name: /Dr\. Eshwar Testdoctor/ });
  await expect(suggestion).toBeVisible();
  await suggestion.click();
  await expect(page).toHaveURL(new RegExp(`/doctors/${e2e().doctor.id}$`));
});
