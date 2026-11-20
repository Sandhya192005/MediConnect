import { expect, test } from "@playwright/test";
import { bookAsPatient, e2e, login } from "./helpers";

test("hospital admin adds a doctor and a nurse, sees the payroll and counts, and opens a patient's records", async ({ page, request }) => {
  await bookAsPatient(request); // makes the E2E patient a patient of the admin's hospital

  await login(page, e2e().admin.email);
  await expect(page.getByRole("heading", { name: "Hospital dashboard" })).toBeVisible();
  await expect(page.getByText("Hospital overview")).toBeVisible();
  await expect(page.getByText(/^Good (morning|afternoon|evening), E2E Partner Hospital!/)).toBeVisible(); // the hospital is the account
  const menu = page.getByRole("navigation", { name: "Main menu" });
  // Hospital admins don't get the platform pages (hospital approvals, requests to other hospitals).
  await expect(menu.getByRole("link", { name: "Hospital approvals" })).toHaveCount(0);

  // Doctors: link the doctor's MediConnect account; the name comes from the account.
  await menu.getByRole("link", { name: "Doctor management" }).click();
  await page.getByRole("button", { name: "Add doctor" }).click();
  const form = page.getByRole("region", { name: "Add doctor" });
  await form.getByLabel("MediConnect account").selectOption({ label: `Eshwar Testdoctor (${e2e().doctor.email})` });
  await expect(form.getByLabel("Full name")).toHaveValue("Eshwar Testdoctor");
  await form.getByLabel("Designation").fill("Senior Consultant");
  await form.getByLabel("Monthly salary (₹)").fill("150000");
  await form.getByRole("button", { name: "Add doctor" }).click();
  const doctors = page.getByRole("region", { name: /^Doctors/ });
  await expect(doctors.getByText("Eshwar Testdoctor")).toBeVisible();
  await expect(doctors.getByText("MediConnect account")).toBeVisible();
  await expect(doctors.getByText("₹1,50,000")).toBeVisible();

  // Nurses: staff records without a login.
  await menu.getByRole("link", { name: "Nurse management" }).click();
  await page.getByRole("button", { name: "Add nurse" }).click();
  const nurseForm = page.getByRole("region", { name: "Add nurse" });
  await nurseForm.getByLabel("Full name").fill("Meena S");
  await nurseForm.getByLabel("Monthly salary (₹)").fill("32000");
  await nurseForm.getByRole("button", { name: "Add nurse" }).click();
  await expect(page.getByRole("region", { name: /^Nurses/ }).getByText("Meena S")).toBeVisible();

  // Other staff: a pharmacist, and "Other" needs a job title.
  await menu.getByRole("link", { name: "Staff management" }).click();
  await page.getByRole("button", { name: "Add staff member" }).click();
  const staffForm = page.getByRole("region", { name: "Add staff member" });
  await staffForm.getByLabel("Role").selectOption("pharmacist");
  await staffForm.getByLabel("Full name").fill("Ravi P");
  await staffForm.getByLabel("Monthly salary (₹)").fill("25000");
  await staffForm.getByRole("button", { name: "Add staff member" }).click();
  const others = page.getByRole("region", { name: /^Other staff/ });
  await expect(others.getByText("Ravi P")).toBeVisible();
  await expect(others).toContainText("Pharmacist");
  await page.getByLabel("Role", { exact: true }).selectOption("receptionist"); // the list's role filter
  await expect(others.getByText("No other staff match")).toBeVisible();
  await page.getByLabel("Role", { exact: true }).selectOption("");

  // Staff & salary: the payroll adds up (doctor + nurse + pharmacist).
  await menu.getByRole("link", { name: "Staff & salary" }).click();
  await expect(page.getByText("₹2,07,000").first()).toBeVisible();
  await expect(page.getByText("₹25,000").first()).toBeVisible();
  // Payroll per month: this month's row has everyone (the newest month is listed first).
  const perMonth = page.getByRole("region", { name: "Payroll per month" });
  await expect(perMonth.getByRole("img", { name: /Total payroll per month, last 6 months/ })).toBeVisible();
  // .last(): the chart also has a hidden data table for screen readers, before the visible one.
  await expect(perMonth.locator("table").last().getByRole("row").nth(1)).toContainText("₹2,07,000");

  // Dashboard: real counts and the staff chart.
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("region", { name: "Staff summary" }).getByRole("img", { name: /Doctors and nurses on staff/ })).toBeVisible();

  // Reports (2026-11-20): the hospital's own numbers, with its doctor in the per-doctor table.
  await menu.getByRole("link", { name: "Reports" }).click();
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /Appointments and completed visits per month, last 12 months/ })).toBeVisible();
  await expect(page.getByRole("table", { name: /Appointments per doctor/ }).getByText(e2e().doctor.name)).toBeVisible(); // "Dr. Eshwar Testdoctor"
  await page.getByRole("button", { name: "6 months" }).click();
  await expect(page.getByRole("img", { name: /New and returning patients per month, last 6 months/ })).toBeVisible();

  // Patients: the booked patient is listed; their records open (and the view is logged for them).
  await menu.getByRole("link", { name: "Patient management" }).click();
  await page.getByRole("link", { name: "Records of Esha Patient" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/patients/records\\?id=${e2e().patient.patient_id}$`));
  await expect(page.getByRole("region", { name: "Patient" }).getByText("Esha Patient")).toBeVisible();
});
