import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { API, e2e, login, patientToken, tokenFor, tomorrow } from "./helpers";

// Doctors a hospital adds in Doctor management without a MediConnect account (owner request 2026-11-26):
// patients find them ("not bookable online") and send a request; the hospital confirms a time with that
// doctor or another one of the same department, or declines with a reason.

async function addDoctor(request: APIRequestContext, name: string) {
  const res = await request.post(`${API}/api/hospital-admin/staff/`, {
    headers: { Authorization: `Bearer ${await tokenFor(request, e2e().admin.email)}` },
    data: { kind: "doctor", full_name: name, specialization: "Neurology", qualification: "MBBS MD",
            join_date: "2024-01-01", monthly_salary: 50000 },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as number;
}

async function hospitalPage(browser: Browser) {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000", viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await login(page, e2e().admin.email);
  await page.goto("/admin/appointments");
  return page;
}

test("patient requests a hospital-added doctor; the hospital gives the visit to another neurologist", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString().slice(-5);
  const shiva = `Shiva Listed${run}`, ravi = `Ravi Listed${run}`;
  await addDoctor(request, shiva);
  await addDoctor(request, ravi);
  const hospital = e2e().partner_hospital;

  // The patient finds him by specialty, clearly labelled.
  await login(page, e2e().patient.email);
  await page.goto("/doctors?q=neurology");
  const card = page.getByRole("article", { name: hospital.name });
  await expect(card.getByTestId("listed-doctor").filter({ hasText: shiva })).toContainText("not bookable online");

  // ...and sends a request from the hospital's page.
  await page.goto(`/hospitals/${hospital.id}`);
  const section = page.getByRole("region", { name: "Doctors listed by the hospital" });
  await section.getByTestId("listed-doctor").filter({ hasText: shiva }).getByRole("button", { name: "Request appointment" }).click();
  await section.getByLabel("Reason").fill("Headaches (e2e)");
  await section.getByRole("button", { name: "Send request" }).click();
  await expect(section).toContainText("Request sent");

  // The hospital gives it to the other neurologist at 11:30.
  const hp = await hospitalPage(browser);
  const box = hp.getByRole("region", { name: "Appointment requests" });
  const req = box.getByRole("listitem").filter({ hasText: shiva });
  await req.getByLabel(/^Doctor for/).selectOption({ label: `Dr. ${ravi}` });
  await req.getByLabel(/^Time for/).fill("11:30");
  await req.getByRole("button", { name: "Confirm" }).click();
  await expect(box.getByRole("listitem").filter({ hasText: shiva })).toHaveCount(0);
  await hp.context().close();

  // The patient sees the confirmed visit, and why it's another doctor.
  await page.goto("/patient/appointments");
  await expect(page.getByText(`Dr. ${ravi} (Neurology)`)).toBeVisible();
  await expect(page.getByText(`You asked for Dr. ${shiva}`)).toBeVisible();
});

test("the hospital declines a request with a reason the patient reads", async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  const name = `Meena Listed${Date.now().toString().slice(-5)}`;
  const doctor = await addDoctor(request, name);
  const sent = await request.post(`${API}/api/appointment-requests/`, {
    headers: { Authorization: `Bearer ${await patientToken(request)}` },
    data: { hospital: e2e().partner_hospital.id, staff_doctor: doctor, preferred_date: tomorrow(), preferred_time: "Morning" },
  });
  expect(sent.ok()).toBeTruthy();

  const hp = await hospitalPage(browser);
  const req = hp.getByRole("region", { name: "Appointment requests" }).getByRole("listitem").filter({ hasText: name });
  const decline = req.getByRole("button", { name: "Decline" });
  await expect(decline).toBeDisabled(); // a reason is required
  await req.getByLabel(/^Reason if declining/).fill("No neurologist is available that week");
  await decline.click();
  await expect(req).toHaveCount(0);
  await hp.context().close();

  await login(page, e2e().patient.email);
  await page.goto("/patient/appointments");
  await expect(page.getByText("Reason: No neurologist is available that week").first()).toBeVisible();
});
