import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n% MediConnect e2e test report\n");

// Hospital Patient management (owner request 2026-11-21): add patients, edit details, upload records —
// all in one place. Records the hospital uploads show in the patient's own records; each side deletes its own copy.
test("the hospital adds a new patient (no email, no password), edits details and uploads a record", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, e2e().admin.email);
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Patient management" }).click();
  await page.getByRole("button", { name: "Add patient" }).click();
  const add = page.getByRole("region", { name: "Add patient" });
  await add.getByRole("tab", { name: "New patient" }).click();
  await add.getByLabel("First name").fill("Ravi");
  await add.getByLabel("Last name").fill("Walkin");
  await add.getByLabel("Phone").fill("98765 43210");
  await add.getByLabel(/Gender/).selectOption("male");
  await add.getByRole("button", { name: "Create patient" }).click();

  // The patient's page: a patient ID, no email, no app login.
  await expect(page).toHaveURL(/\/admin\/patients\/P\d{6}\?added=1$/);
  await expect(page.getByRole("status")).toHaveText("Patient added to your patients.");
  const who = page.getByRole("region", { name: "Patient" });
  await expect(who).toContainText("Ravi Walkin");
  await expect(who).toContainText("98765 43210 · No email · No app login yet");

  // Edit details: blood group and an allergy.
  await page.getByRole("button", { name: "Edit details" }).click();
  await page.getByLabel("Blood group").selectOption("B+");
  await page.getByRole("radiogroup", { name: "Do you have any allergies?" }).getByLabel("Yes").check();
  await page.getByLabel(/allergic to/).fill("Sulfa drugs");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Details saved.");
  await expect(page.getByText("Allergies: Sulfa drugs")).toBeVisible();

  // Upload a record.
  await page.getByLabel("File").setInputFiles({ name: "xray.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByLabel("Title").fill("Chest X-ray");
  await page.getByRole("button", { name: "Upload record" }).click();
  const records = page.getByRole("region", { name: /^Medical records/ });
  await expect(records).toContainText("Chest X-ray");
  await expect(records).toContainText("Uploaded by E2E Partner Hospital");

  // It's in the list, marked "Added by you".
  await page.getByRole("link", { name: "Patient management" }).first().click();
  await expect(page.getByRole("listitem").filter({ hasText: "Ravi Walkin" })).toContainText("Added by you");
});

test("a record the hospital uploads shows in the patient's records; each side deletes its own copy", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const { patient, admin } = e2e();

  // The hospital adds the E2E patient by patient ID and uploads a record.
  await login(page, admin.email);
  await page.goto("/admin/patients");
  await page.getByRole("button", { name: "Add patient" }).click();
  await page.getByRole("region", { name: "Add patient" }).getByLabel("Patient ID").fill(patient.patient_id.toLowerCase());
  await page.getByRole("region", { name: "Add patient" }).getByRole("button", { name: "Add patient" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/patients/${patient.patient_id}`));
  await page.getByLabel("File").setInputFiles({ name: "lab.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByLabel("Title").fill("Thyroid panel");
  await page.getByRole("button", { name: "Upload record" }).click();
  const records = page.getByRole("region", { name: /^Medical records/ });
  await expect(records).toContainText("Thyroid panel");

  // The patient sees it, from the hospital, and removes it from their records.
  const p = await (await browser.newContext()).newPage();
  await login(p, patient.email);
  await p.goto("/patient/records");
  const mine = p.getByRole("listitem").filter({ hasText: "Thyroid panel" });
  await expect(mine).toContainText("Uploaded by E2E Partner Hospital");
  p.once("dialog", (d) => { expect(d.message()).toContain("E2E Partner Hospital keeps its copy"); d.accept(); });
  await mine.getByRole("button", { name: "Delete Thyroid panel" }).click();
  await expect(p.getByRole("listitem").filter({ hasText: "Thyroid panel" })).toHaveCount(0);

  // The hospital still has its copy; then it deletes it too.
  await page.reload();
  await expect(records).toContainText("Thyroid panel");
  page.once("dialog", (d) => { expect(d.message()).toContain("The patient keeps their copy"); d.accept(); });
  await records.getByRole("button", { name: "Delete Thyroid panel" }).click();
  await expect(records).not.toContainText("Thyroid panel");
});
