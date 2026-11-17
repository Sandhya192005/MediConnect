import { expect, test, type APIRequestContext } from "@playwright/test";
import { API, e2e, login } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n% MediConnect e2e test report\n");

/**
 * A brand-new patient who has never booked anything. With the general patient ID, a doctor can still open
 * their history. "e2e.new.*" accounts are deleted by the next e2e_setup.
 */
async function newPatientId(request: APIRequestContext) {
  const email = `e2e.new.records.${Date.now()}@mediconnect.dev`;
  const reg = await request.post(`${API}/api/auth/register/`, {
    data: { email, password: "Strong@pass1", first_name: "Never", last_name: "Booked" },
  });
  expect(reg.status()).toBe(201);
  const auth = await (await request.post(`${API}/api/auth/login/`, { data: { email, password: "Strong@pass1" } })).json();
  return auth.user.patient_id as string;
}

test("patient uploads a record, a doctor opens it with the general patient ID, and the patient sees who looked", async ({ page, browser, request }) => {
  const patientId = e2e().patient.patient_id;

  // Patient: sees their ID and uploads a report.
  await login(page, e2e().patient.email);
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "My medical records" }).click();
  await expect(page.getByRole("heading", { name: "My medical records" })).toBeVisible();
  await expect(page.getByTestId("patient-id")).toHaveText(patientId);

  await page.getByLabel("File").setInputFiles({ name: "blood-test.pdf", mimeType: "application/pdf", buffer: PDF });
  await page.getByLabel("Title").fill("Blood test");
  await page.getByLabel("Type").selectOption("lab_report");
  await page.getByRole("button", { name: "Upload record" }).click();
  await expect(page.getByRole("status")).toHaveText("Uploaded.");
  const myRecords = page.getByRole("region", { name: /^My records/ });
  await expect(myRecords.getByText("Blood test", { exact: true })).toBeVisible();

  // Doctor: an ID that doesn't exist opens nothing…
  const doctorContext = await browser.newContext();
  const doctorPage = await doctorContext.newPage();
  await login(doctorPage, e2e().doctor.email);
  await doctorPage.goto("/doctor/records?id=P000000");
  await expect(doctorPage.getByText("No patient with ID P000000")).toBeVisible();

  // …but any real ID does, even for a patient who never booked anything (general patient ID).
  const neverBooked = await newPatientId(request);
  await doctorPage.goto(`/doctor/records?id=${neverBooked}`);
  await expect(doctorPage.getByRole("region", { name: "Patient" }).getByText("Never Booked")).toBeVisible();

  // The doctor opens and downloads the E2E patient's record from the dashboard's quick access.
  await doctorPage.goto("/doctor");
  await doctorPage.getByLabel("Patient ID").fill(patientId.toLowerCase());
  await doctorPage.getByRole("button", { name: "Open patient records" }).click();
  await expect(doctorPage).toHaveURL(new RegExp(`/doctor/records\\?id=${patientId}$`));
  await expect(doctorPage.getByText("Esha Patient")).toBeVisible();
  const [download] = await Promise.all([
    doctorPage.waitForEvent("download"),
    doctorPage.getByRole("button", { name: "Download Blood test" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("blood-test.pdf");
  // The doctor's list has no Delete button.
  await expect(doctorPage.getByRole("button", { name: "Delete Blood test" })).toHaveCount(0);
  await doctorContext.close();

  // Patient: the access log shows the doctor's visit and download.
  await page.reload();
  const log = page.getByRole("region", { name: "Who opened your records" });
  await expect(log.getByText("Dr. Eshwar Testdoctor").first()).toBeVisible();
  await expect(log.getByText("Opened a file: Blood test")).toBeVisible();

  // Patient deletes the record.
  page.once("dialog", (d) => d.accept());
  await myRecords.getByRole("button", { name: "Delete Blood test" }).click();
  await expect(myRecords.getByText("No records yet")).toBeVisible();
});

test("files that aren't PDF, JPG or PNG are refused with a clear message", async ({ page }) => {
  await login(page, e2e().patient.email);
  await page.goto("/patient/records");
  await page.getByLabel("File").setInputFiles({ name: "report.pdf", mimeType: "application/pdf", buffer: Buffer.from("MZ not a pdf") });
  await page.getByLabel("Title").fill("Fake report");
  await page.getByRole("button", { name: "Upload record" }).click();
  // (Next.js has its own empty role="alert" route announcer, so match the message text.)
  await expect(page.getByText(/doesn't look like a real PDF/)).toBeVisible();
  await expect(page.getByRole("region", { name: /^My records/ }).getByText("Fake report")).toHaveCount(0);
});
