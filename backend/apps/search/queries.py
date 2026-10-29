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
        must = [{
            "multi_match": {
                "query": q,
                # ^n = boost: a match on name/specialization counts more than a match in the bio
                "fields": ["name^4", "specialization^3", "department^3", "hospital_name^2", "city^2", "qualification", "bio"],
                "fuzziness": "AUTO",  # tolerate typos: "cardiolgist" -> "cardiologist"
                "prefix_length": 1,
                "operator": "or",
            }
        }]
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


def search_hospitals(q="", city=None, page=1, size=12):
    filters = [{"term": {"is_approved": True}}]
    if city:
        filters.append({"term": {"city.raw": city}})
    must = (
        [{"multi_match": {"query": q, "fields": ["name^3", "departments^2", "city^2", "address", "state"], "fuzziness": "AUTO"}}]
        if q else [{"match_all": {}}]
    )
    res = es().search(
        index=index_name("hospitals"),
        query={"bool": {"must": must, "filter": filters}},
        highlight=HIGHLIGHT,
        from_=(page - 1) * size,
        size=size,
    )
    return {
        "total": res["hits"]["total"]["value"],
        "page": page,
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
            source=["id", "name", "specialization", "city", "hospital_name"],
            size=size,
        )
        return [h["_source"] for h in res["hits"]["hits"]]

    sayt = lambda f: [f, f"{f}._2gram", f"{f}._3gram"]  # noqa: E731
    doctors = run("doctors", sayt("name") + sayt("specialization.suggest"), {"term": {"is_bookable": True}})
    hospitals = run("hospitals", sayt("name"), {"term": {"is_approved": True}})
    return {"doctors": doctors, "hospitals": hospitals[:3]}
