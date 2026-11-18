import { expect, test } from "@playwright/test";
import { bookAsPatient, e2e, login } from "./helpers";

test("hospital admin adds a doctor and a nurse, sees the payroll and counts, and opens a patient's records", async ({ page, request }) => {
  await bookAsPatient(request); // makes the E2E patient a patient of the admin's hospital

  await login(page, e2e().admin.email);
  await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
  await expect(page.getByText("Hospital overview")).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Main menu" });
  // Hospital admins don't get the platform pages (hospital approvals, requests to other hospitals).
  await expect(menu.getByRole("link", { name: "Hospital approvals" })).toHaveCount(0);

  // Doctors: link the doctor's MediConnect account; the name comes from the account.
  await menu.getByRole("link", { name: "Doctors" }).click();
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
  await menu.getByRole("link", { name: "Nurses" }).click();
  await page.getByRole("button", { name: "Add nurse" }).click();
  const nurseForm = page.getByRole("region", { name: "Add nurse" });
  await nurseForm.getByLabel("Full name").fill("Meena S");
  await nurseForm.getByLabel("Monthly salary (₹)").fill("32000");
  await nurseForm.getByRole("button", { name: "Add nurse" }).click();
  await expect(page.getByRole("region", { name: /^Nurses/ }).getByText("Meena S")).toBeVisible();

  // Other staff: a pharmacist, and "Other" needs a job title.
  await menu.getByRole("link", { name: "Other staff" }).click();
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

  // Dashboard: real counts and the staff chart.
  await menu.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("region", { name: "Staff summary" }).getByRole("img", { name: /Doctors and nurses on staff/ })).toBeVisible();

  // Patients: the booked patient is listed; their records open (and the view is logged for them).
  await menu.getByRole("link", { name: "Patients" }).click();
  await page.getByRole("link", { name: "Records of Esha Patient" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/patients/records\\?id=${e2e().patient.patient_id}$`));
  await expect(page.getByRole("region", { name: "Patient" }).getByText("Esha Patient")).toBeVisible();
});
