"""The actual Elasticsearch queries behind the search API."""

from .indexes import es, index_name

# Highlight markers. Not HTML tags, so the frontend can render highlights without
# inserting raw HTML (which would be an XSS risk).
HL_PRE, HL_POST = "\u0002", "\u0003"
HIGHLIGHT = {
    "pre_tags": [HL_PRE],
    "post_tags": [HL_POST],
    "fields": {
        # search_as_you_type fields need the "plain" highlighter; the default one skips them.
        "name": {"type": "plain", "number_of_fragments": 0},
        "*": {"number_of_fragments": 0},
    },
}


def doctor_text_query(q: str) -> dict:
    """Free-text doctor match, shared by doctor search and the MediConnect hospitals list."""
    return {
        "multi_match": {
            "query": q,
            # ^n = boost: a match on name/specialization counts more than a match in the bio
            "fields": ["name^4", "specialization^3", "department^3", "hospital_name^2", "city^2", "qualification", "bio"],
            "fuzziness": "AUTO",  # tolerate typos: "cardiolgist" -> "cardiologist"
            "prefix_length": 1,
            "operator": "or",
        }
    }


def hospital_text_query(q: str) -> dict:
    # cross_fields + "and": every word typed must match, in any field, so "anna nagar" finds hospitals in
    # Anna Nagar rather than everything with "nagar" (2026-11-18). Exact matches rank above typo matches.
    # AUTO:3,5 = allow 2 typos from 5 letters ("applo" -> "apollo"); hospital names are often misspelt.
    return {"bool": {"should": [
        {"multi_match": {"query": q, "type": "cross_fields", "operator": "and", "boost": 2,
                         "fields": ["name^3", "departments^2", "city^2", "address", "state"]}},
        {"multi_match": {"query": q, "fields": ["name^3", "departments^2"], "operator": "and", "fuzziness": "AUTO:3,5"}},
    ], "minimum_should_match": 1}}


def search_doctors(q="", department=None, city=None, min_fee=None, max_fee=None, page=1, size=12):
    filters = [{"term": {"is_bookable": True}}]
    if department:
        filters.append({"term": {"department.raw": department}})
    if city:
        filters.append({"term": {"city.raw": city}})
    if min_fee is not None or max_fee is not None:
        rng = {}
        if min_fee is not None:
            rng["gte"] = min_fee
        if max_fee is not None:
            rng["lte"] = max_fee
        filters.append({"range": {"fee": rng}})

    if q:
        must = [doctor_text_query(q)]
    else:
        must = [{"match_all": {}}]

    res = es().search(
        index=index_name("doctors"),
        query={"bool": {"must": must, "filter": filters}},
        highlight=HIGHLIGHT,
        # Facets: how many results fall in each department / city (for the filter chips).
        aggs={
            "departments": {"terms": {"field": "department.raw", "size": 20}},
            "cities": {"terms": {"field": "city.raw", "size": 20}},
            "fee_stats": {"stats": {"field": "fee"}},
        },
        sort=["_score", {"experience_years": "desc"}],
        from_=(page - 1) * size,
        size=size,
    )
    return {
        "total": res["hits"]["total"]["value"],
        "page": page,
        "results": [{**h["_source"], "score": h["_score"], "highlight": h.get("highlight", {})} for h in res["hits"]["hits"]],
        "facets": {
            "departments": [{"value": b["key"], "count": b["doc_count"]} for b in res["aggregations"]["departments"]["buckets"]],
            "cities": [{"value": b["key"], "count": b["doc_count"]} for b in res["aggregations"]["cities"]["buckets"]],
            "fee": res["aggregations"]["fee_stats"],
        },
    }


def search_hospitals(q="", city=None, page=1, size=12, partners_only=False, exclude_partners=False):
    filters = [{"term": {"listed": True}}]  # partners + hospitals from OpenStreetMap / websites
    if city:
        filters.append({"term": {"city.raw": city}})
    if partners_only:  # "Instant booking only"
        filters.append({"term": {"is_partner": True}})
    if exclude_partners:  # Book appointment lists MediConnect hospitals separately, above the others
        filters.append({"term": {"is_partner": False}})
    must = [hospital_text_query(q)] if q else [{"match_all": {}}]
    res = es().search(
        index=index_name("hospitals"),
        query={"bool": {"must": must, "filter": filters}},
        highlight=HIGHLIGHT,
        # Partners first when the match is equally good.
        sort=["_score", {"is_partner": {"order": "desc", "unmapped_type": "boolean"}}],
        from_=(page - 1) * size,
        size=size,
        # Cities to filter by (the Find hospitals page); hospitals without a city are left out of the list.
        aggs={"cities": {"terms": {"field": "city.raw", "size": 30, "min_doc_count": 1, "exclude": ""}}},
    )
    return {
        "total": res["hits"]["total"]["value"],
        "page": page,
        "cities": [{"name": b["key"], "count": b["doc_count"]} for b in res["aggregations"]["cities"]["buckets"]],
        "results": [{**h["_source"], "score": h["_score"], "highlight": h.get("highlight", {})} for h in res["hits"]["hits"]],
    }


def suggest(q: str, size: int = 5):
    """Autocomplete as the user types. bool_prefix treats the last word as a prefix."""
    def run(kind, fields, extra_filter):
        res = es().search(
            index=index_name(kind),
            query={"bool": {
                "must": [{"multi_match": {"query": q, "type": "bool_prefix", "fields": fields}}],
                "filter": [extra_filter],
            }},
            source=["id", "name", "specialization", "city", "hospital_name", "is_partner"],
            size=size,
        )
        return [h["_source"] for h in res["hits"]["hits"]]

    sayt = lambda f: [f, f"{f}._2gram", f"{f}._3gram"]  # noqa: E731
    doctors = run("doctors", sayt("name") + sayt("specialization.suggest"), {"term": {"is_bookable": True}})
    hospitals = run("hospitals", sayt("name"), {"term": {"listed": True}})
    return {"doctors": doctors, "hospitals": hospitals[:3]}
