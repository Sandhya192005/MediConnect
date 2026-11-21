import { expect, test } from "@playwright/test";
import { clearNotifications, e2e, login, tomorrow } from "./helpers";

/**
 * The main flow, with two browsers at once: the doctor is logged in and watching,
 * the patient books (a personal request, 2026-11-21) → the doctor's bell updates live (WebSocket) →
 * the doctor accepts → the patient sees it confirmed → the patient cancels.
 */
test("patient books, the doctor accepts, the patient cancels; both are notified live", async ({ browser, request }) => {
  const { doctor, patient } = e2e();
  const reason = `E2E booking test ${Date.now()}`;
  await clearNotifications(request, doctor.email); // earlier tests' bookings also notify this doctor

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
  await expect(page.getByTestId("booking-route")).toContainText("Personal request to Dr. Eshwar Testdoctor");
  await page.getByRole("button", { name: "Confirm booking" }).click();

  await expect(page).toHaveURL(/\/patient\/appointments\?booked=1/);
  await expect(page.getByText("Your booking is received")).toBeVisible();
  const mine = page.locator("li", { hasText: reason });
  await expect(mine).toContainText("Eshwar Testdoctor");
  await expect(mine).toContainText("Waiting for doctor");

  // The doctor's open tab gets the "New appointment request" notification without reloading.
  await expect(doctorPage.getByTestId("unread-count")).toHaveText("1", { timeout: 20_000 });
  const request_ = doctorPage.locator("li", { hasText: reason });
  await expect(request_).toContainText("Esha Patient");
  await expect(request_).toContainText("Personal request to you");
  await doctorPage.getByRole("button", { name: /^Notifications/ }).click();
  await expect(doctorPage.getByRole("button", { name: /New appointment request.*Esha Patient/ })).toBeVisible();

  // The doctor deletes it from the bell (✕ on the notification).
  await doctorPage.getByRole("button", { name: "Delete notification: New appointment request" }).click();
  await expect(doctorPage.getByRole("button", { name: /New appointment request.*Esha Patient/ })).toHaveCount(0);
  await expect(doctorPage.getByTestId("unread-count")).toHaveCount(0);
  await doctorPage.keyboard.press("Escape");

  // The doctor accepts: the patient's list shows it confirmed (live).
  await request_.getByRole("button", { name: /^Accept/ }).click();
  await expect(request_).toContainText("confirmed");
  await expect(mine).toContainText("confirmed", { timeout: 20_000 });

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

  // The doctor is told about the cancellation live, then clears all notifications.
  await expect(doctorPage.getByTestId("unread-count")).toHaveText("1", { timeout: 20_000 });
  await doctorPage.getByRole("button", { name: /^Notifications/ }).click(); // open the bell again
  await expect(doctorPage.getByRole("button", { name: /^Appointment cancelled/ })).toBeVisible();
  doctorPage.once("dialog", (d) => d.accept()); // "Delete all your notifications?"
  await doctorPage.getByRole("button", { name: "Clear all" }).click();
  await expect(doctorPage.getByText("No notifications yet.")).toBeVisible();
  await expect(doctorPage.getByTestId("unread-count")).toHaveCount(0);

  await doctorCtx.close();
  await patientCtx.close();
});
