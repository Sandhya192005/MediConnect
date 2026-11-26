"""
One chatbot, four kinds of user (owner request 2026-11-26): it answers according to who is logged in.

For each role this module decides:
  - what the assistant is for (its instructions),
  - a short "how do I...?" guide to that role's own pages (real menu names),
  - which tools it may call. The chat loop only OFFERS these tools to the model, and `run_tool` refuses any
    other, so a doctor's chat can never reach, say, a hospital's numbers.

Every tool is READ-ONLY (owner decision 2026-11-26). The only exception in spirit is the patient's
`propose_booking`, which still books nothing: it shows a card the patient must press Confirm on.
"""

from apps.accounts.permissions import admin_hospital, is_platform_admin

PATIENT, DOCTOR, HOSPITAL, PLATFORM = "patient", "doctor", "hospital", "platform_admin"

TOOLS = {
    PATIENT: ["search_doctors", "get_available_slots", "find_hospitals", "my_appointments", "propose_booking",
              "my_requests", "my_payments"],
    DOCTOR: ["my_schedule", "my_appointments", "requests_waiting_for_me", "my_working_hours"],
    HOSPITAL: ["hospital_summary", "hospital_appointments", "hospital_requests_waiting", "hospital_doctors",
               "hospital_payments"],
    PLATFORM: [],   # phase 3
}

PURPOSE = {
    PATIENT: "You help a PATIENT find doctors and hospitals, book appointments, and follow their own appointments, "
             "appointment requests and payment slips.",
    DOCTOR: "You help a DOCTOR with their own work on MediConnect: today's schedule and queue, upcoming visits, "
            "booking requests waiting for their answer, and their working hours.",
    HOSPITAL: "You help a HOSPITAL account use MediConnect to run the hospital: its numbers (today's appointments, "
              "what is waiting to be assigned or answered, doctors on duty, staff and patient counts, payments) and "
              "how to do things on its pages. You only ever see this one hospital's data.",
    PLATFORM: "You help the MediConnect PLATFORM ADMIN: connected hospitals, connection requests, appointment "
              "requests for website hospitals, support messages and platform reports.",
}

GUIDE = {
    PATIENT: """Sidebar: Dashboard · Book appointment · My appointments · My medical records · My payments · Profile & settings.
- Book: Book appointment → search a specialty, symptom or hospital → pick a doctor → pick a free time → Confirm. Or ask me.
- Doctors marked "Listed by the hospital · not bookable online" have no free slots online: open the hospital's page and press Request appointment; the hospital confirms a time, may offer another doctor of the same department, or declines with a reason.
- Cancel or check in: My appointments.
- Reports, scans, prescriptions: My medical records → upload a PDF, JPG or PNG; Open shows a file without downloading it. Your patient ID is on that page; doctors and hospitals use it to open your records, and every time they do it is listed in Access history.
- Bills from hospitals: My payments (each slip can be opened and printed).
- Health details, password, notifications: Profile & settings.""",
    DOCTOR: """Sidebar: Dashboard · My hospital & profile · Duty schedule · Appointments · Patient queue · Patient records · Profile & settings.
- Working hours (when patients can book you): Duty schedule.
- New booking requests: Appointments → Accept or Reject (a reason is needed to reject).
- Today's patients: Patient queue → Check in, Call in, Done; the patient in consultation shows their details.
- A patient's reports: Patient records → enter the patient ID (the patient can see that you opened them).
- Marking a visit as missed: Appointments → "Didn't come" (after the visit time, up to 7 days).
- Your profile, fee, qualification and hospital: My hospital & profile.""",
    HOSPITAL: """Sidebar: Dashboard · Hospital profile · Doctor management · Nurse management · Staff management · Patient management · Appointments · Staff & salary · Reports · Settings.
- Bookings made through your page wait in Appointments → To assign: accept and choose the doctor, or decline with a reason.
- Requests for doctors you added yourself (no online booking) appear at the top of Appointments: confirm a doctor, date and time (another doctor of the same department is fine), or decline with a reason.
- Add doctors, nurses or other staff: Doctor / Nurse / Staff management → Add. Doctors you add there are shown to patients as "Listed by the hospital · not bookable online".
- Patients: Patient management → Add patient (by patient ID, or a new patient) → open a patient for details, records, visits and payments.
- Bills: Patient management → open a patient → Payments → New payment slip; Mark as paid when they pay.
- Name, address, phone, departments, map pin: Hospital profile.
- Numbers and trends: Dashboard and Reports.""",
    PLATFORM: """Sidebar: Dashboard · Reports & analytics · Connection requests · Connected hospitals · Appointment requests · Support inbox · Django admin.
- Hospitals asking to join: Connection requests → Approve, or Decline with a note.
- Disconnect a hospital: Connected hospitals → Disconnect (a reason is needed).
- Requests for website (non-connected) hospitals: Appointment requests → Confirm or Decline.
- Messages from users: Support inbox → reply (a reply closes the message).
- Platform numbers and growth: Dashboard and Reports & analytics.""",
}

NO_DATA_YET = ("You can't look up this account's own numbers yet. For counts and lists, point the user to the Dashboard "
               "or the page from the guide, and never guess a number.")


def role_of(user) -> str:
    if user.role == "doctor":
        return DOCTOR
    if user.role == "hospital" or admin_hospital(user):
        return HOSPITAL
    if is_platform_admin(user):
        return PLATFORM
    return PATIENT


def tools_for(role: str) -> list[str]:
    return TOOLS.get(role, [])


def role_prompt(role: str) -> str:
    text = f"{PURPOSE[role]}\n\nHow MediConnect works for this user (use it for \"how do I...?\" questions):\n{GUIDE[role]}"
    if not tools_for(role):
        text += f"\n\n{NO_DATA_YET}"
    return text
