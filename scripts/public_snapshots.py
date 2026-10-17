"""Validated public artifacts. No credentials, database clients, or optional enrichment.

The manifest is the commit point: immutable shards are installed first, then the
stable manifest pointer. Never garbage-collect old versions during publication.
"""
import hashlib
import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

IST = timezone(timedelta(hours=5, minutes=30))
PUBLIC_FIELDS = set("""Vacancy_ID Ministry Min_Code Department Organisation Organisation_Type
Post_Name Level Level_Text Location_City Location_State Region Req_Level1 Req_Level2
Min_Years_Experience Min_Years_Experience2 Keywords Eligible_Service Essential_Qualification
Additional_Details No_of_Posts Deputation_Period_Years Deputation_Type Notification_Date
Last_Date_To_Apply Official_Notification_Link Application_Form_Link Source_Website
Functional_Area Mode_of_Application Status Source_Ref Source_Page Detailed_Eligibility
Admin_Verified Notification_Date_Display Last_Date_To_Apply_Display Days_Left
location_label eligibility_text eligibility_rules eligibility_tiers delhi_ncr_flag
expired_flag closing_soon search_text completeness_score data_quality_flag
Location_Assumed location_scope""".split()) | {"Source Category"}


def iso_date(value):
    try:
        return date.fromisoformat(str(value).strip())
    except (ValueError, TypeError):
        return None


def status_row(row, today=None):
    today = today or datetime.now(IST).date()
    result = {k: v for k, v in row.items() if k in PUBLIC_FIELDS}
    deadline = iso_date(row.get("Last_Date_To_Apply"))
    notification = iso_date(row.get("Notification_Date"))
    days = (deadline - today).days if deadline else None
    # Preserve the owner's 60-day undated-notification rule (HANDOVER 2026-10-11).
    status = ("Active" if days >= 0 else "Inactive") if days is not None else (
        "Active" if notification and 0 <= (today - notification).days <= 60 else "Unknown")
    result.update(Status=status, Days_Left=days if days is not None else "",
                  expired_flag=days is not None and days < 0,
                  closing_soon=days is not None and 0 <= days <= 15)
    return result


def encoded(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def validate(rows, previous_count=0, allow_large_change=False):
    if not rows:
        raise ValueError("Empty export: keep the last good publication; validate intentional removal separately")
    ids = [str(r.get("Vacancy_ID", "")).strip() for r in rows]
    if any(not i for i in ids) or len(set(ids)) != len(ids):
        raise ValueError("Missing or duplicate Vacancy_ID: publication refused")
    if any(not str(r.get("Post_Name", "")).strip() for r in rows):
        raise ValueError("Missing Post_Name: publication refused")
    if previous_count and len(rows) < previous_count * .75 and not allow_large_change:
        raise ValueError("Export lost more than 25% of records; inspect before allowing a large change")
    for row in rows:
        if set(row) - PUBLIC_FIELDS:
            raise ValueError("Internal fields in public snapshot")
        if any("access_token=" in str(v) or "refresh_token=" in str(v) or "X-Amz-Signature=" in str(v) for v in row.values()):
            raise ValueError("Credential-bearing URL in public snapshot")


def atomic_write(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp")
    try:
        temp.write_bytes(body)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def publish(rows, data_dir, source_updated_at=None, *, today=None, allow_large_change=False,
            metadata=None, extras=None):
    data_dir = Path(data_dir)
    previous = {}
    pointer = data_dir / "vacancies-manifest.json"
    if pointer.exists():
        previous = json.loads(pointer.read_text(encoding="utf-8"))
    elif (data_dir / "vacancies.json").exists():
        previous["record_count"] = len(json.loads((data_dir / "vacancies.json").read_text(encoding="utf-8")))
    rows = [status_row(r, today) for r in rows]
    validate(rows, previous.get("record_count", 0), allow_large_change)
    all_bytes = encoded(rows)
    version = hashlib.sha256(all_bytes).hexdigest()[:20]
    base = f"snapshots/{version}"
    current = [r for r in rows if r["Status"] != "Inactive"]
    buckets = {}
    for row in rows:
        if row["Status"] == "Inactive":
            bucket = hashlib.sha256(row["Vacancy_ID"].encode()).hexdigest()[0]
            buckets.setdefault(bucket, []).append(row)
    artifacts = {"current": (f"{base}/current.json", current)}
    artifacts.update({key: (f"{base}/archive-{key}.json", value) for key, value in buckets.items()})
    descriptors = {}
    for key, (relative, values) in artifacts.items():
        body = encoded(values)
        descriptors[key] = {"path": relative, "sha256": hashlib.sha256(body).hexdigest(),
                            "bytes": len(body), "count": len(values)}
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    manifest = {"schema": 1, "version": version, "generated_at_utc": generated,
                "vacancies_updated_at_utc": source_updated_at, "record_count": len(rows),
                "active_count": sum(r["Status"] == "Active" for r in rows),
                "inactive_count": len(rows) - len(current), "current": descriptors.pop("current"),
                "archive": descriptors,
                "index": {r["Vacancy_ID"]: key for key, values in buckets.items() for r in values}}
    # Construct/validate every payload before touching any published files.
    prepared = [(data_dir / relative, encoded(values)) for relative, values in artifacts.values()]
    prepared.append((data_dir / "vacancies.json", all_bytes))  # old clients/feeds remain compatible
    meta = dict(metadata or {})
    meta.update(generated_at_utc=generated, vacancies_updated_at_utc=source_updated_at,
                record_count=len(rows), active_count=manifest["active_count"],
                inactive_count=manifest["inactive_count"], source="supabase_verified_snapshot")
    prepared.append((data_dir / "meta.json", encoded(meta)))
    prepared.extend((Path(path), encoded(value)) for path, value in (extras or {}).items())
    for path, body in prepared:
        atomic_write(path, body)
    atomic_write(pointer, encoded(manifest))
    return manifest
