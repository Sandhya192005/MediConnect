import { expect, test } from "@playwright/test";
import { e2e, login, tomorrow } from "./helpers";

/**
 * The main flow, with two browsers at once: the doctor is logged in and watching,
 * the patient books → the doctor's bell updates live (WebSocket) → the patient cancels.
 */
test("patient books and cancels; the doctor is notified live", async ({ browser }) => {
  const { doctor, patient } = e2e();
  const reason = `E2E booking test ${Date.now()}`;

  const doctorCtx = await browser.newContext();
  const doctorPage = await doctorCtx.newPage();
  await login(doctorPage, doctor.email);
  await doctorPage.goto("/doctor/appointments");
  await expect(doctorPage.getByRole("button", { name: /^Notifications/ })).toBeVisible();
  await expect(doctorPage.getByTestId("unread-count")).toHaveCount(0);

  const patientCtx = await browser.newContext();
  const page = await patientCtx.newPage();
  await login(page, patient.email);
  await page.goto(`/doctors/${doctor.id}`);
  await expect(page.getByRole("heading", { name: doctor.name })).toBeVisible();

  // Tomorrow is the 2nd day button; pick its first free slot.
  const booking = page.locator("section", { has: page.getByRole("heading", { name: "Book an appointment" }) });
  // Click "tomorrow" and wait until its slots have arrived (so we never click a slot of today's list).
  const pickTomorrow = () =>
    Promise.all([
      page.waitForResponse((r) => r.url().includes(`/slots/?date=${tomorrow()}`) && r.ok()),
      booking.locator("div.overflow-x-auto button").nth(1).click(),
    ]);
  await pickTomorrow();
  const slot = booking.locator(".grid button:not([disabled])").first();
  const slotTime = (await slot.innerText()).trim();
  await slot.click();
  await page.getByPlaceholder("Reason for visit (optional)").fill(reason);
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page).toHaveURL(/\/patient\/appointments\?booked=1/);
  await expect(page.getByText("Your appointment is booked.")).toBeVisible();
  const mine = page.locator("li", { hasText: reason });
  await expect(mine).toContainText("Eshwar Testdoctor");
  await expect(mine).toContainText("booked");

  // The doctor's open tab gets the "New booking" notification without reloading.
  await expect(doctorPage.getByTestId("unread-count")).toHaveText("1", { timeout: 20_000 });
  await expect(doctorPage.locator("li", { hasText: reason })).toContainText("Esha Patient");
  await doctorPage.getByRole("button", { name: /^Notifications/ }).click();
  await expect(doctorPage.getByRole("button", { name: /New booking.*Esha Patient/ })).toBeVisible();

  // The slot is now taken: shown crossed out and disabled for everyone.
  await page.goto(`/doctors/${doctor.id}`);
  await pickTomorrow();
  await expect(booking.locator(".grid button", { hasText: slotTime })).toBeDisabled();

  // Cancel (the app asks "Cancel this appointment?" in a browser dialog: accept it).
  page.once("dialog", (d) => d.accept());
  await page.goto("/patient/appointments");
  await mine.getByRole("button", { name: "Cancel" }).click();
  await expect(mine).toContainText("cancelled");
  await expect(mine.getByRole("button", { name: "Cancel" })).toHaveCount(0);

  await doctorCtx.close();
  await patientCtx.close();
});
