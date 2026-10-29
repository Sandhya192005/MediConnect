"""
Elasticsearch index definitions.

PostgreSQL stays the "source of truth". Elasticsearch keeps a search-friendly copy of
doctors and hospitals, so we can do typo-tolerant search, synonyms, autocomplete and facets.
"""

from functools import lru_cache

from django.conf import settings
from elasticsearch import Elasticsearch


@lru_cache
def es() -> Elasticsearch:
    return Elasticsearch(settings.ELASTICSEARCH_URL, request_timeout=5)


def index_name(kind: str) -> str:
    return f"{settings.ES_INDEX_PREFIX}_{kind}"


# Everyday words patients type -> the medical terms doctors are listed under.
SYNONYMS = [
    "heart, cardiac, cardiology, cardiologist",
    "skin, derma, dermatology, dermatologist",
    "child, children, kids, baby, pediatrics, paediatrics, pediatrician",
    "bone, joint, fracture, orthopedics, orthopaedics, orthopedic",
    "brain, nerve, neurology, neurologist",
    "ear, nose, throat, ent",
    "women, pregnancy, gynecology, gynaecology, gynecologist",
    "general, fever, physician, general medicine",
]

ANALYSIS = {
    "filter": {
        "medical_synonyms": {"type": "synonym_graph", "synonyms": SYNONYMS},
    },
    "analyzer": {
        # Used at search time so "heart doctor" also matches "Cardiologist".
        "medical_search": {
            "type": "custom",
            "tokenizer": "standard",
            "filter": ["lowercase", "asciifolding", "medical_synonyms"],
        },
        "medical_index": {
            "type": "custom",
            "tokenizer": "standard",
            "filter": ["lowercase", "asciifolding"],
        },
    },
}

_text = {"type": "text", "analyzer": "medical_index", "search_analyzer": "medical_search"}
_keyword = {"type": "keyword"}

MAPPINGS = {
    "doctors": {
        "properties": {
            "id": {"type": "integer"},
            # search_as_you_type powers autocomplete ("anit" -> "Anita Rao")
            "name": {"type": "search_as_you_type"},
            "specialization": {**_text, "fields": {"suggest": {"type": "search_as_you_type"}, "raw": _keyword}},
            "department": {**_text, "fields": {"raw": _keyword}},
            "department_id": {"type": "integer"},
            "hospital_name": {**_text, "fields": {"raw": _keyword}},
            "hospital_id": {"type": "integer"},
            "city": {**_text, "fields": {"raw": _keyword}},
            "qualification": _text,
            "bio": _text,
            "fee": {"type": "float"},
            "experience_years": {"type": "integer"},
            "location": {"type": "geo_point"},
            "is_bookable": {"type": "boolean"},
        }
    },
    "hospitals": {
        "properties": {
            "id": {"type": "integer"},
            "name": {"type": "search_as_you_type"},
            "address": _text,
            "city": {**_text, "fields": {"raw": _keyword}},
            "state": {**_text, "fields": {"raw": _keyword}},
            "country": _keyword,
            "departments": {**_text, "fields": {"raw": _keyword}},
            "location": {"type": "geo_point"},
            "is_approved": {"type": "boolean"},
        }
    },
}


def create_index(kind: str, delete_existing: bool = False) -> None:
    name = index_name(kind)
    if es().indices.exists(index=name):
        if not delete_existing:
            return
        es().indices.delete(index=name)
    es().indices.create(index=name, settings={"analysis": ANALYSIS, "number_of_replicas": 0}, mappings=MAPPINGS[kind])


def ensure_indexes() -> None:
    for kind in MAPPINGS:
        create_index(kind)
