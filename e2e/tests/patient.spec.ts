import { expect, test } from "@playwright/test";
import { API, e2e } from "./helpers";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PASSWORD = "Start-pass-71!";

test("patient dashboard: Book appointment menu, report download and the nearest hospital", async ({ browser, request }) => {
  // A fresh patient with one report (deleted by the next e2e_setup).
  const email = `e2e.new.dash.${Date.now()}@mediconnect.dev`;
  expect((await request.post(`${API}/api/auth/register/`, { data: { email, password: PASSWORD, first_name: "Dash", last_name: "Tester" } })).status()).toBe(201);
  const token = (await (await request.post(`${API}/api/auth/login/`, { data: { email, password: PASSWORD } })).json()).access;
  const up = await request.post(`${API}/api/records/`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { title: "Blood test", record_type: "lab_report", file: { name: "blood-test.pdf", mimeType: "application/pdf", buffer: PDF } },
  });
  expect(up.status()).toBe(201);

  // The browser is standing at the E2E partner hospital.
  const { lat, lng } = e2e().location;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, geolocation: { latitude: lat, longitude: lng }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/patient$/);

  const menu = page.getByRole("navigation", { name: "Main menu" });
  await expect(menu.getByRole("link", { name: "Book appointment" })).toHaveAttribute("href", "/doctors");

  // Recent medical reports: Download right from the dashboard.
  const reports = page.getByRole("region", { name: "Recent medical reports" });
  const [download] = await Promise.all([page.waitForEvent("download"), reports.getByRole("button", { name: "Download Blood test" }).click()]);
  expect(download.suggestedFilename()).toBe("blood-test.pdf");

  // Nearby hospitals: only after the patient asks, then the nearest one with distance and area.
  await page.getByRole("button", { name: "Use my location" }).click();
  const nearest = page.getByRole("link", { name: /Nearest to you/ });
  await expect(nearest).toContainText(e2e().partner_hospital.name);
  await expect(nearest).toContainText(/0\.0 km · .*Chennai/);
  await expect(nearest).toHaveAttribute("href", `/hospitals/${e2e().partner_hospital.id}`);
  await ctx.close();
});
