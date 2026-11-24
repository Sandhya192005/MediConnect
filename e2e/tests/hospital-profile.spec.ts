import { expect, test } from "@playwright/test";
import { API } from "./helpers";

test("a hospital edits its profile, departments and map pin", async ({ page, request }) => {
  const stamp = Date.now();
  const name = `E2E Signup Hospital ${stamp}`; // removed by e2e_setup / e2e_cleanup (also after the rename: same prefix)
  const email = `e2e.new.hospital.${stamp}@mediconnect.dev`;
  const password = "Strong@pass1";
  expect((await request.post(`${API}/api/auth/register-hospital/`, {
    data: { email, password, hospital_name: name, hospital_city: "Chennai" },
  })).status()).toBe(201);

  await page.goto("/login");
  await page.getByRole("tab", { name: "Hospital" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();

  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Hospital profile" }).click();
  await expect(page.getByRole("heading", { name: "Hospital profile" })).toBeVisible();
  // It opens as a read-only profile (owner request 2026-11-24); Edit profile opens the form.
  const card = page.getByRole("region", { name: "Hospital", exact: true });
  await expect(card).toContainText(name);
  await expect(card).toContainText("Not connected yet");
  await expect(page.getByRole("region", { name: "Contact" })).toContainText(email);
  await expect(page.getByLabel("Hospital name")).toHaveCount(0);
  await card.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("heading", { name: "Edit hospital profile" })).toBeVisible();
  await expect(page.getByLabel("Hospital name")).toHaveValue(name);
  await expect(page.getByText(`${email} · to change it, contact support.`)).toBeVisible(); // the login email, read-only

  const renamed = `${name} Care`;
  await page.getByLabel("Hospital name").fill(renamed);
  await page.getByLabel("Address").fill("12 Test Street, Guindy");
  await page.getByLabel("Phone").fill("044 1234 5678");
  // Suggestions while typing (2026-11-24): a misspelt doctor-style word still finds the department.
  await page.getByLabel("Add a department").fill("kardiologist");
  await page.getByRole("listbox", { name: "Department suggestions" })
    .getByRole("option", { name: "Cardiology" }).click(); // e2e_setup creates this department
  await expect(page.getByLabel("Add a department")).toHaveValue("");
  await expect(page.getByRole("checkbox", { name: "Cardiology" })).toBeChecked();
  // A department that isn't listed can be written (2026-11-24); a listed one typed in any case is just ticked.
  const dept = `E2E Dept ${stamp}`;
  await page.getByLabel("Add a department").fill(dept);
  await page.getByRole("button", { name: "+ Add" }).click();
  await expect(page.getByRole("button", { name: `Remove ${dept}` })).toBeVisible();

  // The pin: click the map.
  await expect(page.getByText("No pin yet")).toBeVisible();
  await page.getByRole("region", { name: /click to place your hospital's pin/ }).click({ position: { x: 200, y: 150 } });
  await expect(page.getByText(/^Pin: \d+\.\d+, \d+\.\d+$/)).toBeVisible();

  await page.getByRole("button", { name: "Save changes" }).click();
  // Back on the profile view with the new details.
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(card).toContainText(renamed);
  await expect(card).toContainText("12 Test Street, Guindy, Chennai");
  await expect(page.getByRole("region", { name: "Contact" })).toContainText("044 1234 5678");
  await expect(page.getByRole("region", { name: "Departments" })).toContainText("Cardiology");
  await expect(page.getByRole("region", { name: "Departments" })).toContainText(dept);
  await expect(card).toContainText(/Map pin\s*Set/);
  await expect(page.getByRole("region", { name: "Location" }).getByRole("link", { name: /Get directions/ })).toBeVisible();

  // Saved for real: a reload shows the new details.
  await page.reload();
  await expect(card).toContainText(renamed);
  await expect(page.getByRole("region", { name: "Departments" })).toContainText("Cardiology");

  // The × (2026-11-24): deletes a department the hospital wrote; removes a listed one from the hospital only.
  await card.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByRole("button", { name: "Delete department Cardiology" })).toHaveCount(0); // not written here
  await expect(page.getByRole("button", { name: "Remove department Dermatology" })).toHaveCount(0); // not ticked
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: `Delete department ${dept}` }).click();
  await expect(page.getByRole("status")).toHaveText(`Deleted "${dept}".`);
  await expect(page.getByRole("checkbox", { name: dept })).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Remove department Cardiology" }).click();
  await expect(page.getByRole("status")).toHaveText(`Removed "Cardiology" from your hospital.`);
  await expect(page.getByRole("checkbox", { name: "Cardiology" })).not.toBeChecked(); // still in the list
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("region", { name: "Departments" })).toContainText("No departments chosen yet");

  // The account is named after the hospital, so the dashboard greets the new name.
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText(new RegExp(`^Good (morning|afternoon|evening), ${renamed}!`))).toBeVisible();
});
