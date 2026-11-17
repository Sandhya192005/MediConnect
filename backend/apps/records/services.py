"""
Rules for medical records:
- what a valid upload is (PDF / JPG / PNG, checked by content, not only by name; size limit);
- who may open a patient's records: the patient ID is a GENERAL ID (owner decision 2026-11-17, replacing the
  earlier "patients of your hospital only" rule): any doctor or admin account can open any patient's records
  with it. The owner accepted the risk that a self-registered "doctor" account can do this too;
- the access log the patient can read (every view by someone else is still logged).
"""

import os
from datetime import timedelta

from django.conf import settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.appointments.models import Appointment
from apps.doctors.models import DoctorProfile
from apps.hospitals.models import Hospital

from .models import MedicalRecord, RecordAccess

# Extension → (content type, the bytes every real file of that type starts with)
ALLOWED = {
    ".pdf": ("application/pdf", (b"%PDF-",)),
    ".png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    ".jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    ".jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
}

# Appointment statuses that make someone a patient of a hospital (used for the hospital admin's patient list).
RELATED_STATUSES = [Appointment.Status.BOOKED, Appointment.Status.CONFIRMED, Appointment.Status.COMPLETED]


def check_upload(file) -> str:
    """Validates an uploaded file and returns its content type. Raises ValidationError with a plain message."""
    max_mb = settings.RECORD_MAX_BYTES // (1024 * 1024)
    if file.size > settings.RECORD_MAX_BYTES:
        raise ValidationError(f"The file is too large. The limit is {max_mb} MB.")
    if file.size == 0:
        raise ValidationError("The file is empty.")

    ext = os.path.splitext(file.name)[1].lower()
    if ext not in ALLOWED:
        raise ValidationError("Only PDF, JPG and PNG files can be uploaded.")
    content_type, signatures = ALLOWED[ext]

    # The name can lie ("virus.exe" renamed to "report.pdf"), so look at the first bytes too.
    file.seek(0)
    head = file.read(16)
    file.seek(0)
    if not any(head.startswith(sig) for sig in signatures):
        raise ValidationError(f"This doesn't look like a real {ext[1:].upper()} file.")
    return content_type


def staff_hospital(user) -> Hospital | None:
    """The hospital a doctor works at or a hospital admin manages (read fresh from the database)."""
    if user.role == "doctor":
        profile = DoctorProfile.objects.select_related("hospital").filter(user=user).first()
        return profile.hospital if profile else None
    if user.role == "admin":
        from apps.accounts.permissions import admin_hospital

        return admin_hospital(user)
    return None


RECORD_VIEWER_ROLES = ("doctor", "admin")


def may_open_records(user) -> bool:
    """General patient ID: any doctor or admin account may open any patient's records (patients: only their own)."""
    return user.role in RECORD_VIEWER_ROLES


LOG_REPEAT_WINDOW = timedelta(minutes=1)


def log_access(*, viewer, patient, hospital: Hospital | None, action: str, record: MedicalRecord | None = None):
    """
    Writes one access-log line. The same doctor repeating the same action within a minute
    (a page reload, a double click) is one visit, so it isn't written twice.
    """
    recent = RecordAccess.objects.filter(
        patient=patient, viewer=viewer, action=action, record=record,
        created_at__gte=timezone.now() - LOG_REPEAT_WINDOW,
    )
    if recent.exists():
        return
    RecordAccess.objects.create(
        patient=patient,
        viewer=viewer,
        viewer_role=viewer.role,
        viewer_name=viewer.get_full_name() or viewer.email,
        hospital=hospital,
        hospital_name=hospital.name if hospital else "",
        record=record,
        record_title=record.title if record else "",
        action=action,
    )
