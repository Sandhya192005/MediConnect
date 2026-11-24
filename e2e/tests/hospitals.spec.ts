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
  // A hospital pin's popup has "Get directions" to Google Maps (2026-11-24). The patient's own pin may sit on
  // top of a hospital, so try the pins until a hospital's popup opens.
  const pins = map.locator(".leaflet-overlay-pane path.leaflet-interactive");
  const directions = map.locator(".leaflet-popup-pane").getByRole("link", { name: /Get directions/ });
  for (let i = 0; i < (await pins.count()) && !(await directions.count()); i++) {
    await pins.nth(i).dispatchEvent("click");
  }
  await expect(directions.first()).toHaveAttribute("href", /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=/);
  await expect(directions.first()).toHaveAttribute("target", "_blank");
  await page.getByRole("button", { name: "Hide map" }).click();
  await expect(map).toHaveCount(0);

  // Old links to /hospitals land here, keeping the search.
  await page.goto("/hospitals?q=heart");
  await expect(page).toHaveURL(/\/doctors\?q=heart$/);
  await expect(page.getByLabel("Search doctors")).toHaveValue("heart");
});
test("a hospital's page has Get directions next to its details and under its map", async ({ page }) => {
  const { partner_hospital } = e2e();
  await page.goto(`/hospitals/${partner_hospital.id}`);
  const links = page.getByRole("link", { name: /Get directions/ });
  await expect(links.first()).toBeVisible();
  // The E2E hospital's pin is confirmed, so the link goes to its exact spot (owner request 2026-11-24).
  await expect(links.first()).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=13\.05%2C80\.24/);
  await expect(links).toHaveCount(2); // the button by the address and the link under the map
  // Show on map next to it: the hospital's own map opens its pin (2026-11-24).
  await page.getByRole("button", { name: "Show on map" }).click();
  await expect(page.locator(".leaflet-popup-content")).toContainText(partner_hospital.name);
});

test("Show on map on a hospital card opens the map on that hospital, with directions", async ({ page }) => {
  const { partner_hospital } = e2e();
  await page.goto("/doctors");
  const card = page.getByRole("region", { name: "MediConnect hospitals" }).getByRole("article", { name: partner_hospital.name });
  // Both options on the card (owner request 2026-11-24).
  await expect(card.getByRole("link", { name: `Get directions to ${partner_hospital.name}` }))
    .toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=13\.05%2C80\.24/);
  await expect(page.getByRole("region", { name: /^Other hospitals/ }).getByRole("link", { name: /^Get directions to / }).first()).toBeVisible();
  await card.getByRole("button", { name: `Show ${partner_hospital.name} on map` }).click();
  const map = page.getByRole("region", { name: "Map" });
  await expect(map.locator(".leaflet-container")).toBeVisible();
  const popup = map.locator(".leaflet-popup-content");
  await expect(popup).toContainText(partner_hospital.name);
  await expect(popup.getByRole("link", { name: /Get directions/ })).toHaveAttribute("href", /google\.com\/maps\/dir/);
});
