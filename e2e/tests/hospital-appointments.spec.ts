import { expect, test, type APIRequestContext } from "@playwright/test";
import { API, bookAsPatient, cancelPatientBookings, e2e, login, tomorrow } from "./helpers";

async function token(request: APIRequestContext, email: string) {
  const r = await request.post(`${API}/api/auth/login/`, { data: { email, password: e2e().password } });
  return (await r.json()).access as string;
}

async function setConfirmFirst(request: APIRequestContext, on: boolean) {
  const r = await request.patch(`${API}/api/hospital-admin/booking-settings/`, {
    headers: { Authorization: `Bearer ${await token(request, e2e().admin.email)}` }, data: { confirm_bookings: on },
  });
  expect(r.ok()).toBeTruthy();
}

test("hospital confirms first: a booking waits on the hospital's Appointments page, then reaches the doctor", async ({ page, request }) => {
  await cancelPatientBookings(request);
  await setConfirmFirst(request, true);
  try {
    const confirmId = await bookAsPatient(request, tomorrow(), "Fever");
    const declineId = await bookAsPatient(request, tomorrow(), "Follow-up");
    const doctorHeaders = { Authorization: `Bearer ${await token(request, e2e().doctor.email)}` };
    const doctorSees = async () => ((await (await request.get(`${API}/api/appointments/`, { headers: doctorHeaders })).json()) as { id: number }[]).map((a) => a.id);
    expect(await doctorSees()).not.toContain(confirmId); // not yet

    // The hospital admin finds both under "To confirm".
    await login(page, e2e().admin.email);
    await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Appointments" }).click();
    await expect(page.getByRole("heading", { name: "Appointments" })).toBeVisible();
    await expect(page.getByRole("switch", { name: "Confirm bookings before they reach doctors" })).toHaveAttribute("aria-checked", "true");
    const list = page.getByRole("region", { name: /^To confirm/ });
    const rows = list.getByRole("listitem");
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: "Fever" })).toContainText("Waiting for hospital");

    // Decline needs a reason; then the patient sees it.
    const decline = rows.filter({ hasText: "Follow-up" });
    await decline.getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText(/Tell the patient why/)).toBeVisible();
    await decline.getByLabel(/Reason if declining/).fill("The doctor is in surgery then");
    await decline.getByRole("button", { name: "Decline" }).click();
    await expect(rows).toHaveCount(1);

    // Confirm: now the doctor has it.
    await rows.filter({ hasText: "Fever" }).getByRole("button", { name: "Confirm" }).click();
    await expect(list.getByText("Nothing to confirm")).toBeVisible();
    expect(await doctorSees()).toContain(confirmId);
    expect(await doctorSees()).not.toContain(declineId);

    // The patient's view: confirmed, and the declined one with the hospital's reason.
    const patient = { Authorization: `Bearer ${await token(request, e2e().patient.email)}` };
    const mine = (await (await request.get(`${API}/api/appointments/?when=upcoming`, { headers: patient })).json()) as
      { id: number; status: string; cancel_reason: string }[];
    expect(mine.find((a) => a.id === confirmId)!.status).toBe("confirmed");
    expect(mine.find((a) => a.id === declineId)).toMatchObject({ status: "cancelled", cancel_reason: "The doctor is in surgery then" });
  } finally {
    await setConfirmFirst(request, false); // other tests book straight to the doctor
    await cancelPatientBookings(request);
  }
});
