import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { API, e2e, login } from "./helpers";

const MAILPIT = "http://localhost:8025";
const START = "Start-pass-71!";

/** A fresh patient for password tests, so the shared E2E accounts keep their password. Deleted by the next e2e_setup. */
async function newPatient(request: APIRequestContext) {
  const email = `e2e.new.settings.${Date.now()}@mediconnect.dev`;
  const r = await request.post(`${API}/api/auth/register/`, { data: { email, password: START, first_name: "Nila", last_name: "Tester" } });
  expect(r.status()).toBe(201);
  return email;
}

async function loginByForm(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/** Opens Edit profile from the profile view and returns the edit form. */
async function openEdit(page: Page) {
  await page.getByRole("button", { name: "Edit profile" }).click();
  return page.getByRole("region", { name: "Edit profile" });
}

test("profile view, edit and change password", async ({ page, request }) => {
  const email = await newPatient(request);
  await loginByForm(page, email, START);
  await expect(page).toHaveURL(/\/patient$/);

  // The avatar menu opens Profile & settings: a read-only profile first.
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Profile & settings" }).click();
  await expect(page.getByRole("heading", { name: "Profile & settings" })).toBeVisible();
  const personal = page.getByRole("region", { name: "Personal information" });
  await expect(personal).toContainText(email);
  await expect(personal).toContainText(/Date of birth\s*Not added/);

  // Edit → change name and date of birth → Save → back to the profile with the new values.
  const edit = await openEdit(page);
  const who = edit.getByRole("group", { name: "Personal information" });
  await who.getByLabel("First name").fill("Nilaa");
  await edit.getByLabel("Date of birth").fill("1996-05-20");
  await edit.getByLabel("Gender").selectOption("female");
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Profile saved.");
  await expect(edit).toHaveCount(0);
  await expect(personal).toContainText("Nilaa Tester");
  await expect(personal).toContainText("(30 years)");
  await expect(personal).toContainText("Female");
  await expect(page.getByRole("button", { name: "Account menu for Nilaa Tester" })).toBeVisible(); // top bar updated

  // Cancel throws away changes.
  const again = await openEdit(page);
  await again.getByRole("group", { name: "Personal information" }).getByLabel("First name").fill("Somebody");
  await again.getByRole("button", { name: "Cancel" }).click();
  await expect(personal).toContainText("Nilaa Tester");

  // Security → Change password.
  await page.getByRole("button", { name: "Change password" }).click();
  const pw = page.getByRole("region", { name: "Change password" });
  await pw.getByLabel("Current password").fill("wrong-one");
  await pw.getByLabel("New password", { exact: true }).fill("Brand-new-pass-82");
  await pw.getByLabel("Repeat new password").fill("Brand-new-pass-82");
  await pw.getByRole("button", { name: "Change password" }).click();
  await expect(pw.getByRole("alert")).toContainText("current password isn't right");
  await pw.getByLabel("Current password").fill(START);
  await pw.getByRole("button", { name: "Change password" }).click();
  await expect(pw.getByRole("status")).toHaveText("Your password has been changed.");

  // The new password works.
  await page.getByRole("button", { name: "Log out" }).click();
  await loginByForm(page, email, "Brand-new-pass-82");
  await expect(page).toHaveURL(/\/patient$/);
});

test("a patient fills in health details and a doctor sees them, allergies first", async ({ page, browser, request }) => {
  const email = await newPatient(request);
  await loginByForm(page, email, START);
  await expect(page).toHaveURL(/\/patient$/);
  await page.goto("/settings");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");

  // The patient ID is shown but locked (2026-11-21): on the profile and in the edit form.
  const shownId = (await page.getByTestId("profile-patient-id").textContent())!.trim();
  await expect(page.getByTestId("patient-id-row")).toHaveText(shownId);
  await expect(page.getByRole("region", { name: "Personal information" })).toContainText("Can't be changed");
  const edit = await openEdit(page);
  await expect(edit.getByLabel("Patient ID")).toHaveValue(shownId);
  await expect(edit.getByLabel("Patient ID")).toBeDisabled();
  await edit.getByLabel("Date of birth").fill("1996-05-20");
  await edit.getByLabel("Height (cm)").fill("160");
  await edit.getByLabel("Weight (kg)").fill("64");
  await expect(edit).toContainText("25 · overweight"); // BMI shows while typing
  await edit.getByLabel("Blood group").selectOption("O+");
  const allergies = edit.getByRole("radiogroup", { name: "Do you have any allergies?" });
  await allergies.getByLabel("Yes").check();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(edit.getByRole("alert")).toHaveText("Please write what you're allergic to, or choose No."); // "Yes" needs details
  await edit.getByLabel(/allergic to/).fill("Penicillin");
  await edit.getByRole("radiogroup", { name: "Do you have any long-term conditions?" }).getByLabel("Yes").check();
  await edit.getByLabel("Diabetes").check();
  await edit.getByRole("radiogroup", { name: "Do you take any medicines regularly?" }).getByLabel("No").check();
  await expect(edit.getByLabel(/Which medicines/)).toHaveCount(0); // "No" asks nothing more
  const contact = edit.getByRole("group", { name: "Emergency contact" });
  await contact.getByLabel("Name", { exact: true }).fill("Ravi");
  await contact.getByLabel("Relation").fill("Brother");
  await contact.getByLabel("Phone").fill("98765 43210");
  await edit.getByRole("button", { name: "Save changes" }).click();

  // Back on the clean profile, in order.
  await expect(page.getByRole("status")).toHaveText("Profile saved.");
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "89"); // 8 of 9 answered (no gender)
  await expect(page.getByRole("region", { name: "Body" })).toContainText("25 · overweight");
  const medical = page.getByRole("region", { name: "Medical" });
  await expect(medical).toContainText(/Allergies\s*Penicillin/);
  await expect(medical).toContainText(/Current medicines\s*None/);
  await expect(page.getByRole("region", { name: "Emergency contact" })).toContainText("Brother");

  const patientId = (await page.getByTestId("profile-patient-id").textContent())!.trim();
  const doctorContext = await browser.newContext();
  const doctorPage = await doctorContext.newPage();
  await login(doctorPage, e2e().doctor.email);
  await doctorPage.goto(`/doctor/records?id=${patientId}`);
  await expect(doctorPage.getByRole("region", { name: "Patient" })).toContainText("30 years");
  const summary = doctorPage.getByRole("region", { name: "Health details" });
  await expect(summary.getByText("Allergies: Penicillin")).toBeVisible();
  await expect(summary).toContainText("O+");
  await expect(summary).toContainText("Diabetes");
  await expect(summary).toContainText("Ravi (Brother) 98765 43210");
  await expect(summary).toContainText(/Current medicines\s*None/i);

  // The patient changes allergies to "No": the doctor sees "No known allergies".
  const edit2 = await openEdit(page);
  const allergies2 = edit2.getByRole("radiogroup", { name: "Do you have any allergies?" });
  await expect(allergies2.getByLabel("Yes")).toBeChecked(); // the form opens with the saved answers
  await allergies2.getByLabel("No").check();
  await edit2.getByRole("button", { name: "Save changes" }).click();
  await expect(medical).toContainText(/Allergies\s*No known allergies/);
  await doctorPage.reload();
  await expect(summary.getByText("Allergies: No known allergies")).toBeVisible();
  await doctorContext.close();
});

test("forgot password: the emailed link sets a new password", async ({ page, request }) => {
  const email = await newPatient(request);
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If an account exists");

  // Read the reset email from Mailpit (the local mail catcher).
  let link = "";
  await expect.poll(async () => {
    const search = await (await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    if (!search.messages?.length) return "";
    const msg = await (await request.get(`${MAILPIT}/api/v1/message/${search.messages[0].ID}`)).json();
    link = (msg.Text.match(/http:\/\/localhost:3000\/reset-password\?\S+/) ?? [""])[0];
    return link;
  }, { timeout: 20_000 }).toContain("/reset-password?uid=");

  await page.goto(link);
  await page.getByLabel("New password", { exact: true }).fill("Reset-pass-93!");
  await page.getByLabel("Repeat new password").fill("Reset-pass-93!");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("status")).toContainText("Your password has been reset.");

  await loginByForm(page, email, "Reset-pass-93!");
  await expect(page).toHaveURL(/\/patient$/);

  // The same link doesn't work twice.
  await page.goto(link);
  await page.getByLabel("New password", { exact: true }).fill("Another-pass-94!");
  await page.getByLabel("Repeat new password").fill("Another-pass-94!");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByText(/invalid or has expired/)).toBeVisible(); // (Next.js has its own empty role="alert")
});

test("contact support from the sidebar", async ({ page }) => {
  await login(page, e2e().doctor.email);
  await page.getByRole("link", { name: /Need help\?/ }).click();
  await expect(page.getByRole("heading", { name: "Need help?" })).toBeVisible();
  const subject = `E2E support ${Date.now()}`;
  await page.getByLabel("Topic").selectOption("records");
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Message", { exact: true }).fill("I can't open a patient's X-ray file.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("status")).toContainText("Sent.");
  const mine = page.getByRole("region", { name: "Your messages" });
  await expect(mine.getByText(subject)).toBeVisible();
  await expect(mine.getByText("Open").first()).toBeVisible();

  // Support inbox (2026-11-20): the platform admin sees it in the app, without "Need help?" of their own.
  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, e2e().platform.email);
  await expect(page.getByRole("link", { name: /Need help\?/ })).toHaveCount(0);
  await expect(page.getByText("Emergency? Call")).toHaveCount(0); // not on the platform admin's menu (2026-11-21)
  await expect(page.getByRole("link", { name: /Support inbox .*open message/ })).toBeVisible();
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Support inbox" }).click();
  const msg = page.getByRole("listitem", { name: subject });
  await expect(msg).toContainText("Doctor · Eshwar Testdoctor");
  await expect(msg).toContainText("I can't open a patient's X-ray file.");
  await msg.getByLabel(/Reply to/).fill("Please upload it again as a PDF.");
  await msg.getByRole("button", { name: "Send reply" }).click();
  await expect(msg).toHaveCount(0); // replying closes it: gone from "Open" (2026-11-25)
  await expect(page.getByRole("button", { name: "Answered" })).toHaveCount(0); // tab removed
  await page.getByRole("button", { name: "Closed" }).click();
  await expect(page.getByRole("listitem", { name: subject })).toContainText("Your reply: Please upload it again as a PDF.");

  // The doctor sees the answer on their Need help? page.
  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, e2e().doctor.email);
  await page.goto("/support");
  const yours = page.getByRole("region", { name: "Your messages" });
  await expect(yours).toContainText("Please upload it again as a PDF.");
  await expect(yours.getByText("Replied", { exact: true }).first()).toBeVisible();
});

test("the platform admin closes a support message without replying", async ({ page }) => {
  await login(page, e2e().doctor.email);
  await page.goto("/support");
  const subject = `E2E no reply needed ${Date.now()}`;
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Message", { exact: true }).fill("Thanks, it works now.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("status")).toContainText("Sent.");

  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, e2e().platform.email);
  await page.goto("/admin/support");
  const msg = page.getByRole("listitem", { name: subject });
  await msg.getByRole("button", { name: "Close without reply" }).click();
  await expect(msg).toHaveCount(0); // gone from "Open"
  await page.getByRole("button", { name: "Closed" }).click();
  const closed = page.getByRole("listitem", { name: subject });
  await expect(closed).toContainText("Closed");
  await expect(closed).not.toContainText("Your reply");
  await expect(closed.getByRole("button", { name: "Reopen" })).toBeVisible();

  // The doctor sees it closed on their Need help? page.
  await page.getByRole("button", { name: "Log out" }).click();
  await login(page, e2e().doctor.email);
  await page.goto("/support");
  await expect(page.getByRole("region", { name: "Your messages" }).getByRole("listitem").filter({ hasText: subject })).toContainText("Closed");
});
