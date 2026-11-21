import { expect, test, type APIRequestContext } from "@playwright/test";
import { API, bookAsPatient, cancelPatientBookings, e2e, login, today } from "./helpers";

// Reference design, Part 3: treatment notes. The visit's doctor writes them from the queue; the patient
// and any doctor or admin who opens the records read them (owner decision 2026-11-19).
async function tokenFor(request: APIRequestContext, email: string) {
  const r = await request.post(`${API}/api/auth/login/`, { data: { email, password: e2e().password } });
  return { Authorization: `Bearer ${(await r.json()).access}` };
}

test("the doctor writes a treatment note during the visit; the patient and the hospital admin read it", async ({ page, browser, request }) => {
  await cancelPatientBookings(request);
  const id = await bookAsPatient(request, today(), "Fever for two days"); // needs a free slot later today
  const doctor = await tokenFor(request, e2e().doctor.email);
  expect((await request.post(`${API}/api/appointments/${id}/check-in/`, { headers: doctor })).ok()).toBeTruthy();
  expect((await request.post(`${API}/api/appointments/${id}/call-in/`, { headers: doctor })).ok()).toBeTruthy();

  try {
    // The doctor: Patient details next to the treatment note form on the queue page.
    await login(page, e2e().doctor.email);
    await page.goto("/doctor/queue");
    const details = page.getByRole("region", { name: "Patient details" });
    await expect(details).toContainText("Esha Patient");
    await expect(details).toContainText(e2e().patient.patient_id);
    await expect(details.getByRole("region", { name: "Health details" })).toBeVisible();

    const form = page.getByRole("form", { name: "Treatment note" });
    await form.getByLabel("Diagnosis").fill("Viral fever");
    await form.getByLabel("Medicine 1 name").fill("Paracetamol 500 mg");
    await form.getByLabel("Medicine 1 dose").fill("1 tablet");
    await form.getByLabel("Medicine 1 how often").fill("3 times a day");
    await form.getByLabel("Medicine 1 days").fill("5");
    await form.getByLabel("Advice").fill("Rest and plenty of fluids.");
    await form.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Note saved. The patient can see it now.")).toBeVisible();
    await expect(details).toContainText("Viral fever"); // earlier visit notes, refreshed

    // The patient: under My medical records.
    const patientCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const patient = await patientCtx.newPage();
    await login(patient, e2e().patient.email);
    await patient.goto("/patient/records");
    const notes = patient.getByRole("region", { name: /^Visit notes/ });
    await expect(notes).toContainText("Viral fever");
    await expect(notes).toContainText("Paracetamol 500 mg · 1 tablet · 3 times a day · 5 days");
    await expect(notes).toContainText("Rest and plenty of fluids.");
    await patientCtx.close();

    // The hospital admin: on the patient's records, opened by patient ID.
    const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const admin = await adminCtx.newPage();
    await login(admin, e2e().admin.email);
    await admin.goto(`/admin/patients/records?id=${e2e().patient.patient_id}`);
    await expect(admin.getByRole("region", { name: /^Visit notes/ })).toContainText("Viral fever");
    await adminCtx.close();
  } finally {
    await request.post(`${API}/api/appointments/${id}/complete/`, { headers: doctor }); // free the consultation room
    await cancelPatientBookings(request);
  }
});