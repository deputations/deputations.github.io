#!/usr/bin/env python3
"""Cheaply decide whether the public vacancy snapshot needs rebuilding."""
import json
import os
from pathlib import Path

from snapshot_source import live_digest


ROOT = Path(__file__).resolve().parents[1]
META = ROOT / "data" / "meta.json"


def main():
    force = os.environ.get("FORCE_BUILD", "").lower() in {"1", "true", "yes"}
    meta = json.loads(META.read_text(encoding="utf-8")) if META.exists() else {}
    published = meta.get("approved_source_sha256")
    # Forced runs and the first deployment need the full export anyway.
    if force or not published:
        changed = True
    else:
        live = live_digest(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])
        changed = live != published
    print(json.dumps({"changed": changed, "force": force, "bootstrap": not published}))
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as stream:
            stream.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    main()
