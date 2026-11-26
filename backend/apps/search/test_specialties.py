"""Specialist search over doctors read from hospital websites (owner report 2026-11-26:
"gynecologist" listed a cardiologist, a dermatologist and a neurologist)."""

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from apps.hospitals.models import Hospital
from apps.scraper.models import ScrapedDoctor

from .specialties import matching_specialties, root

SPECIALTIES = [
    "Cardiologist", "Dermatologist", "Neurologist", "Neurosurgeon", "Orthopedic Surgeon", "Pediatrician",
    "Obstetrics & Gynaecology", "Gynecologist", "ENT Surgeon", "Dental Surgeon", "Kidney Care",
]


def test_root_cuts_the_shared_ending():
    assert root("gynecologist") == root("gynecology") == "gynec"
    assert root("cardiologist") == "cardi"
    assert root("ent") == "ent"  # too short to cut


@pytest.mark.parametrize("query, expected", [
    ("gynecologist", {"Obstetrics & Gynaecology", "Gynecologist"}),
    ("gynaecologist", {"Obstetrics & Gynaecology", "Gynecologist"}),
    ("gynocologist", {"Obstetrics & Gynaecology", "Gynecologist"}),  # typo
    ("women", {"Obstetrics & Gynaecology", "Gynecologist"}),          # everyday word
    ("pregnancy", {"Obstetrics & Gynaecology", "Gynecologist"}),
    ("obstetrician", {"Obstetrics & Gynaecology", "Gynecologist"}),
    ("cardiolgist", {"Cardiologist"}),                                # typo
    ("heart", {"Cardiologist"}),
    ("neurologist", {"Neurologist", "Neurosurgeon"}),
    ("ent", {"ENT Surgeon"}),                                         # short word: exact only, not "Dental"
    ("child", {"Pediatrician"}),
    ("bone", {"Orthopedic Surgeon"}),
])
def test_specialty_matching(query, expected):
    assert set(matching_specialties(query, SPECIALTIES)) == expected


@pytest.mark.parametrize("query", ["gynecologist", "gynocologist", "women"])
def test_ologist_ending_alone_never_matches(query):
    found = set(matching_specialties(query, SPECIALTIES))
    assert not found & {"Cardiologist", "Dermatologist", "Neurologist"}


@pytest.fixture
def website_doctors(db):
    h = Hospital.objects.create(name="Kilpauk Medical College", city="Chennai", source="osm", is_approved=False)
    now = timezone.now()
    for name, spec in [("Dr. Kavitha Raman", "Cardiologist"), ("Dr. Farhan Ali", "Dermatologist"),
                       ("Dr. Meenakshi Iyer", "Neurologist"), ("Dr. Priya Sundar", "Obstetrics & Gynaecology")]:
        ScrapedDoctor.objects.create(hospital=h, name=name, specialization=spec, source_url="https://kmc.example",
                                     collected_at=now)
    return h


def names(q):
    return [d["name"] for d in APIClient().get("/api/search/listed-doctors/", {"q": q}).data["results"]]


def test_api_finds_only_the_gynecologist(website_doctors):
    for q in ["gynecologist", "gynocologist", "women", "pregnancy"]:
        assert names(q) == ["Dr. Priya Sundar"], q


def test_api_unknown_specialty_finds_nobody(website_doctors):
    assert names("urologist") == []


def test_api_specialty_inside_a_name_is_not_a_typo_match(website_doctors):
    # Some websites put the specialty in the name field; "urologist" must not match it by "-ologist".
    ScrapedDoctor.objects.create(hospital=website_doctors, name="Dr. Ravi Shankar Ophthalmologist",
                                 specialization="", source_url="https://kmc.example", collected_at=timezone.now())
    assert names("urologist") == []
    assert names("Ophthalmologist") == ["Dr. Ravi Shankar Ophthalmologist"]  # the real word still finds it


def test_api_name_typo_still_works(website_doctors):
    assert names("Kavita Raman") == ["Dr. Kavitha Raman"]


def test_api_name_typo_ignores_non_medical_specialty_text(website_doctors):
    # A website put its hospital name in the specialty field: "Raman" must not count as a typo of "Rajan".
    ScrapedDoctor.objects.create(hospital=website_doctors, name="Dr. Niranjana", specialization="Rajan Eye Care",
                                 source_url="https://kmc.example", collected_at=timezone.now())
    assert names("Kavita Raman") == ["Dr. Kavitha Raman"]
