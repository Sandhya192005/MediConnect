import { expect, test } from "@playwright/test";
import { API, e2e, login, tokenFor } from "./helpers";

// Doctor, nurse and staff pages (owner request 2026-11-22): like Patient management, the list shows each
// person with their department, and "Open" shows all their details, with Edit and Delete there.
test("a nurse's page: details, edit and delete", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, e2e().admin.email);
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Nurse management" }).click();
  await page.getByRole("button", { name: "Add nurse" }).click();
  const form = page.getByRole("region", { name: "Add nurse" });
  await form.getByLabel("Full name").fill("Kavya Staffpage");
  await form.getByLabel("Department").selectOption({ label: "Cardiology" });
  await form.getByLabel(/Specialization/).fill("ICU nursing");
  await form.getByLabel(/Qualification/).fill("B.Sc Nursing");
  await form.getByLabel("Phone").fill("98400 22222");
  await form.getByLabel("Monthly salary (₹)").fill("35000");
  await form.getByRole("button", { name: "Add nurse" }).click();

  // The list: name and department up front, and Open.
  const row = page.getByRole("listitem", { name: "Kavya Staffpage" });
  await expect(row).toContainText("Cardiology");
  await expect(row).toContainText("Working here");
  await expect(row.getByTestId("staff-role")).toHaveText("Nurse"); // the role in front (2026-11-22)
  await expect(row).not.toContainText("98400 22222"); // no contact number or joined date in the list (2026-11-22)
  await expect(row).not.toContainText("joined");
  await expect(row.getByRole("button", { name: /Edit/ })).toHaveCount(0); // edit/delete moved to the person's page
  await row.getByRole("link", { name: "Open Kavya Staffpage" }).click();
  await expect(page).toHaveURL(/\/admin\/nurses\/\d+$/);

  const work = page.getByRole("region", { name: "Work" });
  await expect(work).toContainText(/Department\s*Cardiology/);
  await expect(work).toContainText(/Specialization\s*ICU nursing/);
  await expect(work).toContainText(/Qualification\s*B\.Sc Nursing/);
  const pay = page.getByRole("region", { name: "Contact and salary" });
  await expect(pay).toContainText(/Contact number\s*98400 22222/);
  await expect(pay).toContainText("₹35,000 / month");
  await expect(pay).toContainText(/Yearly salary\s*₹4,20,000/);
  await expect(page.getByRole("region", { name: "Staff member" })).toContainText("Working here");

  // Edit the salary.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Monthly salary (₹)").fill("38000");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(pay).toContainText("₹38,000 / month");

  // Delete goes back to the list.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page).toHaveURL(/\/admin\/nurses$/);
  await expect(page.getByRole("listitem", { name: "Kavya Staffpage" })).toHaveCount(0);
});

test("a doctor with a MediConnect account: profile and appointments on their page", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { doctor, admin } = e2e();
  // Make sure the E2E doctor has a staff record (admin.spec may have added one already in this run).
  const headers = { Authorization: `Bearer ${await tokenFor(request, admin.email)}` };
  const staff = (await (await request.get(`${API}/api/hospital-admin/staff/?kind=doctor`, { headers })).json()) as { doctor: number | null }[];
  if (!staff.some((s) => s.doctor === doctor.id)) {
    const r = await request.post(`${API}/api/hospital-admin/staff/`, { headers, data: {
      kind: "doctor", full_name: "", doctor: doctor.id, join_date: "2026-01-10", monthly_salary: "150000" } });
    expect(r.ok()).toBeTruthy();
  }

  await login(page, admin.email);
  await page.goto("/admin/doctors");
  const row = page.getByRole("listitem", { name: "Eshwar Testdoctor" });
  await expect(row).toContainText("Working here");
  await row.getByRole("link", { name: "Open Eshwar Testdoctor" }).click();
  await expect(page).toHaveURL(/\/admin\/doctors\/staff\/\d+$/);
  const profile = page.getByRole("region", { name: "MediConnect doctor profile" });
  await expect(profile).toContainText(/Qualification\s*MBBS, MD/);
  await expect(profile).toContainText(/Consultation fee\s*₹700/);
  await expect(page.getByRole("region", { name: "Contact and salary" })).toContainText(doctor.email);
  await expect(page.getByRole("tab", { name: /Accepted/ })).toBeVisible();
});
