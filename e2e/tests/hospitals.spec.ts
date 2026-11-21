import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

// Book appointment is the one place to find a hospital (owner requests 2026-11-18): search, "Instant
// booking only", Near me (nearest first) and Show map. The browser "is" at the E2E partner hospital.
test.use({
  geolocation: { latitude: 13.05, longitude: 80.24 },
  permissions: ["geolocation"],
});

test("book appointment: other hospitals, instant-booking filter, near me and the map", async ({ page }) => {
  const { partner_hospital } = e2e();
  await login(page, e2e().patient.email);
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Find hospitals" })).toHaveCount(0); // one place: Book appointment
  await menu.getByRole("link", { name: "Book appointment" }).click();
  await expect(page.getByRole("heading", { name: "Book an appointment" })).toBeVisible();
  await expect(page.locator(".leaflet-container")).toHaveCount(0); // the map only opens on request

  // MediConnect hospitals first, then every other hospital (request an appointment).
  const partners = page.getByRole("region", { name: "MediConnect hospitals" });
  await expect(partners.getByRole("article", { name: partner_hospital.name })).toBeVisible();
  const others = page.getByRole("region", { name: "Other hospitals" });
  await expect(others.getByRole("article").first()).toContainText("Request appointment");

  // Instant booking only hides the other hospitals.
  await page.getByRole("button", { name: "Instant booking only" }).click();
  await expect(others).toHaveCount(0);

  // Near me: one list, nearest first, with the distance; bookable ones say "Book appointment".
  await page.getByRole("button", { name: "Near me" }).click();
  const near = page.getByRole("region", { name: "Hospitals near you" });
  const card = near.getByRole("article", { name: partner_hospital.name });
  await expect(card).toContainText(/0\.\d km away/);
  await expect(card.getByRole("link", { name: "Book appointment" })).toHaveAttribute("href", `/hospitals/${partner_hospital.id}`);

  // Show map: OpenStreetMap tiles with the patient and the hospitals as pins.
  await page.getByRole("button", { name: "Show map" }).click();
  const map = page.getByRole("region", { name: "Map" });
  await expect(map.locator(".leaflet-container")).toBeVisible();
  await expect.poll(() => map.locator(".leaflet-overlay-pane path.leaflet-interactive").count()).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Hide map" }).click();
  await expect(map).toHaveCount(0);

  // Old links to /hospitals land here, keeping the search.
  await page.goto("/hospitals?q=heart");
  await expect(page).toHaveURL(/\/doctors\?q=heart$/);
  await expect(page.getByLabel("Search doctors")).toHaveValue("heart");
});