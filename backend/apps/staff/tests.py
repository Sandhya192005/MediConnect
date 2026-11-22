"""Hospital admins (Step 4): staff records, patients, records access, overview, and what stays platform-only."""

from datetime import date, timedelta

import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import PatientProfile
from apps.appointments.models import Appointment, AppointmentRequest
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Department, Hospital
from apps.records.models import RecordAccess
from apps.staff.models import HospitalAdmin, StaffMember

User = get_user_model()
PDF = b"%PDF-1.4\n% test\n"


@pytest.fixture(autouse=True)
def private_media(settings, tmp_path):
    settings.PRIVATE_MEDIA_ROOT = str(tmp_path)


def client_for(user=None):
    c = APIClient()
    if user:
        c.force_authenticate(user)
    return c


def make_admin(email, hospital):
    user = User.objects.create_user(email, "pw", role="hospital", first_name="Asha", last_name="Admin")
    HospitalAdmin.objects.create(user=user, hospital=hospital)
    return user


def make_doctor(email, hospital, first="Priya"):
    user = User.objects.create_user(email, "pw", role="doctor", first_name=first, last_name="Raman")
    profile = DoctorProfile.objects.get(user=user)
    profile.hospital = hospital
    profile.save()
    return profile


def book(patient, doctor, status="booked", days=1):
    start = timezone.now() + timedelta(days=days)
    return Appointment.objects.create(patient=patient, doctor=doctor, start=start,
                                      end=start + timedelta(minutes=30), status=status)


@pytest.fixture
def world():
    city = Hospital.objects.create(name="City Hospital", city="Chennai", is_approved=True)
    other = Hospital.objects.create(name="Other Hospital", city="Chennai", is_approved=True)
    cardio = Department.objects.create(name="Cardiology")
    doc = make_doctor("doc@example.com", city)
    patient = User.objects.create_user("asha@example.com", "pw", first_name="Asha", last_name="K")
    book(patient, doc, status="completed", days=-10)
    book(patient, doc, days=3)
    return {
        "city": city, "other": other, "cardio": cardio, "doc": doc, "patient": patient,
        "admin": make_admin("admin@city.example", city),
        "other_admin": make_admin("admin@other.example", other),
    }


def add_staff(client, **data):
    body = {"kind": "nurse", "full_name": "Meena S", "join_date": "2026-01-15", "monthly_salary": "32000", **data}
    return client.post("/api/hospital-admin/staff/", body, format="json")


# ---- Who is a hospital admin ----

@pytest.mark.django_db
def test_me_tells_the_frontend_which_hospital_an_admin_manages(world):
    me = client_for(world["admin"]).get("/api/auth/me/").json()
    assert me["admin_hospital"] == {"id": world["city"].id, "name": "City Hospital"}
    assert me["is_platform_admin"] is False
    boss = client_for(User.objects.create_superuser("boss@example.com", "pw")).get("/api/auth/me/").json()
    assert (boss["is_platform_admin"], boss["admin_hospital"]) == (True, None)


@pytest.mark.django_db
def test_only_hospital_admins_use_the_hospital_admin_api(world):
    lonely_admin = User.objects.create_user("lonely@example.com", "pw", role="hospital")  # no hospital linked
    for user in (world["patient"], world["doc"].user, lonely_admin):
        assert client_for(user).get("/api/hospital-admin/staff/").status_code == 403
        assert client_for(user).get("/api/hospital-admin/overview/").status_code == 403
    assert client_for().get("/api/hospital-admin/staff/").status_code == 401


# ---- Staff records ----

@pytest.mark.django_db
def test_admin_adds_edits_and_lists_nurses(world):
    c = client_for(world["admin"])
    r = add_staff(c, department=world["cardio"].id, designation="Staff Nurse")
    assert r.status_code == 201, r.content
    nurse = r.json()
    assert (nurse["department_name"], nurse["monthly_salary"], nurse["is_active"]) == ("Cardiology", "32000.00", True)
    assert StaffMember.objects.get().hospital == world["city"]  # always the admin's own hospital

    r = c.patch(f"/api/hospital-admin/staff/{nurse['id']}/", {"monthly_salary": "35000"}, format="json")
    assert r.json()["monthly_salary"] == "35000.00"
    assert [s["full_name"] for s in c.get("/api/hospital-admin/staff/?kind=nurse").json()] == ["Meena S"]
    assert c.get("/api/hospital-admin/staff/?kind=doctor").json() == []


@pytest.mark.django_db
def test_admin_adds_other_staff_and_filters_them(world):
    c = client_for(world["admin"])
    add_staff(c)  # a nurse
    r = add_staff(c, kind="pharmacist", full_name="Ravi P", monthly_salary="25000")
    assert r.status_code == 201 and r.json()["kind_label"] == "Pharmacist"
    add_staff(c, kind="lab_technician", full_name="Lakshmi T", monthly_salary="22000")
    add_staff(c, kind="receptionist", full_name="Anu R", monthly_salary="18000")

    names = lambda url: sorted(s["full_name"] for s in c.get(url).json())  # noqa: E731
    assert names("/api/hospital-admin/staff/?kind=other_staff") == ["Anu R", "Lakshmi T", "Ravi P"]  # no nurses
    assert names("/api/hospital-admin/staff/?kind=pharmacist,receptionist") == ["Anu R", "Ravi P"]
    assert names("/api/hospital-admin/staff/?kind=nurse") == ["Meena S"]

    # "Other" needs a job title.
    r = add_staff(c, kind="other", full_name="Kumar")
    assert r.status_code == 400 and "job title" in str(r.json()["designation"])
    assert add_staff(c, kind="other", full_name="Kumar", designation="Ambulance driver").status_code == 201
    assert add_staff(c, kind="astronaut").status_code == 400
    # Only doctors link a doctor account.
    assert "doctor" in add_staff(c, kind="pharmacist", doctor=world["doc"].id).json()

    o = c.get("/api/hospital-admin/overview/").json()
    assert (o["counts"]["nurses"], o["counts"]["other_staff"]) == (1, 4)
    assert float(o["payroll"]["other_staff"]) == 25000 + 22000 + 18000 + 32000  # the driver used the default salary
    assert float(o["payroll"]["monthly_total"]) == 32000 + float(o["payroll"]["other_staff"])
    titles = [a["title"] for a in o["recent_activity"] if a["kind"] == "staff"]
    assert "New ambulance driver added" in titles and "New pharmacist added" in titles
    assert "New lab technician added" in titles and "New nurse added" in titles


@pytest.mark.django_db
def test_a_doctor_record_can_link_the_doctors_account_and_takes_its_name(world):
    c = client_for(world["admin"])
    assert [d["name"] for d in c.get("/api/hospital-admin/doctor-accounts/").json()] == ["Priya Raman"]
    r = add_staff(c, kind="doctor", full_name="", doctor=world["doc"].id, monthly_salary="150000")
    assert r.status_code == 201 and r.json()["full_name"] == "Priya Raman"
    assert c.get("/api/hospital-admin/doctor-accounts/").json() == []  # linked now
    assert add_staff(c, kind="doctor", doctor=world["doc"].id).status_code == 400  # one record per doctor


@pytest.mark.django_db
def test_doctor_links_must_be_doctors_of_the_same_hospital(world):
    c = client_for(world["admin"])
    elsewhere = make_doctor("doc2@example.com", world["other"])
    assert "isn't at your hospital" in str(add_staff(c, kind="doctor", doctor=elsewhere.id).json())
    assert "Only doctors" in str(add_staff(c, kind="nurse", doctor=world["doc"].id).json())


@pytest.mark.django_db
@pytest.mark.parametrize("data,message", [
    ({"monthly_salary": "-1"}, "can't be negative"),
    ({"monthly_salary": "50000000"}, "too large"),
    ({"full_name": "  "}, "Enter the staff member's name"),
    ({"left_on": "2025-12-31"}, "before the joining date"),
])
def test_staff_validation(world, data, message):
    r = add_staff(client_for(world["admin"]), **data)
    assert r.status_code == 400 and message in str(r.json())


@pytest.mark.django_db
def test_the_database_refuses_negative_salaries(world):
    with pytest.raises(IntegrityError), transaction.atomic():
        StaffMember.objects.create(hospital=world["city"], kind="nurse", full_name="X", join_date=date(2026, 1, 1),
                                   monthly_salary=-5)


@pytest.mark.django_db
def test_admins_never_see_another_hospitals_staff(world):
    nurse_id = add_staff(client_for(world["admin"])).json()["id"]
    other = client_for(world["other_admin"])
    assert other.get("/api/hospital-admin/staff/").json() == []
    assert other.get(f"/api/hospital-admin/staff/{nurse_id}/").status_code == 404
    assert other.patch(f"/api/hospital-admin/staff/{nurse_id}/", {"monthly_salary": "1"}, format="json").status_code == 404
    assert other.delete(f"/api/hospital-admin/staff/{nurse_id}/").status_code == 404


@pytest.mark.django_db
def test_staff_who_left_are_filtered_and_not_counted(world):
    c = client_for(world["admin"])
    add_staff(c, full_name="Still Here")
    add_staff(c, full_name="Gone", left_on=(timezone.localdate() - timedelta(days=1)).isoformat())
    assert [s["full_name"] for s in c.get("/api/hospital-admin/staff/?status=active").json()] == ["Still Here"]
    assert [s["full_name"] for s in c.get("/api/hospital-admin/staff/?status=left").json()] == ["Gone"]
    assert c.get("/api/hospital-admin/overview/").json()["counts"]["nurses"] == 1


# ---- Overview ----

@pytest.mark.django_db
def test_overview_counts_payroll_and_chart(world):
    c = client_for(world["admin"])
    today = timezone.localdate()
    add_staff(c, monthly_salary="30000", join_date=(today - timedelta(days=400)).isoformat())
    add_staff(c, full_name="New Nurse", monthly_salary="28000", join_date=today.isoformat())
    add_staff(c, kind="doctor", doctor=world["doc"].id, monthly_salary="150000",
              join_date=(today - timedelta(days=400)).isoformat())

    o = c.get("/api/hospital-admin/overview/").json()
    assert o["hospital"]["name"] == "City Hospital"
    assert (o["counts"]["doctors"], o["counts"]["nurses"], o["counts"]["patients"]) == (1, 2, 1)
    assert o["counts"]["doctor_accounts_without_record"] == 0
    assert float(o["payroll"]["monthly_total"]) == 208000
    assert len(o["staff_chart"]) == 6
    assert o["staff_chart"][-1] == {"month": today.strftime("%b"), "doctors": 1, "nurses": 2}
    assert o["staff_chart"][0]["nurses"] == 1  # the new nurse wasn't there 5 months ago
    assert {a["kind"] for a in o["recent_activity"]} == {"staff", "booking"}


# ---- Patients and their records ----

@pytest.mark.django_db
def test_patient_list_shows_only_this_hospitals_patients(world):
    stranger = User.objects.create_user("stranger@example.com", "pw", first_name="Ravi")
    book(stranger, make_doctor("doc3@example.com", world["other"]))  # a patient of the other hospital
    cancelled_only = User.objects.create_user("gone@example.com", "pw", first_name="Gone")
    book(cancelled_only, world["doc"], status="cancelled")

    rows = client_for(world["admin"]).get("/api/hospital-admin/patients/").json()
    assert [r["name"] for r in rows] == ["Asha K"]
    row = rows[0]
    assert row["patient_id"] == PatientProfile.objects.get(user=world["patient"]).patient_id
    assert (row["visits"], row["records"]) == (1, 0)
    assert row["last_visit"] and row["next_visit"]
    assert client_for(world["admin"]).get(f"/api/hospital-admin/patients/?q={row['patient_id']}").json()[0]["name"] == "Asha K"
    theirs = client_for(world["other_admin"]).get("/api/hospital-admin/patients/").json()
    assert [(r["name"], r["patient_id"]) for r in theirs] == [("Ravi", PatientProfile.objects.get(user=stranger).patient_id)]


@pytest.mark.django_db
def test_hospital_admins_open_records_by_patient_id_and_it_is_logged(world):
    upload = client_for(world["patient"]).post(
        "/api/records/", {"title": "ECG", "record_type": "scan", "file": SimpleUploadedFile("ecg.pdf", PDF)}, format="multipart")
    assert upload.status_code == 201
    code = PatientProfile.objects.get(user=world["patient"]).patient_id

    admin = client_for(world["admin"])
    r = admin.get(f"/api/records/patients/{code}/")
    assert r.status_code == 200 and [x["title"] for x in r.json()["records"]] == ["ECG"]
    assert admin.get(f"/api/records/{upload.json()['id']}/file/").status_code == 200
    log = client_for(world["patient"]).get("/api/records/access-log/").json()
    assert {(e["viewer_role"], e["action"]) for e in log} == {("hospital", "view_list"), ("hospital", "download")}

    # General patient ID (owner decision 2026-11-17): another hospital's admin can open them too, and it's logged.
    other = client_for(world["other_admin"])
    assert other.get(f"/api/records/patients/{code}/").status_code == 200
    assert RecordAccess.objects.filter(viewer=world["other_admin"], hospital_name="Other Hospital").count() == 1


@pytest.mark.django_db
def test_hospital_admin_sees_only_their_hospitals_appointments(world):
    book(world["patient"], make_doctor("doc4@example.com", world["other"]))
    mine = client_for(world["admin"]).get("/api/appointments/").json()
    assert {a["hospital_name"] for a in mine} == {"City Hospital"} and len(mine) == 2
    lonely = User.objects.create_user("lonely@example.com", "pw", role="hospital")
    assert client_for(lonely).get("/api/appointments/").json() == []
    boss = User.objects.create_superuser("boss@example.com", "pw")
    assert len(client_for(boss).get("/api/appointments/").json()) == 3  # platform admin sees all


# ---- Platform-only actions ----

@pytest.mark.django_db
def test_hospital_admins_cannot_approve_hospitals_or_answer_platform_requests(world):
    pending = Hospital.objects.create(name="Pending Hospital", city="Chennai", is_approved=False)
    admin = client_for(world["admin"])
    assert admin.patch(f"/api/hospitals/{pending.id}/", {"is_approved": True}, format="json").status_code == 403
    assert admin.post("/api/hospitals/", {"name": "Mine", "city": "Chennai"}, format="json").status_code == 403
    assert admin.post("/api/departments/", {"name": "Oncology"}, format="json").status_code == 403
    assert pending.id not in [h["id"] for h in admin.get("/api/hospitals/").json()]

    req = AppointmentRequest.objects.create(patient=world["patient"], hospital=pending, preferred_date=date(2030, 1, 1))
    assert admin.get("/api/appointment-requests/").json() == []
    assert admin.post(f"/api/appointment-requests/{req.id}/confirm/").status_code == 404

    boss = client_for(User.objects.create_superuser("boss@example.com", "pw"))
    assert boss.patch(f"/api/hospitals/{pending.id}/", {"is_approved": True}, format="json").status_code == 200
    assert [r["id"] for r in boss.get("/api/appointment-requests/").json()] == [req.id]


@pytest.mark.django_db
def test_payroll_per_month_counts_who_worked_each_month(world):
    from datetime import date
    from unittest import mock

    c = client_for(world["admin"])
    add_staff(c, full_name="Old nurse", join_date="2026-01-10", monthly_salary="30000")             # all along
    add_staff(c, kind="pharmacist", full_name="New", join_date="2026-10-20", monthly_salary="20000")  # from October
    left = add_staff(c, full_name="Leaver", join_date="2026-02-01", monthly_salary="10000").json()
    c.patch(f"/api/hospital-admin/staff/{left['id']}/", {"left_on": "2026-09-15"}, format="json")      # worked part of Sept
    add_staff(c, full_name="Not yet", join_date="2026-12-01", monthly_salary="99000")                # starts next month

    with mock.patch("apps.staff.views.timezone.localdate", return_value=date(2026, 11, 18)):
        r = c.get("/api/hospital-admin/payroll/?months=4").json()
    assert r["based_on_current_salaries"] is True
    rows = {m["month"]: m for m in r["months"]}
    assert list(rows) == ["Aug 2026", "Sep 2026", "Oct 2026", "Nov 2026"]
    assert [float(rows[m]["total"]) for m in rows] == [40000, 40000, 50000, 50000]
    assert (float(rows["Oct 2026"]["nurses"]), float(rows["Oct 2026"]["other_staff"]), rows["Oct 2026"]["people"]) == (30000, 20000, 2)
    assert rows["Sep 2026"]["people"] == 2  # the leaver still worked in September

    assert client_for(world["other_admin"]).get("/api/hospital-admin/payroll/").json()["months"][-1]["total"] == 0
    assert client_for(world["patient"]).get("/api/hospital-admin/payroll/").status_code == 403


@pytest.mark.django_db
def test_a_staff_members_page_has_specialization_qualification_and_the_linked_doctor(world):
    """Staff pages (owner request 2026-11-22): open one person and see all their details."""
    c = client_for(world["admin"])
    nurse = add_staff(c, department=world["cardio"].id, specialization="ICU nursing", qualification="B.Sc Nursing",
                      phone="98400 11111").json()
    page = c.get(f"/api/hospital-admin/staff/{nurse['id']}/").json()
    assert (page["specialization"], page["qualification"], page["department_name"]) == ("ICU nursing", "B.Sc Nursing", "Cardiology")
    assert page["doctor_profile"] is None

    world["doc"].specialization, world["doc"].qualification = "Cardiologist", "MBBS, MD"
    world["doc"].save()
    doc = add_staff(c, kind="doctor", full_name="", doctor=world["doc"].id, monthly_salary="150000").json()
    profile = c.get(f"/api/hospital-admin/staff/{doc['id']}/").json()["doctor_profile"]
    assert (profile["id"], profile["specialization"], profile["qualification"]) == (world["doc"].id, "Cardiologist", "MBBS, MD")

    # The list search also finds specialization, department and phone.
    assert [s["id"] for s in c.get("/api/hospital-admin/staff/?q=icu").json()] == [nurse["id"]]
    assert nurse["id"] in [s["id"] for s in c.get("/api/hospital-admin/staff/?q=cardiology").json()]
    assert [s["id"] for s in c.get("/api/hospital-admin/staff/?q=98400").json()] == [nurse["id"]]
    # Another hospital can't open it.
    assert client_for(world["other_admin"]).get(f"/api/hospital-admin/staff/{nurse['id']}/").status_code == 404
