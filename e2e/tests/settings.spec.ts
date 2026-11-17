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

test("profile, health details and change password", async ({ page, request }) => {
  const email = await newPatient(request);
  await loginByForm(page, email, START);
  await expect(page).toHaveURL(/\/patient$/);

  // The avatar menu opens Profile & settings.
  await page.getByRole("button", { name: /^Account menu/ }).click();
  await page.getByRole("menuitem", { name: "Profile & settings" }).click();
  await expect(page.getByRole("heading", { name: "Profile & settings" })).toBeVisible();

  const profile = page.getByRole("region", { name: "Your profile" });
  await profile.getByLabel("First name").fill("Nilaa");
  await profile.getByRole("button", { name: "Save profile" }).click();
  await expect(profile.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByRole("button", { name: "Account menu for Nilaa Tester" })).toBeVisible(); // top bar updated

  const health = page.getByRole("region", { name: "Health details" });
  await health.getByLabel("Date of birth").fill("1996-05-20");
  await health.getByLabel("Gender").selectOption("female");
  await health.getByRole("button", { name: "Save health details" }).click();
  await expect(health.getByRole("status")).toHaveText("Saved.");
  await expect(health).toContainText("Age ");

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
});
