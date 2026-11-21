import { expect, test } from "@playwright/test";
import { API, e2e, login } from "./helpers";

test("a new patient can sign up and lands on their dashboard", async ({ page }) => {
  const email = `e2e.new.${Date.now()}@mediconnect.dev`; // deleted by the next e2e_setup
  await page.goto("/register");
  await page.getByLabel("First name").fill("Nila");
  await page.getByLabel("Last name").fill("Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Strong@pass1");
  // The eye button shows what was typed.
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
  await page.getByLabel("I am a").selectOption("patient");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/patient$/);
  await expect(page.getByRole("heading", { name: "Patient dashboard" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "My appointments" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("a hospital signs up, gets its own dashboard and stays hidden from patients", async ({ page, request }) => {
  const stamp = Date.now();
  const email = `e2e.new.hospital.${stamp}@mediconnect.dev`; // deleted by the next e2e_setup
  const name = `E2E Signup Hospital ${stamp}`; // its hospital too (and by e2e_cleanup)

  // From the login page's Hospital tab.
  await page.goto("/login");
  await page.getByRole("tab", { name: "Hospital" }).click();
  await page.getByRole("link", { name: "Create a hospital account" }).click();
  await expect(page).toHaveURL(/\/register\?as=hospital$/);
  await expect(page.getByLabel("I am a")).toHaveValue("hospital");

  await page.getByLabel("Hospital name").fill(name);
  await page.getByLabel("City").fill("Chennai");
  // The hospital is the account (2026-11-19): no person's name, it logs in with the hospital's email.
  await expect(page.getByLabel("First name")).toHaveCount(0);
  await page.getByLabel("Hospital email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Strong@pass1");
  await page.getByRole("button", { name: "Create hospital account" }).click();

  // Straight into the hospital dashboard: a private workspace, not connected yet.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByText("Hospital overview")).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`^Good (morning|afternoon|evening), ${name}!`))).toBeVisible(); // named after the hospital
  await expect(page.getByRole("region", { name: "Connection" })).toContainText("Not connected to MediConnect yet");

  // Patients can't see it.
  const listed = await (await request.get(`${API}/api/hospitals/`)).json();
  expect(listed.map((h: { name: string }) => h.name)).not.toContain(name);

  // Next time, it logs in on the Hospital tab.
  await page.getByRole("button", { name: "Log out" }).click();
  await page.goto("/login");
  await page.getByRole("tab", { name: "Hospital" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("Strong@pass1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});

test("a wrong password shows an error and stays logged out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(e2e().patient.email);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
});

test("an account can only log in on its own tab", async ({ page }) => {
  await page.goto("/login");
  for (const tab of ["Doctor", "Hospital", "Admin"]) {
    await page.getByRole("tab", { name: tab }).click();
    await page.getByLabel("Email").fill(e2e().patient.email);
    await page.getByLabel("Password", { exact: true }).fill(e2e().password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.getByText("This is a patient account, not")).toContainText("Choose the Patient tab to log in.");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  }
  // Nothing was stored: reloading still shows the login page, logged out.
  expect(await page.evaluate(() => localStorage.getItem("mc_access") ?? sessionStorage.getItem("mc_access"))).toBeNull();

  await page.getByRole("tab", { name: "Patient" }).click();
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/patient$/);
});

test("hospital and platform admins each log in on their own tab", async ({ page }) => {
  const tryLogin = async (tab: string, email: string) => {
    await page.goto("/login");
    await page.getByRole("tab", { name: tab }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(e2e().password);
    await page.getByRole("button", { name: "Log in" }).click();
  };
  await tryLogin("Admin", e2e().admin.email);
  await expect(page.getByText("This is a hospital account, not an admin account. Choose the Hospital tab")).toBeVisible();
  await tryLogin("Hospital", e2e().platform.email);
  await expect(page.getByText("This is an admin account, not a hospital account. Choose the Admin tab")).toBeVisible();

  await tryLogin("Hospital", e2e().admin.email);
  await expect(page.getByText("Hospital overview")).toBeVisible();
});

test("role pages are protected", async ({ page }) => {
  // Logged out → sent to the login page.
  await page.goto("/patient/appointments");
  await expect(page).toHaveURL(/\/login$/);

  // A patient opening the doctor area is sent back to their own dashboard.
  await login(page, e2e().patient.email);
  await page.goto("/doctor/appointments");
  await expect(page).toHaveURL(/\/patient$/);
});

test("each role gets its own dashboard and menu", async ({ page }) => {
  await login(page, e2e().doctor.email);
  await expect(page).toHaveURL(/\/doctor$/);
  await expect(page.getByRole("heading", { name: "Doctor dashboard" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Today's schedule" })).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Duty schedule" })).toHaveAttribute("href", "/doctor/availability");
  await expect(menu.getByRole("link", { name: "Patient queue" })).toHaveAttribute("href", "/doctor/queue");
  await expect(menu.getByRole("link", { name: "Patient records" })).toHaveAttribute("href", "/doctor/records");
  await expect(page.getByText("Emergency? Call")).toHaveCount(0); // patients only (2026-11-21)
  await expect(page.getByText("MediConnect is your Better Partner")).toBeVisible(); // top bar (2026-11-21)

  // The greeting uses the first name (a last name is often just an initial, e.g. "Jeevitha D").
  await expect(page.getByText(/^Good (morning|afternoon|evening), Dr\. Eshwar!/)).toBeVisible(); // (a wave emoji follows)

  // Today's appointments compared with yesterday (reference design, Part 3).
  await expect(page.getByText(/from yesterday$|^Same as yesterday$/).first()).toBeVisible();

  // Patient records by ID is its own menu item (2026-11-21): no ID box on the dashboard or in the top bar.
  await expect(page.getByLabel("Search patient by ID")).toHaveCount(0);
  await expect(page.getByLabel("Patient ID")).toHaveCount(0);
  await menu.getByRole("link", { name: "Patient records" }).click();
  const search = page.getByLabel("Patient ID");
  await search.fill(e2e().patient.patient_id.toLowerCase());
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/doctor/records\\?id=${e2e().patient.patient_id}$`));
  await expect(page.getByRole("region", { name: "Patient" })).toContainText("Esha Patient");
});

test("the hospital menu has no planned (Soon) items left: Reports is a real page", async ({ page }) => {
  await login(page, e2e().admin.email);
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Reports" })).toHaveAttribute("href", "/admin/reports"); // was "Soon" until 2026-11-20
  await expect(menu.getByText("Soon")).toHaveCount(0);
});

test("unticking Remember me keeps the login only for this browser session", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(e2e().patient.email);
  await page.getByLabel("Password", { exact: true }).fill(e2e().password);
  await page.getByLabel("Remember me").uncheck();
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  const stored = await page.evaluate(() => ({ local: localStorage.getItem("mc_refresh"), session: sessionStorage.getItem("mc_refresh") }));
  expect(stored.local).toBeNull();
  expect(stored.session).not.toBeNull();
});
