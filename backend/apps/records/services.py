"""
Rules for medical records:
- what a valid upload is (PDF / JPG / PNG, checked by content, not only by name; size limit);
- which doctors may open a patient's records (owner decision 2026-11-16: a patient who has had an
  appointment at the doctor's hospital; cancelled-only bookings don't count);
- the access log the patient can read.
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

# Appointment statuses that make a doctor's hospital "the patient's hospital".
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


def doctor_hospital_for(doctor_user, patient) -> Hospital | None:
    """
    The doctor's hospital if this doctor may open the patient's records, else None.
    Allowed when the patient has a booked, confirmed or completed appointment with any doctor
    at the hospital this doctor works at.
    """
    # Read fresh from the database (not a copy cached on the user object): the hospital must be current.
    profile = DoctorProfile.objects.select_related("hospital").filter(user=doctor_user).first()
    if profile is None or profile.hospital_id is None:
        return None
    related = Appointment.objects.filter(
        patient=patient, doctor__hospital_id=profile.hospital_id, status__in=RELATED_STATUSES
    ).exists()
    return profile.hospital if related else None


LOG_REPEAT_WINDOW = timedelta(minutes=1)


def log_access(*, viewer, patient, hospital: Hospital, action: str, record: MedicalRecord | None = None):
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
        viewer_name=viewer.get_full_name() or viewer.email,
        hospital=hospital,
        hospital_name=hospital.name if hospital else "",
        record=record,
        record_title=record.title if record else "",
        action=action,
    )
