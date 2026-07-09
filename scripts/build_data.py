import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote
from xml.sax.saxutils import escape

import pandas as pd
from dateutil import parser as date_parser
from google.auth import default
from googleapiclient.discovery import build


DATA_DIR = Path("data")
OUTPUT_VACANCIES = DATA_DIR / "vacancies.json"
OUTPUT_FILTERS = DATA_DIR / "filters.json"
OUTPUT_STATS = DATA_DIR / "stats.json"
OUTPUT_META = DATA_DIR / "meta.json"
OUTPUT_FEED = Path("feed.xml")          # site root, next to sitemap.xml
SITE_URL = "https://deputations.github.io"

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


def normalize_url(value: Any) -> str:
    text = safe_str(value)
    if not text:
        return ""
    lowered = text.lower()
    if lowered in {"-", "—", "na", "n/a", "null", "undefined"}:
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


def validate_required_columns(rows: list[dict[str, str]]) -> None:
    if not rows:
        raise RuntimeError("No data rows found in the spreadsheet.")

    headers = set(rows[0].keys())
    missing = [col for col in REQUIRED_COLUMNS if col not in headers]
    if missing:
        raise RuntimeError(f"Missing required columns: {', '.join(missing)}")


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


def build_meta(vacancies: list[dict[str, Any]], filters: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    return {
        "generated_at_utc": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "record_count": len(vacancies),
        "active_count": stats["active_vacancies"],
        "inactive_count": stats["inactive_vacancies"],
        "closing_soon_count": stats["closing_soon_vacancies"],
        "source": "private_google_sheet_via_sheets_api",
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


def main() -> None:
    sheet_id = os.getenv("GOOGLE_SHEET_ID", "").strip()
    if not sheet_id:
        raise RuntimeError("GOOGLE_SHEET_ID environment variable is missing.")

    rows = fetch_sheet_rows(sheet_id)
    validate_required_columns(rows)

    vacancies = transform_rows(rows)
    filters = build_filters(vacancies)
    stats = build_stats(vacancies)
    meta = build_meta(vacancies, filters, stats)

    write_json(OUTPUT_VACANCIES, vacancies)
    write_json(OUTPUT_FILTERS, filters)
    write_json(OUTPUT_STATS, stats)
    write_json(OUTPUT_META, meta)
    OUTPUT_FEED.write_text(build_feed(vacancies), encoding="utf-8")

    print(f"Built {len(vacancies)} approved vacancies.")
    print(f"Wrote: {OUTPUT_VACANCIES}")
    print(f"Wrote: {OUTPUT_FILTERS}")
    print(f"Wrote: {OUTPUT_STATS}")
    print(f"Wrote: {OUTPUT_META}")
    print(f"Wrote: {OUTPUT_FEED}")


if __name__ == "__main__":
    main()
