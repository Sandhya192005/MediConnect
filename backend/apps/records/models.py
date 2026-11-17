import os
import uuid

from django.conf import settings
from django.db import models
from django.db.models import F

from .storage import private_storage


def record_upload_to(instance, filename):
    """A random file name in the patient's folder. The original name is kept in `original_name`."""
    ext = os.path.splitext(filename)[1].lower()
    return f"records/{instance.patient_id}/{uuid.uuid4().hex}{ext}"


class MedicalRecord(models.Model):
    """A report, scan or X-ray the patient uploaded. Private: only the patient and permitted doctors can read it."""

    class Type(models.TextChoices):
        LAB_REPORT = "lab_report", "Lab report"
        SCAN = "scan", "Scan (CT / MRI / ultrasound)"
        XRAY = "xray", "X-ray"
        PRESCRIPTION = "prescription", "Prescription"
        DISCHARGE = "discharge", "Discharge summary"
        OTHER = "other", "Other"

    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="medical_records")
    title = models.CharField(max_length=150)
    record_type = models.CharField(max_length=20, choices=Type.choices, default=Type.OTHER)
    record_date = models.DateField(null=True, blank=True, help_text="When the test or visit happened")
    notes = models.TextField(max_length=1000, blank=True)
    file = models.FileField(upload_to=record_upload_to, storage=private_storage, max_length=255)
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=50)
    size = models.PositiveIntegerField()
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = [F("record_date").desc(nulls_last=True), "-created_at"]
        indexes = [models.Index(fields=["patient", "-created_at"])]

    def __str__(self):
        return f"{self.title} ({self.patient_id})"


class RecordAccess(models.Model):
    """
    One line in a patient's access log: a doctor opened their records list or one of their files.
    Names are copied in, so the log still reads correctly if the doctor or record is later deleted.
    """

    class Action(models.TextChoices):
        VIEW_LIST = "view_list", "Opened your records"
        DOWNLOAD = "download", "Opened a file"

    patient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="record_access_log")
    viewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    viewer_role = models.CharField(max_length=10, default="doctor", help_text="doctor or admin (hospital admin)")
    viewer_name = models.CharField(max_length=150)
    hospital = models.ForeignKey("hospitals.Hospital", on_delete=models.SET_NULL, null=True, related_name="+")
    hospital_name = models.CharField(max_length=200, blank=True)
    record = models.ForeignKey(MedicalRecord, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    record_title = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=20, choices=Action.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["patient", "-created_at"])]

    def __str__(self):
        return f"{self.viewer_name} · {self.get_action_display()} · {self.created_at:%Y-%m-%d %H:%M}"
