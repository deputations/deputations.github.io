"""Location for a vacancy whose notification names no place.

Owner's rule (HANDOVER, session shq-2026-10-11-002). Every vacancy on the
site is a Central Government deputation, so a row with no Location_City and
no Location_State is placed, in this order:

  1. where the other posts of the same notification are — same notification
     link, or same upload + organisation + notification date — when every
     one of them that names a place names the same place;
  2. where the organisation's other vacancies are, on the same condition;
  3. at New Delhi.

When State Government vacancies are added, step 3 must use the issuing
state's capital instead of New Delhi (see HANDOVER before changing this).

Rows that name any place (city or state) are never touched. A filled row
gets Location_Assumed = "notification" | "organisation" | "default", which
the India map shows as "location not stated".

Kept free of build_data.py's Google / pandas imports so it can be unit
tested on its own (tests/test_location_defaults.py).
"""

import re
from collections import Counter, defaultdict
from typing import Any

DEFAULT_CITY = "New Delhi"
DEFAULT_STATE = "Delhi"


def _clean(value: Any) -> str:
    return " ".join(str(value or "").split())


def _place(row: dict[str, Any]) -> tuple[str, str]:
    return (_clean(row.get("Location_City")), _clean(row.get("Location_State")))


def _org(row: dict[str, Any]) -> str:
    """Organisation name for matching: case, punctuation and bracketed
    acronyms ignored ("NITI Aayog (NITI)" == "niti aayog"). Different
    spellings of a name are not guessed at."""
    name = re.sub(r"\([^)]*\)", " ", _clean(row.get("Organisation")).lower())
    return " ".join(re.sub(r"[^a-z0-9]+", " ", name).split())


def _notification_keys(row: dict[str, Any]) -> list[tuple[str, ...]]:
    keys: list[tuple[str, ...]] = []
    link = _clean(row.get("Official_Notification_Link")).lower()
    if link:
        keys.append(("link", link))
    job = _clean(row.get("Ingest_Job_ID"))
    org = _org(row)
    notified = _clean(row.get("Notification_Date"))
    if job and org and notified:
        keys.append(("ad", job, org, notified))
    return keys


def _single(places: set[tuple[str, str]]) -> tuple[str, str] | None:
    return next(iter(places)) if len(places) == 1 else None


def fill_missing_locations(rows: list[dict[str, Any]]) -> Counter:
    """Fill Location_City / Location_State in place on rows that name no place.

    Returns how many rows were filled on each basis."""
    by_notification: dict[tuple[str, ...], set[tuple[str, str]]] = defaultdict(set)
    by_org: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for row in rows:
        place = _place(row)
        if place == ("", ""):
            continue
        for key in _notification_keys(row):
            by_notification[key].add(place)
        org = _org(row)
        if org:
            by_org[org].add(place)

    filled: Counter = Counter()
    for row in rows:
        if _place(row) != ("", ""):
            continue
        siblings: set[tuple[str, str]] = set()
        for key in _notification_keys(row):
            siblings |= by_notification.get(key, set())
        org = _org(row)
        if _single(siblings):
            basis, (city, state) = "notification", _single(siblings)
        elif not siblings and org and _single(by_org.get(org, set())):
            basis, (city, state) = "organisation", _single(by_org[org])
        else:
            basis, (city, state) = "default", (DEFAULT_CITY, DEFAULT_STATE)
        row["Location_City"] = city
        row["Location_State"] = state
        row["Location_Assumed"] = basis
        filled[basis] += 1
    return filled
