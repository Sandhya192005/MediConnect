import { expect, test } from "@playwright/test";
import { API, e2e, firstFreeSlot, login } from "./helpers";

/**
 * The assistant's reply is faked in the browser (no OpenAI call, no cost, same answer every run).
 * Everything else is real: the chat panel, the booking card, and its "Confirm booking" → the normal booking API.
 */
test("assistant proposes a slot and the patient confirms it", async ({ page, request }) => {
  const { doctor, patient } = e2e();
  const start = await firstFreeSlot(request);
  const reason = `E2E chatbot test ${Date.now()}`;

  await page.route(`${API}/api/chat/`, (route) =>
    route.fulfill({
      json: {
        session_id: 1,
        reply: "Dr. Eshwar Testdoctor (Cardiologist) has a free slot tomorrow. Shall I book it?",
        emergency: false,
        emergency_notice: null,
        proposals: [{
          doctor_id: doctor.id, name: doctor.name, specialization: "Cardiologist",
          hospital: "E2E Partner Hospital", city: "Chennai", fee: 700, start, when: "Tomorrow", reason,
        }],
      },
    }),
  );
  await page.route(`${API}/api/chat/history/`, (route) => route.fulfill({ json: { session_id: null, messages: [] } }));

  await login(page, patient.email);
  await page.getByRole("button", { name: "Open assistant" }).click();
  const panel = page.getByRole("region", { name: "MediConnect assistant" });
  await expect(panel).toBeVisible();
  await panel.getByLabel("Message").fill("I need a heart doctor tomorrow");
  await panel.getByLabel("Message").press("Enter");

  await expect(panel.getByText("I need a heart doctor tomorrow")).toBeVisible();
  await expect(panel.getByText(/has a free slot tomorrow/)).toBeVisible();
  await panel.getByRole("button", { name: "Confirm booking" }).click();
  await expect(panel.getByText("✓ Booked!")).toBeVisible();

  // It's a real appointment now.
  await page.goto("/patient/appointments");
  await expect(page.locator("li", { hasText: reason })).toContainText("booked");
});
