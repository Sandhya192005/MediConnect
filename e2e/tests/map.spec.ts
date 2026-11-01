import { expect, test } from "@playwright/test";
import { e2e } from "./helpers";

// The browser "is" in Chennai, next to the E2E partner hospital, and allows location access.
test.use({
  geolocation: { latitude: 13.05, longitude: 80.24 },
  permissions: ["geolocation"],
});

test("nearby map shows hospitals around the patient and opens one", async ({ page }) => {
  const { partner_hospital } = e2e();
  await page.goto("/hospitals");
  await page.getByRole("button", { name: "Use my location" }).click();

  // Leaflet map with OpenStreetMap tiles; pins are drawn as SVG circles (you + the hospitals).
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator(".leaflet-tile-pane img").first()).toBeVisible();
  await expect.poll(() => page.locator(".leaflet-overlay-pane path.leaflet-interactive").count()).toBeGreaterThan(1);

  // Partners only: our test hospital is in the list (nearest first).
  await page.getByLabel("Instant-booking partners only").check();
  const link = page.getByRole("link", { name: partner_hospital.name });
  await expect(link).toBeVisible();

  // Filtering by name narrows the list.
  await page.getByLabel("Filter hospitals").fill("E2E Partner");
  await expect(link).toBeVisible();

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/hospitals/${partner_hospital.id}$`));
  await expect(page.getByRole("heading", { name: partner_hospital.name })).toBeVisible();
  await expect(page.getByText("Eshwar Testdoctor").first()).toBeVisible();
});
