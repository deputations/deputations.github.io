import json
import os
from io import StringIO
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse

import pandas as pd
import requests
from dateutil import parser


DATA_DIR = Path("data")
DATA_DIR.mkdir(exist_ok=True)

SHEET_CSV_URL = os.getenv("SHEET_CSV_URL", "").strip()

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

DELHI_NCR_KEYWORDS = {
    "delhi",
    "new delhi",
    "ncr",
    "noida",
    "greater noida",
    "gurugram",
    "gurgaon",
    "ghaziabad",
    "faridabad",
}


def safe_str(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def normalize_whitespace(text: str) -> str:
    return " ".join(safe_str(text).split())


def safe_int(value):
    text = safe_str(value)
    if not text:
        return None
    try:
        return int(float(text))
    except Exception:
        return None


def parse_date(value):
    text = safe_str(value)
    if not text:
        return None
    try:
        dt = parser.parse(text, dayfirst=False, fuzzy=True)
        return dt.date()
    except Exception:
        return None


def to_iso(date_obj):
    return date_obj.isoformat() if date_obj else None


def normalize_text_for_search(text: str) -> str:
    text = normalize_whitespace(text).lower()
    cleaned = []
    for ch in text:
        if ch.isalnum() or ch.isspace():
            cleaned.append(ch)
        else:
            cleaned.append(" ")
    return " ".join("".join(cleaned).split())


def normalize_url(url: str) -> str:
    url = safe_str(url)
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    if url.startswith("www."):
        return f"https://{url}"
    return url


def is_valid_url(url: str) -> bool:
    url = safe_str(url)
    if not url:
        return False
    try:
        parsed = urlparse(url)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)
    except Exception:
        return False


def split_keywords_text(value: str) -> str:
    text = safe_str(value)
    if not text:
        return ""
    for sep in ["|", ";", "/"]:
        text = text.replace(sep, ",")
    parts = [p.strip() for p in text.split(",") if p.strip()]
    return ", ".join(parts)


def compute_delhi_ncr(city: str, state: str, location_label: str) -> bool:
    text = normalize_text_for_search(" ".join([city, state, location_label]))
    return any(keyword in text for keyword in DELHI_NCR_KEYWORDS)


def build_eligibility_text(req1, req2):
    if req1 is not None and req2 is not None:
        if req1 == req2:
            return f"Level {req1}"
        return f"Level {min(req1, req2)} to Level {max(req1, req2)}"
    if req1 is not None:
        return f"Level {req1}"
    if req2 is not None:
        return f"Level {req2}"
    return "Not specified"


def build_eligibility_rules(req1, exp1, req2, exp2):
    rules = []
    if req1 is not None:
        rules.append({
            "level": req1,
            "min_years_experience": exp1 or 0
        })
    if req2 is not None:
        rules.append({
            "level": req2,
            "min_years_experience": exp2 or 0
        })
    return rules


def compute_completeness_score(record):
    score = 100

    if not record["Official_Notification_Link"]:
        score -= 20
    if not record["Application_Form_Link"]:
        score -= 10
    if not record["Last_Date_To_Apply"]:
        score -= 20
    if not record["Location_Label"]:
        score -= 10
    if record["Eligibility_Text"] == "Not specified":
        score -= 15
    if not record["Ministry"]:
        score -= 15
    if not record["Post_Name"]:
        score -= 15

    return max(score, 0)


def compute_data_quality_flag(record):
    flags = []

    if not record["Official_Notification_Link"]:
        flags.append("MISSING_NOTIFICATION_LINK")
    if not record["Application_Form_Link"]:
        flags.append("MISSING_APPLY_LINK")
    if not record["Last_Date_To_Apply"]:
        flags.append("MISSING_LAST_DATE")
    if record["Eligibility_Text"] == "Not specified":
        flags.append("MISSING_ELIGIBILITY")

    if not flags:
        return "OK"
    if len(flags) == 1:
        return flags[0]
    return "REVIEW_REQUIRED"


def require_columns(df: pd.DataFrame):
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")


def load_sheet_df() -> pd.DataFrame:
    if not SHEET_CSV_URL:
        raise ValueError("SHEET_CSV_URL is not set")

    response = requests.get(SHEET_CSV_URL, timeout=60)
    response.raise_for_status()

    df = pd.read_csv(StringIO(response.text), dtype=str).fillna("")
    require_columns(df)
    return df


def build_records(df: pd.DataFrame):
    today = datetime.now(timezone.utc).date()
    records = []

    for _, row in df.iterrows():
        approval_status = normalize_whitespace(row.get("DRAFT / APPROVED", ""))
        approval_normalized = approval_status.lower()

        if not approval_normalized.startswith("approved"):
            continue

        vacancy_id = normalize_whitespace(row.get("Vacancy_ID", ""))
        if not vacancy_id:
            continue

        ministry = normalize_whitespace(row.get("Ministry", ""))
        min_code = normalize_whitespace(row.get("Min_Code", ""))
        department = normalize_whitespace(row.get("Department", ""))
        organisation = normalize_whitespace(row.get("Organisation", ""))
        post_name = normalize_whitespace(row.get("Post_Name", ""))

        level = safe_int(row.get("Level"))
        level_text = normalize_whitespace(row.get("Level_Text", ""))

        city = normalize_whitespace(row.get("Location_City", ""))
        state = normalize_whitespace(row.get("Location_State", ""))
        region = normalize_whitespace(row.get("Region", ""))
        location_label = ", ".join([x for x in [city, state] if x])

        req1 = safe_int(row.get("Req_Level1"))
        req2 = safe_int(row.get("Req_Level2"))
        exp1 = safe_int(row.get("Min_Years_Experience"))
        exp2 = safe_int(row.get("Min_Years_Experience2"))

        eligibility_text = build_eligibility_text(req1, req2)
        eligibility_rules = build_eligibility_rules(req1, exp1, req2, exp2)

        notification_date = parse_date(row.get("Notification_Date"))
        last_date = parse_date(row.get("Last_Date_To_Apply"))

        sheet_days_left = safe_int(row.get("Days_Left"))
        if last_date is not None:
            days_left = (last_date - today).days
        else:
            days_left = sheet_days_left

        status = "Inactive" if days_left is not None and days_left < 0 else "Active"
        closing_soon = bool(days_left is not None and 0 <= days_left < 15)
        expired_flag = bool(days_left is not None and days_left < 0)
        delhi_ncr_flag = compute_delhi_ncr(city, state, location_label)

        official_notification_link = normalize_url(row.get("Official_Notification_Link", ""))
        if not is_valid_url(official_notification_link):
            official_notification_link = ""

        application_form_link = normalize_url(row.get("Application_Form_Link", ""))
        if not is_valid_url(application_form_link):
            application_form_link = ""

        source_website = normalize_url(row.get("Source_Website", ""))
        if not is_valid_url(source_website):
            source_website = ""

        record = {
            "Vacancy_ID": vacancy_id,
            "Ministry": ministry,
            "Min_Code": min_code,
            "Department": department,
            "Department_Organisation": organisation,
            "Organisation": organisation,
            "Post_Name": post_name,
            "Level": level,
            "Level_Text": level_text,
            "Location_City": city,
            "Location_State": state,
            "Region": region,
            "Req_Level1": req1,
            "Min_Years_Experience": exp1,
            "Organisation_Type": normalize_whitespace(row.get("Organisation_Type", "")),
            "Req_Level2": req2,
            "Min_Years_Experience2": exp2,
            "Tags_Keywords": split_keywords_text(row.get("Tags_Keywords", "")),
            "Eligible_Service": normalize_whitespace(row.get("Eligible_Service", "")),
            "Essential_Qualification": normalize_whitespace(row.get("Essential_Qualification", "")),
            "No_of_Posts": safe_int(row.get("No_of_Posts")),
            "Deputation_Period_Years": safe_int(row.get("Deputation_Period_Years")),
            "Deputation_Type": normalize_whitespace(row.get("Deputation_Type", "")),
            "Notification_Date": to_iso(notification_date),
            "Last_Date_To_Apply": to_iso(last_date),
            "Days_Left": days_left,
            "Status": status,
            "Closing_Soon": closing_soon,
            "Official_Notification_Link": official_notification_link,
            "Application_Form_Link": application_form_link,
            "Source_Website": source_website,
            "Functional_Area": normalize_whitespace(row.get("Functional_Area", "")),
            "Mode_of_Application": normalize_whitespace(row.get("Mode_of_Application", "")),
            "DRAFT_APPROVED": approval_status,
            "Source_File": normalize_whitespace(row.get("Source File", "")),
            "Source_Category": normalize_whitespace(row.get("Source Category", "")),
            "Location_Label": location_label,
            "Eligibility_Text": eligibility_text,
            "Eligibility_Rules": eligibility_rules,
            "Delhi_NCR_Flag": delhi_ncr_flag,
            "Expired_Flag": expired_flag,
        }

        search_parts = [
            ministry,
            department,
            organisation,
            post_name,
            level_text,
            city,
            state,
            record["Eligible_Service"],
            record["Essential_Qualification"],
            record["Functional_Area"],
            record["Tags_Keywords"],
            eligibility_text,
        ]

        record["Search_Text"] = normalize_text_for_search(" ".join([p for p in search_parts if p]))
        record["Completeness_Score"] = compute_completeness_score(record)
        record["Data_Quality_Flag"] = compute_data_quality_flag(record)

        records.append(record)

    return records


def make_count_list(values, key_name="value", extra_transform=None):
    counts = {}
    for v in values:
        if v is None:
            continue
        v = safe_str(v)
        if not v:
            continue
        counts[v] = counts.get(v, 0) + 1

    items = []
    for value, count in sorted(counts.items(), key=lambda x: x[0]):
        item = {key_name: value, "count": count}
        if extra_transform:
            item.update(extra_transform(value))
        items.append(item)
    return items


def build_filters(records):
    levels = make_count_list([r["Level_Text"] for r in records])

    ministry_counts = {}
    ministry_codes = {}
    for r in records:
        ministry = r["Ministry"]
        if not ministry:
            continue
        ministry_counts[ministry] = ministry_counts.get(ministry, 0) + 1
        if r["Min_Code"]:
            ministry_codes[ministry] = r["Min_Code"]

    ministries = [
        {
            "value": ministry,
            "count": ministry_counts[ministry],
            "min_code": ministry_codes.get(ministry, "")
        }
        for ministry in sorted(ministry_counts.keys())
    ]

    location_map = {}
    for r in records:
        loc = r["Location_Label"]
        if not loc:
            continue
        if loc not in location_map:
            location_map[loc] = {
                "value": loc,
                "count": 0,
                "state": r["Location_State"],
                "region": r["Region"]
            }
        location_map[loc]["count"] += 1

    locations = [location_map[k] for k in sorted(location_map.keys())]

    return {
        "levels": levels,
        "ministries": ministries,
        "locations": locations,
        "regions": make_count_list([r["Region"] for r in records]),
        "organisation_types": make_count_list([r["Organisation_Type"] for r in records]),
        "deputation_types": make_count_list([r["Deputation_Type"] for r in records]),
        "mode_of_application": make_count_list([r["Mode_of_Application"] for r in records]),
        "quick_filter_counts": {
            "closing7": sum(1 for r in records if r["Days_Left"] is not None and 0 <= r["Days_Left"] <= 7),
            "closingToday": sum(1 for r in records if r["Days_Left"] == 0),
            "delhiNcr": sum(1 for r in records if r["Delhi_NCR_Flag"]),
            "onlineOnly": sum(1 for r in records if safe_str(r["Mode_of_Application"]).lower() == "online"),
        }
    }


def build_stats(records):
    region_counts = {}
    ministry_counts = {}
    location_counts = {}
    level_counts = {}

    for r in records:
        if r["Region"]:
            region_counts[r["Region"]] = region_counts.get(r["Region"], 0) + 1
        if r["Ministry"]:
            ministry_counts[r["Ministry"]] = ministry_counts.get(r["Ministry"], 0) + 1
        if r["Location_Label"]:
            location_counts[r["Location_Label"]] = location_counts.get(r["Location_Label"], 0) + 1
        if r["Level"] is not None:
            level_counts[r["Level"]] = level_counts.get(r["Level"], 0) + 1

    return {
        "kpis": {
            "total_vacancies": len(records),
            "active": sum(1 for r in records if r["Status"] == "Active"),
            "closing_soon": sum(1 for r in records if r["Closing_Soon"]),
            "ministries": len({r["Ministry"] for r in records if r["Ministry"]}),
            "locations": len({r["Location_Label"] for r in records if r["Location_Label"]}),
            "online_applications": sum(1 for r in records if safe_str(r["Mode_of_Application"]).lower() == "online"),
        },
        "level_distribution": [
            {"level": level, "count": level_counts[level]}
            for level in sorted(level_counts.keys())
        ],
        "region_distribution": [
            {"region": region, "count": count}
            for region, count in sorted(region_counts.items(), key=lambda x: x[0])
        ],
        "top_ministries": [
            {"ministry": ministry, "count": count}
            for ministry, count in sorted(ministry_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        ],
        "top_locations": [
            {"location": location, "count": count}
            for location, count in sorted(location_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        ],
        "deadline_buckets": {
            "today": sum(1 for r in records if r["Days_Left"] == 0),
            "within_3_days": sum(1 for r in records if r["Days_Left"] is not None and 0 <= r["Days_Left"] <= 3),
            "within_7_days": sum(1 for r in records if r["Days_Left"] is not None and 0 <= r["Days_Left"] <= 7),
            "within_15_days": sum(1 for r in records if r["Days_Left"] is not None and 0 <= r["Days_Left"] <= 15),
            "after_15_days": sum(1 for r in records if r["Days_Left"] is not None and r["Days_Left"] > 15),
        }
    }


def build_meta(df, records):
    now = datetime.now(timezone.utc)
    approved_count = len(records)
    total_rows = len(df)
    draft_count = max(total_rows - approved_count, 0)

    return {
        "schema_version": "1.0.0",
        "generated_at_utc": now.isoformat().replace("+00:00", "Z"),
        "source_type": "google_sheet_csv",
        "source_url_present": bool(SHEET_CSV_URL),
        "record_count_total": total_rows,
        "record_count_approved": approved_count,
        "record_count_draft": draft_count,
        "record_count_active": sum(1 for r in records if r["Status"] == "Active"),
        "record_count_inactive": sum(1 for r in records if r["Status"] == "Inactive"),
        "record_count_review_flagged": sum(1 for r in records if r["Data_Quality_Flag"] != "OK"),
    }


def write_json(filename: str, payload):
    path = DATA_DIR / filename
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)


def main():
    df = load_sheet_df()
    records = build_records(df)
    filters = build_filters(records)
    stats = build_stats(records)
    meta = build_meta(df, records)

    write_json("vacancies.json", records)
    write_json("filters.json", filters)
    write_json("stats.json", stats)
    write_json("meta.json", meta)

    print(f"Built {len(records)} approved vacancy records.")


if __name__ == "__main__":
    main()
