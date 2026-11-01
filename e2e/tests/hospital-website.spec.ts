import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

/**
 * The whole website-reading pipeline, for real: page view → Celery job on the scraper queue →
 * Playwright (Python, in scraper_worker) reads our mock hospital site → doctors saved → live notification.
 * Only the mock site (http://mockhospital/) is read: never a real hospital website.
 */
test("opening a hospital reads its website, and its doctors can be searched", async ({ page }) => {
  test.setTimeout(150_000);
  const { mock_hospital, patient } = e2e();
  await login(page, patient.email);
  await page.goto(`/hospitals/${mock_hospital.id}`);
  await expect(page.getByRole("heading", { name: mock_hospital.name })).toBeVisible();
  await expect(page.getByText("Not a MediConnect partner")).toBeVisible();

  // The saved copy is empty → a background read starts on its own.
  await expect(page.getByRole("status")).toContainText("Fetching the latest info");

  // Doctors from the mock site appear (including ones its page adds with JavaScript).
  await expect(page.getByText("Dr. Kavitha Raman").first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Dr. Farhan Ali").first()).toBeVisible();
  await expect(page.getByText(/Collected .* from/)).toBeVisible();

  // Search inside this hospital's doctors (the request form's doctor dropdown keeps listing everyone, on purpose).
  const heading = page.getByRole("heading", { name: /Doctors listed on their website/ });
  const list = heading.locator("xpath=following-sibling::ul[1]");
  await expect(heading).toHaveText(/\(5\)/);
  await page.getByLabel("Search doctors at this hospital").fill("derma");
  await expect(heading).toHaveText(/\(1 of 5\)/);
  await expect(list.getByText("Dr. Farhan Ali")).toBeVisible();
  await expect(list.getByText("Dr. Kavitha Raman")).toHaveCount(0);

  // Not a partner: no instant booking, only a request that stays "not confirmed".
  await expect(page.getByRole("button", { name: "Confirm booking" })).toHaveCount(0);
});
