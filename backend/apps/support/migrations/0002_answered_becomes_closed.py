from django.db import migrations, models


def answered_to_closed(apps, schema_editor):
    """The "Answered" status was removed (owner decision 2026-11-25): a message gets one reply, so it's closed."""
    apps.get_model("support", "SupportRequest").objects.filter(status="answered").update(status="closed")


class Migration(migrations.Migration):
    dependencies = [("support", "0001_initial")]

    operations = [
        # Can't be undone exactly (we can't tell which closed messages were "answered"), so going back keeps them closed.
        migrations.RunPython(answered_to_closed, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="supportrequest",
            name="status",
            field=models.CharField(choices=[("open", "Open"), ("closed", "Closed")], default="open", max_length=10),
        ),
    ]
