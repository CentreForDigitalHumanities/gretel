# Generated by Django 4.1.2 on 2022-11-10 12:29

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("treebanks", "0004_component_contains_metadata"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="TreebankUpload",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "input_file",
                    models.FileField(blank=True, upload_to="uploaded_treebanks/"),
                ),
                ("input_dir", models.CharField(blank=True, max_length=255)),
                (
                    "input_format",
                    models.CharField(
                        choices=[
                            ("A", "Alpino"),
                            ("C", "CHAT"),
                            ("T", "plain text"),
                            ("F", "FoLiA"),
                        ],
                        max_length=2,
                    ),
                ),
                (
                    "upload_timestamp",
                    models.DateTimeField(
                        blank=True, null=True, verbose_name="Upload date and time"
                    ),
                ),
                ("public", models.BooleanField(default=True)),
                ("sentence_tokenized", models.BooleanField(null=True)),
                ("word_tokenized", models.BooleanField(null=True)),
                ("sentences_have_labels", models.BooleanField(null=True)),
                ("processed", models.DateTimeField(blank=True, null=True)),
                (
                    "treebank",
                    models.OneToOneField(
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to="treebanks.treebank",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]
