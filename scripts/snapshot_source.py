"""Narrow REST reads shared by the scheduled check and the full exporter."""
import gzip
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ALIAS_FILE = Path(__file__).resolve().parents[1] / "data" / "vacancy-aliases.json"
REVISION_COLUMNS = ("id", "vacancy_id", "updated_at", "created_at")


def read_rows(url, key, table, columns, order, filters=None):
    base = url.rstrip("/")
    parts = urllib.parse.urlsplit(base)
    if parts.scheme != "https" or not parts.hostname:
        raise RuntimeError("SUPABASE_URL must be an HTTPS origin")
    params = dict(filters or {}, select=",".join(columns), order=order, limit=1000)
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Accept-Profile": "public",
               "Accept-Encoding": "gzip", "Prefer": "count=exact"}
    rows = []
    expected = None
    received = 0
    budget = int(os.getenv("SNAPSHOT_MAX_TRANSFER_BYTES", "10000000"))
    while True:
        query = urllib.parse.urlencode(dict(params, offset=len(rows)))
        req = urllib.request.Request(f"{base}/rest/v1/{table}?{query}", headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            total = response.headers.get("Content-Range", "").rpartition("/")[2]
            if not total.isdigit():
                raise RuntimeError("Missing exact export count")
            if expected is not None and int(total) != expected:
                raise RuntimeError("Dataset changed while exporting")
            expected = int(total)
            wire = response.read(budget - received + 1)
            received += len(wire)
            if received > budget:
                raise RuntimeError("Snapshot transfer budget exceeded")
            if response.headers.get("Content-Encoding") == "gzip":
                wire = gzip.decompress(wire)
        page = json.loads(wire)
        if not isinstance(page, list):
            raise RuntimeError(f"Invalid response for {table}")
        rows.extend(page)
        if len(rows) == expected:
            print(f"{table}: {len(rows)} rows; {received} response bytes received")
            return rows
        if len(rows) > expected or len(page) < params["limit"]:
            raise RuntimeError("Partial export; last good publication retained")


def approved_rows(url, key, columns):
    return read_rows(url, key, "vacancies", columns, "id.asc", {"status": "eq.approved"})


def fetch_vacancy_id_aliases(url, key):
    try:
        rows = read_rows(url, key, "vacancy_id_aliases", ("old_id", "new_id"), "old_id.asc")
    except urllib.error.HTTPError as exc:
        # Before 0027 an empty map is normal. Once aliases have been
        # published, a missing relation must never erase those redirects.
        if exc.code == 404 and json.load(exc).get("code") in {"42P01", "PGRST205"}:
            if not ALIAS_FILE.exists() or not json.loads(ALIAS_FILE.read_text(encoding="utf-8"))["aliases"]:
                return {}
        raise
    aliases = {r["old_id"]: r["new_id"] for r in rows}
    if len(aliases) != len(rows) or any(not k or not v for k, v in aliases.items()):
        raise RuntimeError("Invalid or duplicate vacancy alias")
    return aliases


def source_digest(rows, aliases):
    # Both callers read in primary-key order. Hash the actual export rows, never
    # a preflight timestamp that could get ahead of the downloaded payload.
    revisions = []
    seen = set()
    for row in rows:
        row_id = row["id"]
        if not row_id or row_id in seen or not row["vacancy_id"]:
            raise RuntimeError("Missing or duplicate vacancy identity")
        seen.add(row_id)
        stamp = row["updated_at"] or row["created_at"]
        instant = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if instant.tzinfo is None:
            raise ValueError("Vacancy revision has no time zone")
        revisions.append((row_id, row["vacancy_id"], instant.astimezone(timezone.utc).isoformat()))
    payload = json.dumps([revisions, sorted(aliases.items())], separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def live_digest(url, key):
    return source_digest(approved_rows(url, key, REVISION_COLUMNS), fetch_vacancy_id_aliases(url, key))
