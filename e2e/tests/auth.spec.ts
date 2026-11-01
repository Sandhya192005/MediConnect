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

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("a wrong password shows an error and stays logged out", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(e2e().patient.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
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
