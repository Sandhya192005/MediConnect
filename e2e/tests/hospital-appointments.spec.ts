import { expect, test } from "@playwright/test";
import { bookAsPatient, cancelPatientBookings, e2e, login, tomorrow } from "./helpers";

/**
 * Booking flow (owner decisions 2026-11-21), hospital request:
 * patient books through the hospital's page → hospital Accept & assign / Decline → doctor Reject (reason) →
 * back to the hospital → Reassign → doctor Accept → "Duty assigned for you" and the doctor's page in
 * Doctor management (Accepted / Rejected).
 */
test("hospital request: hospital assigns, doctor rejects, hospital reassigns, doctor accepts", async ({ page, browser, request }) => {
  test.setTimeout(150_000); // seven steps across three logins
  await cancelPatientBookings(request);
  const { doctor, partner_hospital } = e2e();
  try {
    // 1. The patient books through the hospital's page (its specialist list): a hospital request.
    await login(page, e2e().patient.email);
    await page.goto(`/hospitals/${partner_hospital.id}`);
    await page.getByRole("link", { name: /Eshwar Testdoctor/ }).first().click();
    await expect(page).toHaveURL(/via=hospital/);
    await expect(page.getByTestId("booking-route")).toContainText(`Booking through ${partner_hospital.name}`);
    const booking = page.locator("section", { has: page.getByRole("heading", { name: "Book an appointment" }) });
    await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/slots/?date=${tomorrow()}`) && r.ok()),
      booking.locator("div.overflow-x-auto button").nth(1).click(),
    ]);
    await booking.locator(".grid button:not([disabled])").first().click();
    await page.getByPlaceholder("Reason for visit (optional)").fill("Fever");
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page).toHaveURL(/\/patient\/appointments\?booked=1/);
    await expect(page.locator("li", { hasText: "Fever" })).toContainText("Waiting for hospital");
    // A second hospital request, which the hospital will decline.
    await bookAsPatient(request, tomorrow(), "Follow-up", { source: "hospital" });

    // 2. The hospital: both wait under "To assign".
    const hospital = await (await browser.newContext()).newPage();
    await login(hospital, e2e().admin.email);
    await hospital.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Appointments" }).click();
    await expect(hospital.getByRole("switch")).toHaveCount(0); // the old on/off switch is gone
    const toAssign = hospital.getByRole("region", { name: /^To assign/ });
    const rows = toAssign.getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Fever" })).toContainText("Through your hospital");

    // Decline needs a reason; the patient sees it.
    const decline = rows.filter({ hasText: "Follow-up" });
    await decline.getByRole("button", { name: "Decline" }).click();
    await expect(hospital.getByText(/give a short reason/)).toBeVisible(); // (Next.js has its own empty role="alert")
    await decline.getByLabel(/Reason if declining/).fill("The doctor is in surgery then");
    await decline.getByRole("button", { name: "Decline" }).click();
    await expect(rows).toHaveCount(1);

    // Accept & assign to the doctor the patient chose.
    const fever = rows.filter({ hasText: "Fever" });
    await expect(fever.getByLabel(/^Doctor for/)).toBeEnabled();
    await expect(fever.getByLabel(/^Doctor for/)).toHaveValue(String(doctor.id));
    await fever.getByRole("button", { name: "Accept & assign" }).click();
    await expect(toAssign.getByText("Nothing to assign")).toBeVisible();

    // 3. The doctor rejects it with a reason.
    const doc = await (await browser.newContext()).newPage();
    await login(doc, doctor.email);
    await doc.goto("/doctor/appointments");
    const req = doc.locator("li", { hasText: "Fever" });
    await expect(req).toContainText(`Assigned to you by ${partner_hospital.name}`);
    await req.getByRole("button", { name: /^Reject/ }).click();
    await req.getByLabel(/Reason for rejecting/).fill("On leave that day");
    await req.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(doc.locator("li", { hasText: "Fever" })).toHaveCount(0); // back with the hospital

    // 4. Back at the hospital: who said no and why; reassign (only one doctor here: the same one, by hand).
    await hospital.reload();
    const back = hospital.getByRole("region", { name: /^To assign/ }).getByRole("listitem").filter({ hasText: "Fever" });
    await expect(back).toContainText("rejected it: On leave that day");
    await expect(back.getByLabel(/^Doctor for/)).toBeEnabled(); // the doctor list has loaded
    await expect(back.getByRole("button", { name: "Reassign" })).toBeDisabled(); // no doctor picked by default
    await back.getByLabel(/^Doctor for/).selectOption(String(doctor.id));
    await back.getByRole("button", { name: "Reassign" }).click();
    await expect(hospital.getByText("Nothing to assign")).toBeVisible();

    // 5. The doctor accepts this time; it shows under "Duty assigned for you".
    await doc.reload();
    await doc.locator("li", { hasText: "Fever" }).getByRole("button", { name: /^Accept/ }).click();
    await expect(doc.locator("li", { hasText: "Fever" })).toContainText("confirmed");
    await doc.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Duty schedule" }).click();
    await expect(doc.getByRole("region", { name: "Duty assigned for you" })).toContainText(`From ${partner_hospital.name}`);

    // 6. The patient sees it confirmed, and the declined one with the hospital's reason.
    await page.reload();
    await expect(page.locator("li", { hasText: "Fever" })).toContainText("confirmed");
    await expect(page.locator("li", { hasText: "Follow-up" })).toContainText("Declined by the hospital: The doctor is in surgery then");

    // 7. Doctor management → the doctor's page: the visit is accepted, and 1 rejection with the reason.
    // (Accepted also counts the no-show test's completed visit, made by e2e_setup.)
    await hospital.goto(`/admin/doctors/${doctor.id}`);
    await expect(hospital.getByRole("region", { name: "Accepted appointments" })).toContainText("Esha Patient");
    await expect(hospital.getByRole("tab", { name: /Rejected/ })).toHaveText("Rejected1");
    await hospital.getByRole("tab", { name: /Rejected/ }).click();
    await expect(hospital.getByRole("region", { name: "Rejected appointments" })).toContainText("Reason: On leave that day");
  } finally {
    await cancelPatientBookings(request);
  }
});
