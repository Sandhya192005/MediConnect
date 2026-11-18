import { expect, test } from "@playwright/test";
import { e2e, login } from "./helpers";

test("a new patient can sign up and lands on their dashboard", async ({ page }) => {
  const email = `e2e.new.${Date.now()}@mediconnect.dev`; // deleted by the next e2e_setup
  await page.goto("/register");
  await page.getByLabel("First name").fill("Nila");
  await page.getByLabel("Last name").fill("Tester");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("Strong@pass1");
  await page.getByLabel("I am a").selectOption("patient");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/patient$/);
  await expect(page.getByRole("heading", { name: "Patient dashboard" })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "My appointments" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
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
});

test("planned features are listed but not clickable yet", async ({ page }) => {
  await login(page, e2e().admin.email);
  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByText("Reports")).toBeVisible();
  await expect(menu.getByRole("link", { name: /Reports/ })).toHaveCount(0);
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
