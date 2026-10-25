#!/usr/bin/env python3
"""Cheaply decide whether the public vacancy snapshot needs rebuilding."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "vacancies-manifest.json"


def instant(value: str | None) -> datetime:
    text = str(value or "").strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def needs_rebuild(live_updated_at: str, published_updated_at: str, force: bool = False) -> bool:
    return force or instant(live_updated_at) > instant(published_updated_at)


def latest_database_update(base_url: str, service_key: str) -> str:
    base = base_url.rstrip("/")
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "https" or not parsed.hostname:
        raise RuntimeError("SUPABASE_URL must be an HTTPS origin")
    query = urllib.parse.urlencode({"select": "updated_at", "order": "updated_at.desc", "limit": "1"})
    request = urllib.request.Request(
        f"{base}/rest/v1/vacancies?{query}",
        headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        rows = json.load(response)
    if not isinstance(rows, list) or not rows or not rows[0].get("updated_at"):
        raise RuntimeError("Could not read the latest vacancy update timestamp")
    return rows[0]["updated_at"]


def main() -> None:
    base_url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not base_url or not service_key:
        raise RuntimeError("Snapshot staleness check requires Supabase publisher credentials")
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    published = manifest.get("vacancies_updated_at_utc")
    if not published:
        raise RuntimeError("Published manifest has no database update timestamp")
    live = latest_database_update(base_url, service_key)
    force = os.environ.get("FORCE_BUILD", "").lower() in {"1", "true", "yes"}
    changed = needs_rebuild(live, published, force)
    result = {"changed": changed, "force": force, "live_updated_at": live, "published_updated_at": published}
    print(json.dumps(result, separators=(",", ":")))
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as stream:
            stream.write(f"changed={'true' if changed else 'false'}\n")
            stream.write(f"live_updated_at={live}\n")


if __name__ == "__main__":
    main()
