import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote
from xml.sax.saxutils import escape

import pandas as pd
import urllib.request
from dateutil import parser as date_parser
from google.auth import default
from googleapiclient.discovery import build


DATA_DIR = Path("data")
OUTPUT_VACANCIES = DATA_DIR / "vacancies.json"
OUTPUT_FILTERS = DATA_DIR / "filters.json"
OUTPUT_STATS = DATA_DIR / "stats.json"
OUTPUT_META = DATA_DIR / "meta.json"
OUTPUT_FEED = Path("feed.xml")          # site root, next to sitemap.xml
SITE_URL = "https://alldeputations.com"

REQUIRED_COLUMNS = [
    "Vacancy_ID",
    "Ministry",
    "Post_Name",
    "Level",
    "Level_Text",
    "Location_City",
    "Location_State",
    "Req_Level1",
    "Notification_Date",
    "Last_Date_To_Apply",
    "Days_Left",
    "Status",
    "Official_Notification_Link",
    "DRAFT / APPROVED",
]

TEXT_COLUMNS_TO_NORMALIZE = [
    "Vacancy_ID",
    "Ministry",
    "Department_Organisation",
    "Post_Name",
    "Level",
    "Level_Text",
    "Location_City",
    "Location_State",
    "Req_Level1",
    "Req_Level2",
    "Status",
    "Official_Notification_Link",
    "Application_Form_Link",
    "Mode_of_Application",
    "Essential_Qualification",
    "Desirable_Qualification",
    "Experience",
    "Job_Description",
    "Description",
    "Remarks",
    "Notes",
    "Keywords",
    "DRAFT / APPROVED",
]


def normalize_whitespace(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ").strip()
    return re.sub(r"\s+", " ", text)


def safe_str(value: Any) -> str:
    return normalize_whitespace(value)


def parse_level_value(value: Any) -> int | None:
    text = safe_str(value)
    if not text:
        return None
    match = re.search(r"(\d+)", text)
    if not match:
        return None
    return int(match.group(1))


def parse_date(value: Any) -> str:
    text = safe_str(value)
    if not text:
        return ""
    try:
        dt = date_parser.parse(text, dayfirst=True, fuzzy=True)
        return dt.date().isoformat()
    except Exception:
        return text


def to_display_date(value: str) -> str:
    if not value:
        return ""
    try:
        dt = datetime.fromisoformat(value).date()
        return dt.strftime("%d %b %Y")
    except Exception:
        return value


def compute_days_left(last_date_iso: str) -> int | None:
    if not last_date_iso:
        return None
    try:
        last_dt = datetime.fromisoformat(last_date_iso).date()
        return (last_dt - date.today()).days
    except Exception:
        return None


# A pre-signed S3 link carries the signing credentials in its query string
# (`X-Amz-Credential=AKIA…`, `X-Amz-Signature=…`). Two independent reasons to
# refuse to publish one:
#
#   1. It is already dead. Pre-signed links are minted with a short expiry —
#      the ones that triggered this were `X-Amz-Expires=10800`, i.e. three
#      hours — so by the time a visitor clicks it from a daily data dump it has
#      long since stopped working. The bucket is private, and stripping the
#      query string just yields a 403, so there is no usable link to salvage.
#   2. It wedges the whole pipeline. GitHub push protection reads `AKIA…` as a
#      leaked AWS key and REJECTS the data commit, so one such link stops every
#      future build from publishing — not just its own row. That happened on
#      2026-08-10: eleven MMRCL links blocked the dump, and the workflow still
#      reported success because the push failure was swallowed by its retries.
#
# The key ID belongs to whoever published the notification, not to us, and an
# access key ID is not by itself usable (the secret half is never in the URL).
# We drop these links anyway — a dead link helps nobody, and no single vacancy
# is worth blocking the dataset.
PRESIGNED_MARKERS = ("x-amz-credential=", "x-amz-signature=")


def is_presigned_url(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in PRESIGNED_MARKERS)


def normalize_url(value: Any) -> str:
    text = safe_str(value)
    if not text:
        return ""
    lowered = text.lower()
    if lowered in {"-", "—", "na", "n/a", "null", "undefined"}:
        return ""
    if is_presigned_url(text):
        return ""
    if text.startswith(("http://", "https://")):
        return text
    if text.startswith("www."):
        return f"https://{text}"
    return text


def build_location_label(city: str, state: str) -> str:
    city = safe_str(city)
    state = safe_str(state)
    if city and state:
        return f"{city}, {state}"
    return city or state


def is_delhi_ncr(city: str, state: str) -> bool:
    combined = f"{safe_str(city)} {safe_str(state)}".lower()
    keywords = [
        "delhi",
        "new delhi",
        "noida",
        "greater noida",
        "gurugram",
        "gurgaon",
        "faridabad",
        "ghaziabad",
    ]
    return any(keyword in combined for keyword in keywords)


def format_eligibility_text(req1: Any, req2: Any) -> str:
    level1 = parse_level_value(req1)
    level2 = parse_level_value(req2)

    if level1 is not None and level2 is not None:
        if level1 == level2:
            return f"Level {level1}"
        return f"Level {min(level1, level2)} to Level {max(level1, level2)}"
    if level1 is not None:
        return f"Level {level1}"
    if level2 is not None:
        return f"Level {level2}"
    return "Not specified"


def build_eligibility_rules(req1: Any, req2: Any) -> dict[str, Any]:
    level1 = parse_level_value(req1)
    level2 = parse_level_value(req2)
    if level1 is not None and level2 is not None:
        return {
            "min_level": min(level1, level2),
            "max_level": max(level1, level2),
            "type": "range",
        }
    if level1 is not None:
        return {"min_level": level1, "max_level": level1, "type": "single"}
    if level2 is not None:
        return {"min_level": level2, "max_level": level2, "type": "single"}
    return {"min_level": None, "max_level": None, "type": "unspecified"}


def infer_status(raw_status: str, days_left: int | None) -> str:
    status = safe_str(raw_status)
    if status:
        lowered = status.lower()
        if lowered in {"active", "inactive", "expired"}:
            if lowered == "active" and days_left is not None and days_left < 0:
                return "Inactive"
            return status.capitalize()

    if days_left is None:
        return "Unknown"
    if days_left < 0:
        return "Inactive"
    return "Active"


def build_search_text(row: dict[str, Any]) -> str:
    parts = [
        row.get("Post_Name", ""),
        row.get("Department_Organisation", ""),
        row.get("Ministry", ""),
        row.get("Location_City", ""),
        row.get("Location_State", ""),
        row.get("Level_Text", ""),
        row.get("Req_Level1", ""),
        row.get("Req_Level2", ""),
        row.get("Essential_Qualification", ""),
        row.get("Desirable_Qualification", ""),
        row.get("Experience", ""),
        row.get("Keywords", ""),
    ]
    return " ".join(safe_str(part) for part in parts if safe_str(part)).lower()


def compute_completeness_score(row: dict[str, Any]) -> int:
    fields = [
        "Vacancy_ID",
        "Ministry",
        "Department_Organisation",
        "Post_Name",
        "Level_Text",
        "Location_City",
        "Location_State",
        "Req_Level1",
        "Req_Level2",
        "Notification_Date",
        "Last_Date_To_Apply",
        "Official_Notification_Link",
        "Application_Form_Link",
        "Mode_of_Application",
        "Essential_Qualification",
        "Experience",
    ]
    filled = sum(1 for field in fields if safe_str(row.get(field, "")))
    return round((filled / len(fields)) * 100)


def compute_data_quality_flag(completeness_score: int) -> str:
    if completeness_score >= 85:
        return "High"
    if completeness_score >= 60:
        return "Medium"
    return "Low"


def list_unique_sorted(values: list[str]) -> list[str]:
    clean = sorted({safe_str(v) for v in values if safe_str(v)})
    return clean


def fetch_sheet_rows(sheet_id: str) -> list[dict[str, str]]:
    credentials, _ = default(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"])
    service = build("sheets", "v4", credentials=credentials, cache_discovery=False)

    spreadsheet = (
        service.spreadsheets()
        .get(spreadsheetId=sheet_id)
        .execute()
    )
    sheets = spreadsheet.get("sheets", [])
    if not sheets:
        raise RuntimeError("No sheets found in the spreadsheet.")

    first_sheet_title = sheets[0]["properties"]["title"]
    result = (
        service.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=f"'{first_sheet_title}'!A:ZZ")
        .execute()
    )

    values = result.get("values", [])
    if not values:
        return []

    headers = [normalize_whitespace(col) for col in values[0]]
    rows: list[dict[str, str]] = []

    for raw_row in values[1:]:
        padded = raw_row + [""] * (len(headers) - len(raw_row))
        row = {headers[i]: normalize_whitespace(padded[i]) for i in range(len(headers))}
        rows.append(row)

    return rows


# Supabase vacancies table uses snake_case columns (per migration 0001). The
# downstream transform_rows() + build_filters/stats/feed all expect the
# Title_Case keys the Google Sheet provides. This mapping translates the two
# so both source paths produce identical downstream shapes.
SUPABASE_TO_TITLE_MAP: dict[str, str] = {
    "vacancy_id":                "Vacancy_ID",
    "ministry":                  "Ministry",
    "min_code":                  "Min_Code",
    "department":                "Department",
    "organisation":              "Organisation",
    "organisation_type":         "Organisation_Type",
    "post_name":                 "Post_Name",
    "level":                     "Level",
    "level_text":                "Level_Text",
    "location_city":             "Location_City",
    "location_state":            "Location_State",
    "region":                    "Region",
    "req_level1":                "Req_Level1",
    "min_years_experience":      "Min_Years_Experience",
    "req_level2":                "Req_Level2",
    "min_years_experience2":     "Min_Years_Experience2",
    "tags_keywords":             "Keywords",
    "eligible_service":          "Eligible_Service",
    "essential_qualification":   "Essential_Qualification",
    "no_of_posts":               "No_of_Posts",
    "deputation_period_years":   "Deputation_Period_Years",
    "deputation_type":           "Deputation_Type",
    "notification_date":         "Notification_Date",
    "last_date_to_apply":        "Last_Date_To_Apply",
    "official_notification_link": "Official_Notification_Link",
    "application_form_link":     "Application_Form_Link",
    "source_website":            "Source_Website",
    "functional_area":           "Functional_Area",
    "mode_of_application":       "Mode_of_Application",
    # pipeline / provenance — also needed downstream
    "status":                    "Status",
    "source_category":           "Source Category",
    "source_ref":                "Source_Ref",
    "confidence":                "Confidence",
    "ingest_job_id":             "Ingest_Job_ID",
    # Two-stage approval (0017_admin_verified.sql): false means the row was
    # published in bulk and no admin has read it yet. The dashboard shows a
    # "pending verification" hint on those, so the flag has to reach the
    # bundled JSON too — NIC users are served from that file, not from the API.
    "admin_verified":            "Admin_Verified",
}


def fetch_supabase_rows(supabase_url: str, supabase_anon_key: str) -> list[dict[str, str]]:
    """Read approved vacancies from Supabase REST. RLS already limits anon to
    status='approved' rows, so the anon key works. Returns rows in Title_Case
    shape (mapped from snake_case) plus a synthetic 'DRAFT / APPROVED' column
    set to 'Approved ✅' so transform_rows() accepts them."""
    api = supabase_url.rstrip("/") + "/rest/v1/vacancies"
    qs = "status=eq.approved&select=*&limit=1000"
    req = urllib.request.Request(
        api + "?" + qs,
        headers={
            "apikey": supabase_anon_key,
            "Authorization": "Bearer " + supabase_anon_key,
            "Accept-Profile": "public",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    sb_rows = json.loads(body) if body else []
    if not isinstance(sb_rows, list):
        raise RuntimeError(f"Supabase returned non-list payload: {type(sb_rows).__name__}")

    mapped: list[dict[str, str]] = []
    for sb_row in sb_rows:
        row: dict[str, str] = {"DRAFT / APPROVED": "Approved ✅"}
        for snake, title in SUPABASE_TO_TITLE_MAP.items():
            val = sb_row.get(snake)
            row[title] = "" if val is None else str(val)
        # status field maps to its own Title_Case column via the map above; but
        # Supabase's status is the pipeline state ("approved") not the
        # display status ("Active"/"Inactive"). Clear it so transform_rows()'s
        # infer_status() recomputes from days_left instead.
        row["Status"] = ""
        mapped.append(row)
    return mapped


def validate_required_columns(rows: list[dict[str, str]]) -> None:
    if not rows:
        raise RuntimeError("No data rows found in the spreadsheet.")

    headers = set(rows[0].keys())
    missing = [col for col in REQUIRED_COLUMNS if col not in headers]
    if missing:
        raise RuntimeError(f"Missing required columns: {', '.join(missing)}")


def coerce_admin_verified(raw: Any) -> bool:
    """Normalise the two-stage-approval flag to a real bool for the JSON.

    The Supabase path stringifies the boolean on the way through
    (`str(val)` in fetch_supabase_rows), so it arrives as "True"/"False"; the
    legacy spreadsheet path has no such column at all.

    Absent means "this source does not track verification", which is treated as
    verified. Defaulting the other way would paint a "pending verification"
    hint on every row of a pre-0017 dataset — a scarier and more visible wrong
    answer than staying quiet.
    """
    if raw is None:
        return True
    if isinstance(raw, bool):
        return raw
    s = str(raw).strip().lower()
    if s == "":
        return True
    return s not in {"false", "0", "no", "f"}


def transform_rows(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    transformed: list[dict[str, Any]] = []

    for row in rows:
        approval_status = normalize_whitespace(row.get("DRAFT / APPROVED", ""))
        if not approval_status.lower().startswith("approved"):
            continue

        for col in TEXT_COLUMNS_TO_NORMALIZE:
            if col in row:
                row[col] = normalize_whitespace(row.get(col, ""))

        notification_date_iso = parse_date(row.get("Notification_Date", ""))
        last_date_iso = parse_date(row.get("Last_Date_To_Apply", ""))
        days_left = compute_days_left(last_date_iso)
        status = infer_status(row.get("Status", ""), days_left)
        location_label = build_location_label(row.get("Location_City", ""), row.get("Location_State", ""))
        eligibility_text = format_eligibility_text(row.get("Req_Level1", ""), row.get("Req_Level2", ""))
        eligibility_rules = build_eligibility_rules(row.get("Req_Level1", ""), row.get("Req_Level2", ""))
        delhi_ncr_flag = is_delhi_ncr(row.get("Location_City", ""), row.get("Location_State", ""))
        expired_flag = days_left is not None and days_left < 0
        closing_soon = days_left is not None and 0 <= days_left <= 15

        item: dict[str, Any] = dict(row)
        item["Official_Notification_Link"] = normalize_url(row.get("Official_Notification_Link", ""))
        item["Application_Form_Link"] = normalize_url(row.get("Application_Form_Link", ""))
        item["Notification_Date"] = notification_date_iso
        item["Notification_Date_Display"] = to_display_date(notification_date_iso)
        item["Last_Date_To_Apply"] = last_date_iso
        item["Last_Date_To_Apply_Display"] = to_display_date(last_date_iso)
        item["Days_Left"] = days_left if days_left is not None else ""
        item["Status"] = status
        item["location_label"] = location_label
        item["eligibility_text"] = eligibility_text
        item["eligibility_rules"] = eligibility_rules
        item["delhi_ncr_flag"] = delhi_ncr_flag
        item["expired_flag"] = expired_flag
        item["closing_soon"] = closing_soon
        item["Admin_Verified"] = coerce_admin_verified(row.get("Admin_Verified"))
        item["search_text"] = build_search_text(row)
        item["completeness_score"] = compute_completeness_score(row)
        item["data_quality_flag"] = compute_data_quality_flag(item["completeness_score"])

        transformed.append(item)

    transformed.sort(
        key=lambda x: (
            x["Days_Left"] if isinstance(x["Days_Left"], int) else 999999,
            safe_str(x.get("Post_Name", "")).lower(),
        )
    )
    return transformed


def build_filters(vacancies: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "levels": list_unique_sorted([safe_str(v.get("Level_Text", "")) for v in vacancies]),
        "ministries": list_unique_sorted([safe_str(v.get("Ministry", "")) for v in vacancies]),
        "locations": list_unique_sorted([safe_str(v.get("location_label", "")) for v in vacancies]),
        "statuses": list_unique_sorted([safe_str(v.get("Status", "")) for v in vacancies]),
        "myPayLevels": [f"Level {i}" for i in range(18, 0, -1)],
    }


def build_stats(vacancies: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(vacancies)
    active = sum(1 for v in vacancies if safe_str(v.get("Status", "")) == "Active")
    inactive = sum(1 for v in vacancies if safe_str(v.get("Status", "")) == "Inactive")
    closing_soon = sum(1 for v in vacancies if bool(v.get("closing_soon")))
    delhi_ncr = sum(1 for v in vacancies if bool(v.get("delhi_ncr_flag")))

    ministry_counts = (
        pd.Series([safe_str(v.get("Ministry", "")) for v in vacancies])
        .value_counts()
        .head(10)
        .to_dict()
    )

    location_counts = (
        pd.Series([safe_str(v.get("location_label", "")) for v in vacancies])
        .value_counts()
        .head(10)
        .to_dict()
    )

    level_counts = (
        pd.Series([safe_str(v.get("Level_Text", "")) for v in vacancies])
        .value_counts()
        .to_dict()
    )

    return {
        "total_vacancies": total,
        "active_vacancies": active,
        "inactive_vacancies": inactive,
        "closing_soon_vacancies": closing_soon,
        "delhi_ncr_vacancies": delhi_ncr,
        "top_ministries": ministry_counts,
        "top_locations": location_counts,
        "level_distribution": level_counts,
    }


def build_meta(vacancies: list[dict[str, Any]], filters: dict[str, Any], stats: dict[str, Any], source: str = "supabase_rest_api_via_anon_key") -> dict[str, Any]:
    return {
        "generated_at_utc": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "record_count": len(vacancies),
        "active_count": stats["active_vacancies"],
        "inactive_count": stats["inactive_vacancies"],
        "closing_soon_count": stats["closing_soon_vacancies"],
        "source": source,
        "filter_counts": {
            "levels": len(filters["levels"]),
            "ministries": len(filters["ministries"]),
            "locations": len(filters["locations"]),
            "statuses": len(filters["statuses"]),
        },
    }


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _rfc822(iso_date: str) -> str:
    """'2026-01-30' -> 'Fri, 30 Jan 2026 00:00:00 GMT' ('' when unparseable)."""
    try:
        return datetime.strptime(str(iso_date)[:10], "%Y-%m-%d").strftime(
            "%a, %d %b %Y 00:00:00 GMT"
        )
    except (ValueError, TypeError):
        return ""


def build_feed(vacancies: list) -> str:
    """RSS 2.0 feed of the newest active vacancies (review P1-5).

    Cheap alert channel for people who won't install the PWA: items deep-link
    to the dashboard modal via /?v=<Vacancy_ID> (already handled by app.js).
    """
    items = [v for v in vacancies if str(v.get("Status", "")).strip().lower() == "active"]
    items.sort(key=lambda v: str(v.get("Notification_Date") or ""), reverse=True)
    items = items[:30]

    now = datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")
    out = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        "<channel>",
        "<title>Deputations — new Central deputation vacancies</title>",
        f"<link>{SITE_URL}/</link>",
        "<description>Newest Central Government deputation vacancies from Employment News and official circulars.</description>",
        "<language>en-in</language>",
        f"<lastBuildDate>{now}</lastBuildDate>",
        f'<atom:link href="{SITE_URL}/feed.xml" rel="self" type="application/rss+xml"/>',
    ]
    for v in items:
        vid = str(v.get("Vacancy_ID") or "").strip()
        link = f"{SITE_URL}/?v={quote(vid)}" if vid else f"{SITE_URL}/"
        title_bits = [str(v.get("Post_Name") or "").strip() or "Vacancy"]
        if v.get("Ministry"):
            title_bits.append(str(v["Ministry"]).strip())
        desc_bits = []
        for label, key in (
            ("Level", "Level_Text"),
            ("Organisation", "Organisation"),
            ("Location", "Location_City"),
            ("Closes", "Last_Date_To_Apply"),
            ("Posts", "No_of_Posts"),
        ):
            val = str(v.get(key) or "").strip()
            if val:
                desc_bits.append(f"{label}: {val}")
        pub = _rfc822(v.get("Notification_Date") or "")
        out.append("<item>")
        out.append(f"<title>{escape(' — '.join(title_bits))}</title>")
        out.append(f"<link>{escape(link)}</link>")
        out.append(f'<guid isPermaLink="true">{escape(link)}</guid>')
        if pub:
            out.append(f"<pubDate>{pub}</pubDate>")
        out.append(f"<description>{escape(' · '.join(desc_bits))}</description>")
        out.append("</item>")
    out.append("</channel>")
    out.append("</rss>")
    return "\n".join(out) + "\n"


# AWS access key IDs, as GitHub's push protection matches them.
CREDENTIAL_RE = re.compile(r"(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}")


def assert_no_credentials(vacancies: list[dict[str, Any]]) -> None:
    """Refuse to write a dump that GitHub will reject at push time.

    `normalize_url()` already drops pre-signed links, but it only sees the two
    link columns. If a credential ever reaches the dump through some other
    field, the failure mode is genuinely nasty: the build "succeeds", the push
    is rejected by secret scanning, the workflow's retry loop swallows the
    error and still reports green, and the data silently stops updating. That
    is exactly what happened on 2026-08-10 and it cost a full debugging session
    to notice.

    So fail here instead, loudly, while the reason is still on screen.
    """
    offenders: list[str] = []
    for row in vacancies:
        for key, value in row.items():
            if isinstance(value, str) and CREDENTIAL_RE.search(value):
                offenders.append(f"{row.get('Vacancy_ID', '?')}.{key}")
    if offenders:
        raise RuntimeError(
            "Refusing to write the data dump: an AWS-style credential survived "
            "into these fields, and GitHub push protection would reject the "
            f"commit: {', '.join(offenders[:10])}"
            + (f" (+{len(offenders) - 10} more)" if len(offenders) > 10 else "")
            + ". If it arrived in a link, extend normalize_url(); otherwise "
            "clean the source row in Supabase."
        )


def main() -> None:
    # Source priority: Supabase (live, where admin approvals land) → Google
    # Sheet (legacy, where vacancies used to be hand-entered). Fall back only
    # when Supabase errors or returns zero rows; if Sheet is also unavailable
    # we raise so the cron fails loudly rather than shipping an empty dump.
    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_anon_key = os.getenv("SUPABASE_ANON_KEY", "").strip()

    rows: list[dict[str, str]] = []
    source_used = "(none)"

    if supabase_url and supabase_anon_key:
        try:
            sb_rows = fetch_supabase_rows(supabase_url, supabase_anon_key)
            if sb_rows:
                rows = sb_rows
                source_used = f"Supabase ({len(sb_rows)} approved rows)"
            else:
                print("Supabase returned 0 approved rows — falling back to Google Sheet.")
        except Exception as exc:
            print(f"Supabase fetch failed: {exc!r} — falling back to Google Sheet.")

    if not rows:
        sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
        if not sheet_id:
            raise RuntimeError(
                "No data: Supabase empty/unavailable AND GOOGLE_SHEET_ID is missing."
            )
        rows = fetch_sheet_rows(sheet_id)
        source_used = f"Google Sheet (sheet_id={sheet_id[:6]}…)"

    # Sheet rows still need the column-validation gate (no Supabase equivalent
    # because the schema is enforced at the DB layer). Skip when rows came
    # from Supabase.
    if source_used.startswith("Google Sheet"):
        validate_required_columns(rows)

    vacancies = transform_rows(rows)
    assert_no_credentials(vacancies)
    filters = build_filters(vacancies)
    stats = build_stats(vacancies)
    meta_source = (
        "supabase_rest_api_via_anon_key"
        if source_used.startswith("Supabase")
        else "private_google_sheet_via_sheets_api"
    )
    meta = build_meta(vacancies, filters, stats, source=meta_source)

    write_json(OUTPUT_VACANCIES, vacancies)
    write_json(OUTPUT_FILTERS, filters)
    write_json(OUTPUT_STATS, stats)
    write_json(OUTPUT_META, meta)
    OUTPUT_FEED.write_text(build_feed(vacancies), encoding="utf-8")

    print(f"Built {len(vacancies)} approved vacancies from {source_used}.")
    print(f"Wrote: {OUTPUT_VACANCIES}")
    print(f"Wrote: {OUTPUT_FILTERS}")
    print(f"Wrote: {OUTPUT_STATS}")
    print(f"Wrote: {OUTPUT_META}")
    print(f"Wrote: {OUTPUT_FEED}")


if __name__ == "__main__":
    main()
