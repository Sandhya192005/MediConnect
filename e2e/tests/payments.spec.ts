import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

// Payment slips (owner request 2026-11-21): the hospital bills a patient with an itemised slip (live total),
// prints it, marks it paid (then it's locked), and the patient sees it in My payments.
test("the hospital bills a patient, marks the slip paid, and the patient sees it", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { patient, admin } = e2e();

  // The hospital adds the E2E patient by ID and opens a new slip.
  await login(page, admin.email);
  await page.goto("/admin/patients");
  await page.getByRole("button", { name: "Add patient" }).click();
  const add = page.getByRole("region", { name: "Add patient" });
  await add.getByLabel("Patient ID").fill(patient.patient_id);
  await add.getByRole("button", { name: "Add patient" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/patients/${patient.patient_id}`));

  const payments = page.getByRole("region", { name: /^Payments/ });
  await payments.getByRole("button", { name: "New payment slip" }).click();
  const form = page.getByRole("region", { name: "New payment slip" });
  await form.getByLabel("Line 1 price").fill("700");
  await form.getByRole("button", { name: "+ Add line" }).click();
  await form.getByLabel("Line 2 description").fill("Blood test");
  await form.getByLabel("Line 2 quantity").fill("2");
  await form.getByLabel("Line 2 price").fill("225.50");
  await form.getByLabel(/Discount/).fill("51");
  await expect(form.getByTestId("form-total")).toHaveText("₹1,100.00"); // live: 700 + 2 × 225.50 − 51
  await form.getByRole("button", { name: "Save slip" }).click();

  const slip = payments.getByRole("listitem").filter({ hasText: "EPH-" });
  await expect(slip).toContainText("Pending");
  await expect(slip).toContainText("₹1,100.00");
  await expect(payments.getByTestId("payment-totals")).toContainText("Pending ₹1,100.00");
  const number = (await slip.locator(".font-mono").first().innerText()).trim();
  expect(number).toMatch(/^EPH-\d{4}-\d{4}$/);

  // The printable slip.
  await slip.getByRole("link", { name: `View and print ${number}` }).click();
  const doc = page.getByRole("article", { name: `Payment slip ${number}` });
  await expect(doc).toContainText("E2E Partner Hospital");
  await expect(doc).toContainText("Esha Patient");
  await expect(doc).toContainText("Blood test");
  await expect(doc.getByTestId("slip-total")).toHaveText("₹1,100.00");
  await expect(doc).toContainText("Payment pending.");
  await expect(page.getByRole("button", { name: "Print or save as PDF" })).toBeVisible();
  await page.goBack();

  // Mark as paid by UPI: completed and locked (no Edit or Cancel any more).
  const row = page.getByRole("region", { name: /^Payments/ }).getByRole("listitem", { name: `Slip ${number}` });
  await row.getByRole("button", { name: `Mark ${number} as paid` }).click();
  await row.getByLabel("Paid by").selectOption("upi");
  await row.getByRole("button", { name: /Confirm payment/ }).click();
  await expect(row).toContainText("Completed");
  await expect(row).toContainText("by UPI");
  await expect(row.getByRole("button", { name: `Edit ${number}` })).toHaveCount(0);
  await expect(row.getByRole("button", { name: `Set ${number} back to pending` })).toBeVisible();

  // The patient sees it in My payments, with the slip.
  const p = await (await browser.newContext()).newPage();
  await login(p, patient.email);
  await p.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "My payments" }).click();
  const mine = p.getByRole("listitem", { name: `Slip ${number}` });
  await expect(mine).toContainText("E2E Partner Hospital");
  await expect(mine).toContainText("Completed");
  await mine.getByRole("link", { name: `Open slip ${number}` }).click();
  await expect(p.getByRole("article", { name: `Payment slip ${number}` })).toContainText("by UPI");
});
