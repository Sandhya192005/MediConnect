import secrets

from django.db import migrations


def give_existing_patients_an_id(apps, schema_editor):
    """Patients who signed up before Step 2 get a patient ID now (new patients get one at sign-up)."""
    User = apps.get_model("accounts", "User")
    PatientProfile = apps.get_model("accounts", "PatientProfile")
    taken = set(PatientProfile.objects.values_list("patient_id", flat=True))
    for user in User.objects.filter(role="patient", patient_profile__isnull=True):
        code = f"P{secrets.randbelow(900_000) + 100_000}"
        while code in taken:
            code = f"P{secrets.randbelow(900_000) + 100_000}"
        taken.add(code)
        PatientProfile.objects.create(user=user, patient_id=code)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_patientprofile")]

    operations = [migrations.RunPython(give_existing_patients_an_id, migrations.RunPython.noop)]
