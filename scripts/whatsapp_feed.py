#!/usr/bin/env python3
"""whatsapp_feed.py — engine-agnostic core for the WhatsApp Channel auto-poster.

Decides *what* to post; a separate engine (whatsapp_watcher.py or the Claude
Chrome-extension flow) decides *how*. This script never touches a browser.

It loads the live approved + active deputation vacancies (Supabase primary,
data/vacancies.json fallback), diffs them against a small ledger keyed by the
stable Vacancy_ID, and formats each genuinely-new row into the WhatsApp message.

Modes
  --seed            Mark every current Vacancy_ID as already posted, without
                    sending. Run once at setup so the existing rows never blast
                    the channel. Prints how many were seeded.
  --list-pending    (default) Print a JSON array [{vacancy_id, message}, ...]
                    of approved+active rows not yet in the ledger.
  --mark-posted ID  Append one or more IDs to the ledger. Call this only AFTER
                    a send is confirmed, so a crash mid-run never double-posts.

Source selection
  --source auto|supabase|json   (default auto: try Supabase, fall back to JSON)

The ledger lives at data/whatsapp_posted.json (local state, git-ignored).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

try:
    import requests
except ImportError:  # requests ships in scripts/requirements.txt
    requests = None

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
DATA_DIR = REPO_ROOT / "data"
CONFIG_JS = REPO_ROOT / "config.js"
VACANCIES_JSON = DATA_DIR / "vacancies.json"
LEDGER_PATH = DATA_DIR / "whatsapp_posted.json"

SITE_BASE = "deputations.github.io"  # WhatsApp linkifies a bare domain


# ---------------------------------------------------------------------------
# Light enrichment helpers — mirror enrich.js so messages match the site.
# We only compute the handful of fields the message needs.
# ---------------------------------------------------------------------------
def norm(v) -> str:
    if v is None:
        return ""
    return re.sub(r"\s+", " ", str(v).replace(" ", " ")).strip()


def parse_level(v):
    m = re.search(r"(\d+)", norm(v))
    return int(m.group(1)) if m else None


def parse_date_iso(v) -> str:
    """Accept ISO, dd/mm/yyyy, dd-mm-yyyy. Day-first. Returns 'YYYY-MM-DD' or ''."""
    t = norm(v)
    if not t:
        return ""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$", t)
    if m:
        d, mo, y = m.group(1), m.group(2), m.group(3)
        if len(y) == 2:
            y = "20" + y
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    return t  # leave as-is if unparseable


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def to_display_date(iso: str) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso or "")
    if not m:
        return iso or ""
    return f"{m.group(3)} {_MONTHS[int(m.group(2)) - 1]} {m.group(1)}"


def compute_days_left(iso: str):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})$", iso or "")
    if not m:
        return None
    last = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return (last - date.today()).days


def build_location_label(city: str, state: str) -> str:
    city, state = norm(city), norm(state)
    if city and state:
        return f"{city}, {state}"
    return city or state


def format_eligibility_text(r1, r2) -> str:
    a, b = parse_level(r1), parse_level(r2)
    if a is not None and b is not None:
        return f"Level {a}" if a == b else f"Level {min(a, b)} to Level {max(a, b)}"
    if a is not None:
        return f"Level {a}"
    if b is not None:
        return f"Level {b}"
    return ""


def normalize_url(v) -> str:
    t = norm(v)
    if not t or t.lower() in ("-", "—", "na", "n/a", "null", "undefined"):
        return ""
    if re.match(r"^https?://", t, re.I):
        return t
    if re.match(r"^www\.", t, re.I):
        return "https://" + t
    return t


# ---------------------------------------------------------------------------
# Unified record. `normalize_row` flattens either source shape into the few
# fields the message and the active/approved gate need.
# ---------------------------------------------------------------------------
def normalize_from_json(row: dict) -> dict:
    """data/vacancies.json — already enriched (Title_Case + computed fields)."""
    last_iso = parse_date_iso(row.get("Last_Date_To_Apply"))
    days_left = row.get("Days_Left")
    if not isinstance(days_left, int):
        days_left = compute_days_left(last_iso)
    approved = "approved" in norm(row.get("DRAFT / APPROVED")).lower()
    status = norm(row.get("Status")) or (
        "Active" if (days_left is not None and days_left >= 0) else "Inactive"
    )
    return {
        "vacancy_id": norm(row.get("Vacancy_ID")),
        "post_name": norm(row.get("Post_Name")),
        "organisation": norm(row.get("Organisation")),
        "ministry": norm(row.get("Ministry")),
        "level_text": norm(row.get("Level_Text"))
        or (f"Level-{parse_level(row.get('Level'))}" if parse_level(row.get("Level")) is not None else ""),
        "eligibility_text": norm(row.get("eligibility_text"))
        or format_eligibility_text(row.get("Req_Level1"), row.get("Req_Level2")),
        "location_label": norm(row.get("location_label"))
        or build_location_label(row.get("Location_City"), row.get("Location_State")),
        "no_of_posts": norm(row.get("No_of_Posts")),
        "last_date_display": norm(row.get("Last_Date_To_Apply_Display")) or to_display_date(last_iso),
        "official_link": normalize_url(row.get("Official_Notification_Link")),
        "days_left": days_left,
        "approved": approved,
        "active": (days_left is not None and days_left >= 0) and status.lower() != "inactive",
        "id": "",  # JSON has no uuid
        # Collision-proof ledger key: Vacancy_IDs are NOT unique in the data, so
        # combine with the deadline + post name.
        "key": f"{norm(row.get('Vacancy_ID'))}|{last_iso}|{norm(row.get('Post_Name'))}",
    }


def normalize_from_supabase(row: dict) -> dict:
    """Supabase REST row — snake_case, status already == 'approved' (RLS)."""
    last_iso = parse_date_iso(row.get("last_date_to_apply"))
    days_left = compute_days_left(last_iso)
    return {
        "vacancy_id": norm(row.get("vacancy_id")),
        "post_name": norm(row.get("post_name")),
        "organisation": norm(row.get("organisation")),
        "ministry": norm(row.get("ministry")),
        "level_text": norm(row.get("level_text"))
        or (f"Level-{parse_level(row.get('level'))}" if parse_level(row.get("level")) is not None else ""),
        "eligibility_text": format_eligibility_text(row.get("req_level1"), row.get("req_level2")),
        "location_label": build_location_label(row.get("location_city"), row.get("location_state")),
        "no_of_posts": norm(row.get("no_of_posts")),
        "last_date_display": to_display_date(last_iso),
        "official_link": normalize_url(row.get("official_notification_link")),
        "days_left": days_left,
        "approved": norm(row.get("status")).lower() == "approved",
        # Active = approved AND not past the deadline.
        "active": days_left is not None and days_left >= 0,
        "id": norm(row.get("id")),  # Supabase uuid — globally unique
        # Prefer the uuid; fall back to a collision-proof composite (Vacancy_IDs
        # are NOT unique in the data, so combine with deadline + post name).
        "key": norm(row.get("id"))
        or f"{norm(row.get('vacancy_id'))}|{last_iso}|{norm(row.get('post_name'))}",
    }


def is_active_approved(nrow: dict) -> bool:
    return bool(nrow.get("approved")) and bool(nrow.get("active")) and bool(nrow.get("vacancy_id"))


# ---------------------------------------------------------------------------
# Message formatting — the locked rich template.
# ---------------------------------------------------------------------------
def format_message(nrow: dict) -> str:
    lines = ["\U0001F3DB️ *New Deputation Vacancy*", ""]

    post = nrow.get("post_name") or "Deputation post"
    posts_n = nrow.get("no_of_posts")
    head = f"\U0001F4CC *{post}*"
    if posts_n:
        try:
            n = int(re.sub(r"\D", "", posts_n) or "0")
        except ValueError:
            n = 0
        if n > 0:
            head += f"  •  {n} post{'s' if n != 1 else ''}"
    lines.append(head)

    if nrow.get("organisation"):
        lines.append(f"\U0001F3E2 {nrow['organisation']}")
    if nrow.get("ministry"):
        lines.append(f"\U0001F3DB️ {nrow['ministry']}")

    level_text = nrow.get("level_text")
    elig = nrow.get("eligibility_text")
    if level_text or elig:
        lvl = f"\U0001F4CA {level_text}".rstrip()
        if elig and elig.lower() != "not specified":
            lvl += f"  (eligible: {elig})" if level_text else f"\U0001F4CA Eligible: {elig}"
        lines.append(lvl)

    loc = nrow.get("location_label")
    if loc and loc.strip().lower() not in ("not specified", "na", "n/a", "-"):
        lines.append(f"\U0001F4CD {loc}")
    if nrow.get("last_date_display"):
        lines.append(f"\U0001F5D3️ Apply by: *{nrow['last_date_display']}*")

    link = f"{SITE_BASE}/?search={quote_plus(post)}"
    lines += ["", f"\U0001F517 {link}", "", "#Deputation #GoI"]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------
def read_config():
    """Return (supabase_url, anon_key) from env or config.js. Either may be ''."""
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_ANON_KEY", "")
    if (not url or not key) and CONFIG_JS.exists():
        text = CONFIG_JS.read_text(encoding="utf-8", errors="ignore")
        if not url:
            m = re.search(r'SUPABASE_URL\s*=\s*"([^"]+)"', text)
            url = m.group(1) if m else ""
        if not key:
            m = re.search(r'SUPABASE_ANON_KEY\s*=\s*"([^"]+)"', text)
            key = m.group(1) if m else ""
    return url.strip(), key.strip()


def supabase_ready(url: str, key: str) -> bool:
    return bool(re.match(r"^https://[a-z0-9]+\.supabase\.co", url or "")) \
        and len(key or "") > 20 and "YOUR_" not in (key or "")


def fetch_supabase_approved():
    """Return list of raw approved rows, or None if Supabase is unavailable."""
    if requests is None:
        print("[whatsapp_feed] 'requests' not installed; using JSON fallback. "
              "Run: pip install -r scripts/requirements.txt", file=sys.stderr)
        return None
    url, key = read_config()
    if not supabase_ready(url, key):
        return None
    endpoint = f"{url.rstrip('/')}/rest/v1/vacancies"
    params = {"status": "eq.approved", "select": "*"}
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        resp = requests.get(endpoint, params=params, headers=headers, timeout=20)
        resp.raise_for_status()
        rows = resp.json()
        return rows if isinstance(rows, list) else None
    except Exception as exc:  # noqa: BLE001 — any failure → fall back to JSON
        print(f"[whatsapp_feed] Supabase fetch failed ({exc}); using JSON fallback.",
              file=sys.stderr)
        return None


def load_json_rows():
    if not VACANCIES_JSON.exists():
        return []
    try:
        return json.loads(VACANCIES_JSON.read_text(encoding="utf-8"))
    except Exception as exc:  # noqa: BLE001
        print(f"[whatsapp_feed] Could not read {VACANCIES_JSON}: {exc}", file=sys.stderr)
        return []


def load_normalized(source: str):
    """Return (list_of_normalized_rows, source_used)."""
    if source in ("auto", "supabase"):
        raw = fetch_supabase_approved()
        if raw is not None:
            return [normalize_from_supabase(r) for r in raw], "supabase"
        if source == "supabase":
            return [], "supabase"
    return [normalize_from_json(r) for r in load_json_rows()], "json"


def all_known_keys(source: str):
    """Every ledger KEY we can see anywhere — used to seed so no historical row
    can ever post. Union of JSON (composite keys) + Supabase (uuid keys); both
    forms are seeded so a later source switch never re-posts."""
    keys = set()
    for r in load_json_rows():
        k = normalize_from_json(r).get("key", "")
        if k.strip("|"):
            keys.add(k)
    if source in ("auto", "supabase"):
        raw = fetch_supabase_approved()
        for r in (raw or []):
            k = normalize_from_supabase(r).get("key", "")
            if k.strip("|"):
                keys.add(k)
    return keys


# ---------------------------------------------------------------------------
# Ledger
# ---------------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_ledger() -> dict:
    if not LEDGER_PATH.exists():
        return {"seeded_at": None, "posted": {}}
    try:
        data = json.loads(LEDGER_PATH.read_text(encoding="utf-8"))
        data.setdefault("posted", {})
        return data
    except Exception as exc:  # noqa: BLE001
        print(f"[whatsapp_feed] Ledger unreadable ({exc}); starting empty.", file=sys.stderr)
        return {"seeded_at": None, "posted": {}}


def save_ledger(ledger: dict) -> None:
    LEDGER_PATH.parent.mkdir(parents=True, exist_ok=True)
    LEDGER_PATH.write_text(
        json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def compute_pending(rows, ledger):
    posted = ledger.get("posted", {})
    out = []
    seen = set()
    for nrow in rows:
        if not is_active_approved(nrow):
            continue
        key = nrow.get("key") or nrow.get("vacancy_id")
        if key in posted or key in seen:
            continue
        seen.add(key)
        out.append({"vacancy_id": nrow.get("vacancy_id"), "key": key,
                    "message": format_message(nrow)})
    return out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def cmd_seed(source: str) -> int:
    ledger = load_ledger()
    posted = ledger.setdefault("posted", {})
    ids = all_known_keys(source)
    added = 0
    for vid in ids:
        if vid not in posted:
            posted[vid] = {"posted_at": _now_iso(), "seeded": True}
            added += 1
    ledger["seeded_at"] = ledger.get("seeded_at") or _now_iso()
    save_ledger(ledger)
    print(f"Seeded {added} new id(s); ledger now tracks {len(posted)} total. "
          f"({LEDGER_PATH})")
    return 0


def cmd_list_pending(source: str) -> int:
    rows, used = load_normalized(source)
    pending = compute_pending(rows, load_ledger())
    print(json.dumps(pending, ensure_ascii=False, indent=2))
    print(f"[whatsapp_feed] source={used} pending={len(pending)}", file=sys.stderr)
    return 0


def cmd_mark_posted(ids) -> int:
    ledger = load_ledger()
    posted = ledger.setdefault("posted", {})
    n = 0
    for vid in ids:
        vid = norm(vid)
        if not vid:
            continue
        if vid not in posted:
            n += 1
        posted[vid] = {"posted_at": _now_iso(), "seeded": False}
    save_ledger(ledger)
    print(f"Marked {n} id(s) as posted; ledger tracks {len(posted)} total.")
    return 0


def main(argv=None) -> int:
    # Make emoji-bearing output safe on the Windows console.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001 — older Pythons / redirected streams
            pass

    parser = argparse.ArgumentParser(description="WhatsApp deputation feed (core).")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--seed", action="store_true",
                       help="Mark all current Vacancy_IDs as posted (no send).")
    group.add_argument("--list-pending", action="store_true",
                       help="Print JSON of approved+active rows not yet posted (default).")
    group.add_argument("--mark-posted", nargs="+", metavar="VACANCY_ID",
                       help="Append IDs to the ledger after a confirmed send.")
    parser.add_argument("--source", choices=["auto", "supabase", "json"], default="auto",
                        help="Where to read vacancies from (default: auto).")
    args = parser.parse_args(argv)

    if args.seed:
        return cmd_seed(args.source)
    if args.mark_posted:
        return cmd_mark_posted(args.mark_posted)
    return cmd_list_pending(args.source)


if __name__ == "__main__":
    raise SystemExit(main())
