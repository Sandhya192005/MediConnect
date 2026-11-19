"""
Hospital accounts get their own role (owner request 2026-11-19).

Before: a hospital's login had role "admin", like the platform admin. Now:
- every non-superuser "admin" linked to a hospital (hospital_profile) becomes role "hospital";
- the hospital's new `email` column gets that login email when it is still empty.
Going back turns them into "admin" again (the email column is dropped by the hospitals migration).
"""

from django.db import migrations


def forwards(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    HospitalAdmin = apps.get_model("staff", "HospitalAdmin")
    Hospital = apps.get_model("hospitals", "Hospital")
    for link in HospitalAdmin.objects.select_related("user", "hospital"):
        user = link.user
        if user.is_superuser:
            continue  # a platform admin stays "admin"
        if user.role == "admin":
            # the hospital is the account: it is named after the hospital, not a person
            User.objects.filter(pk=user.pk).update(role="hospital", first_name=link.hospital.name[:150], last_name="")
        # their earlier record views were logged as "admin"
        apps.get_model("records", "RecordAccess").objects.filter(viewer_id=user.pk, viewer_role="admin").update(viewer_role="hospital")
        if not link.hospital.email:
            Hospital.objects.filter(pk=link.hospital_id).update(email=user.email)


def backwards(apps, schema_editor):
    apps.get_model("accounts", "User").objects.filter(role="hospital").update(role="admin")


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0007_alter_user_role"),
        ("hospitals", "0015_hospital_email"),
        ("staff", "0004_alter_hospitaladmin_options_and_more"),
        ("records", "0003_treatment_note"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
