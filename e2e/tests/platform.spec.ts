import { expect, test } from "@playwright/test";
import { API, e2e, login } from "./helpers";

test("platform admin sees platform totals, usage charts and hospital growth", async ({ page }) => {
  await login(page, e2e().platform.email);
  await expect(page.getByText("Platform overview")).toBeVisible();
  await expect(page.getByText(/^Good (morning|afternoon|evening), Priya!/)).toBeVisible(); // same greeting for every role

  // Totals for the whole platform, with the growth line under each.
  for (const label of ["Patient accounts", "Doctor accounts", "Connected hospitals", "Hospital accounts", "Appointments this month"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Platform usage" }).getByRole("img", { name: /Active patients and doctors/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent activity" })).toBeVisible();

  // Reports & analytics: usage and hospital growth, with the connected hospitals table.
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Reports & analytics" }).click();
  await expect(page.getByRole("heading", { name: "Reports & analytics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Platform usage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Hospital growth" })).toBeVisible();
  await expect(page.getByRole("img", { name: /Connected hospitals at the end of each month, last 12 months/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /Connected hospitals and hospital accounts/ })).toBeVisible();
  const table = page.getByRole("region", { name: /^Connected hospitals \(/ });
  const partnerRow = table.getByRole("row", { name: /E2E Partner Hospital/ });
  await expect(partnerRow).toBeVisible();
  await expect(partnerRow.getByText("Yes")).toBeVisible(); // it has a hospital login (e2e.admin)

  // Changing the period reloads the charts for that range.
  await page.getByRole("button", { name: "24 months" }).click();
  await expect(page.getByRole("img", { name: /Connected hospitals at the end of each month, last 24 months/ })).toBeVisible();
});

test("hospital admins don't get the platform reports", async ({ page }) => {
  await login(page, e2e().admin.email);
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Reports & analytics" })).toHaveCount(0);
  await page.goto("/admin/reports");
  // A hospital account (role "hospital" since 2026-11-19) is sent back to its own dashboard.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Hospital dashboard" })).toBeVisible();
});

test("a signed-up hospital asks to connect; the platform admin declines, then approves", async ({ page, browser, request }) => {
  const stamp = Date.now();
  const name = `E2E Signup Hospital ${stamp}`; // removed by e2e_setup / e2e_cleanup
  const email = `e2e.new.hospital.${stamp}@mediconnect.dev`;
  const password = "Strong@pass1";
  expect((await request.post(`${API}/api/auth/register-hospital/`, {
    data: { first_name: "Lalitha", email, password, hospital_name: name, hospital_city: "Chennai" },
  })).status()).toBe(201);

  // The hospital asks to connect from its dashboard.
  const hospitalCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const hospital = await hospitalCtx.newPage();
  await hospital.goto("/login");
  await hospital.getByRole("tab", { name: "Hospital" }).click();
  await hospital.getByLabel("Email").fill(email);
  await hospital.getByLabel("Password", { exact: true }).fill(password);
  await hospital.getByRole("button", { name: "Log in" }).click();
  const box = hospital.getByRole("region", { name: "Connection" });
  await box.getByRole("button", { name: "Request connection" }).click();
  await box.getByLabel("Hospital address").fill("Lake Road, Anna Nagar");
  await box.getByLabel("Hospital phone").fill("044 1234 5678");
  await box.getByLabel(/Message to MediConnect/).fill("We have 3 doctors");
  await box.getByRole("button", { name: "Send request" }).click();
  await expect(box).toContainText("Waiting for MediConnect to connect your hospital");

  // The platform admin declines with a reason...
  await login(page, e2e().platform.email);
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Connection requests" }).click();
  const card = page.getByRole("listitem", { name });
  await expect(card).toContainText("We have 3 doctors");
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByText(/Tell the hospital why/)).toBeVisible(); // (not getByRole("alert"): Next.js has an empty one too)
  await card.getByLabel(`Note to ${name}`).fill("Please add the full street address.");
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(card).toHaveCount(0); // gone from "Waiting"

  // ...the hospital sees why and asks again...
  await hospital.reload();
  await expect(box).toContainText("Please add the full street address.");
  await box.getByRole("button", { name: "Ask again" }).click();
  await box.getByLabel("Hospital address").fill("Lake Road, Anna Nagar, Chennai");
  await box.getByRole("button", { name: "Send request" }).click();
  await expect(box).toContainText("Waiting for MediConnect");

  // ...and is approved: patients can now see it, and the banner is gone.
  await page.reload();
  await page.getByRole("listitem", { name }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("listitem", { name })).toHaveCount(0);
  const listed = await (await request.get(`${API}/api/hospitals/`)).json();
  expect(listed.map((h: { name: string }) => h.name)).toContain(name);
  await hospital.reload();
  await expect(hospital.getByText("Hospital overview")).toBeVisible();
  await expect(box).toHaveCount(0);
  await hospitalCtx.close();
});