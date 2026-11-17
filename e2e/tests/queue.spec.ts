import { expect, test } from "@playwright/test";
import { bookAsPatient, cancelPatientBookings, e2e, login, today } from "./helpers";

// Needs a free slot later today (the E2E doctor works 06:00–22:00), so it can't run after ~21:30 India time.
test("patient checks in, the doctor calls them in, and the patient is told it's their turn", async ({ page, browser, request }) => {
  await cancelPatientBookings(request);
  await bookAsPatient(request, today(), "Queue e2e check");

  // Patient: today's visit card → "I've arrived" → a token.
  await login(page, e2e().patient.email);
  const visit = page.getByRole("region", { name: "Today's visit" });
  await expect(visit).toContainText("Your visit today");
  await visit.getByRole("button", { name: "I've arrived" }).click();
  await expect(visit.getByTestId("my-token")).toHaveText(/^\d+$/);
  await expect(visit.getByTestId("people-ahead")).toHaveText("You're next");

  // Doctor: the patient is waiting; call them in.
  const doctorContext = await browser.newContext();
  const doctorPage = await doctorContext.newPage();
  await login(doctorPage, e2e().doctor.email);
  await doctorPage.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Patient queue" }).click();
  const waiting = doctorPage.getByRole("region", { name: /^Waiting/ });
  await expect(waiting.getByText("Esha Patient")).toBeVisible();
  await doctorPage.getByRole("button", { name: /^Call next: token \d+$/ }).click();
  const now = doctorPage.getByRole("region", { name: "Now consulting" });
  await expect(now.getByText("Esha Patient")).toBeVisible();
  await expect(now.getByRole("link", { name: "Open records" })).toHaveAttribute("href", `/doctor/records?id=${e2e().patient.patient_id}`);

  // Patient: the live notification turns the card into "It's your turn".
  await expect(visit.getByText("It's your turn")).toBeVisible({ timeout: 20_000 });

  // Doctor: done → the visit moves to "Done today", and the patient's card goes away.
  await now.getByRole("button", { name: "Done" }).click();
  await expect(doctorPage.getByRole("region", { name: /^Done today/ }).getByText("Esha Patient")).toBeVisible();
  await expect(now.getByText("No one in consultation")).toBeVisible();
  await doctorContext.close();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Patient dashboard" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Today's visit" })).toHaveCount(0);
});
