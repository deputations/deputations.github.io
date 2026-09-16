#!/usr/bin/env python3
"""Fix 413 rows in data/vacancies.json whose dates were reversed by f660495's
dayfirst=True parsing.

Background: f660495 used `parse_date(dayfirst=True)` which correctly converts
DD-MM-YYYY to ISO. But the superseding date-fix logic that followed swapped
ND and LD on ~50 rows, and then a later bulk update reversed the swap — but
introduced a fresh problem: the JSON now has dates that are DIFFERENT from
the admin-verified Supabase values.

The admin panel reads from Supabase (correct dates, e.g. 2026-06-10 = 10 June
= expired). The public site reads from data/vacancies.json (wrong dates,
e.g. 2026-10-06 = 6 Oct = not expired). This script corrects the JSON to
match the admin-verified Supabase values.

Usage:  python scripts/fix_json_dates_from_supabase.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime


def _read_config_js() -> tuple[str, str]:
    with open("config.js", encoding="utf-8") as fh:
        txt = fh.read()
    url_m = re.search(r"window\.SUPABASE_URL\s*=\s*['\"]([^'\"]+)['\"]", txt)
    key_m = re.search(r"window\.SUPABASE_ANON_KEY\s*=\s*['\"]([^'\"]+)['\"]", txt)
    if not url_m or not key_m:
        sys.exit("Could not read SUPABASE_URL / SUPABASE_ANON_KEY from config.js")
    return url_m.group(1), key_m.group(1)


SB_URL, ANON = (
    _read_config_js() if os.path.exists("config.js") else
    (os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
)


def sb_get(path: str) -> list[dict]:
    url = f"{SB_URL}/rest/v1/{path}"
    req = urllib.request.Request(url, headers={
        "apikey": ANON, "Authorization": f"Bearer {ANON}",
    })
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def sb_to_display(val: str) -> str:
    """Convert a Supabase date value to display string 'DD Mon YYYY'."""
    if not val:
        return ""
    val = val.strip()
    # Already ISO
    if re.match(r"^\d{4}-\d{2}-\d{2}$", val):
        try:
            return datetime.strptime(val, "%Y-%m-%d").strftime("%d %b %Y")
        except ValueError:
            return val
    # DD-MM-YYYY or DD/MM/YYYY
    m = re.match(r"^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$", val)
    if m:
        d, mo, y = int(m[1]), int(m[2]), int(m[3])
        if y < 100:
            y += 2000
        try:
            return datetime(y, mo, d).strftime("%d %b %Y")
        except ValueError:
            return val
    return val


def main() -> None:
    print("1. Loading canonical JSON …")
    with open("data/vacancies.json", encoding="utf-8") as fh:
        jrows = json.load(fh)
    jmap = {r["Vacancy_ID"]: r for r in jrows}
    print(f"   {len(jmap)} vacancies in JSON")

    print("2. Fetching all approved rows from Supabase …")
    all_sb: list[dict] = []
    for offset in range(0, 5000, 1000):
        chunk = sb_get(
            "vacancies?status=eq.approved"
            "&select=id,vacancy_id,last_date_to_apply,notification_date"
            f"&limit=1000&offset={offset}&order=id.asc"
        )
        all_sb.extend(chunk)
        if len(chunk) < 1000:
            break
    print(f"   {len(all_sb)} approved rows in Supabase")

    # ── find rows where JSON dates differ from Supabase ───────────────────────
    to_fix: list[dict] = []
    for sr in all_sb:
        vid = sr.get("vacancy_id", "")
        jr = jmap.get(vid)
        if not jr:
            continue
        sb_nd = sr.get("notification_date") or ""
        sb_ld = sr.get("last_date_to_apply") or ""
        j_nd = jr.get("Notification_Date", "") or ""
        j_ld = jr.get("Last_Date_To_Apply", "") or ""

        if sb_nd != j_nd or sb_ld != j_ld:
            to_fix.append({
                "vid": vid,
                "sb_nd": sb_nd, "can_nd": sb_nd,
                "sb_ld": sb_ld, "can_ld": sb_ld,
                "j_nd": j_nd, "j_ld": j_ld,
            })

    print(f"3. Mismatches found: {len(to_fix)}")

    if not to_fix:
        print("Nothing to fix — done.")
        return

    # Sample
    print("\nSample mismatches (first 5):")
    for v in to_fix[:5]:
        nd_changed = v["sb_nd"] != v["j_nd"]
        ld_changed = v["sb_ld"] != v["j_ld"]
        print(f"  {v['vid']}:")
        if nd_changed:
            print(f"    ND: JSON={v['j_nd']} -> SB={v['sb_nd']!r}")
        if ld_changed:
            print(f"    LD: JSON={v['j_ld']} -> SB={v['sb_ld']!r}")

    # ── update JSON ───────────────────────────────────────────────────────────
    print(f"\n4. Updating data/vacancies.json …")
    updated = 0
    for v in to_fix:
        jr = jmap[v["vid"]]
        if v["sb_nd"] and v["sb_nd"] != v["j_nd"]:
            jr["Notification_Date"] = v["sb_nd"]
            jr["Notification_Date_Display"] = sb_to_display(v["sb_nd"])
            updated += 1
        if v["sb_ld"] and v["sb_ld"] != v["j_ld"]:
            jr["Last_Date_To_Apply"] = v["sb_ld"]
            jr["Last_Date_To_Apply_Display"] = sb_to_display(v["sb_ld"])
            updated += 1

    with open("data/vacancies.json", "w", encoding="utf-8") as fh:
        json.dump(jrows, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    print(f"   Updated {updated} date fields across {len(to_fix)} rows.")

    # ── verify ────────────────────────────────────────────────────────────────
    print("\n5. Spot-checking first 5 …")
    for v in to_fix[:5]:
        jr = jmap[v["vid"]]
        nd_ok = jr["Notification_Date"] == v["sb_nd"]
        ld_ok = jr["Last_Date_To_Apply"] == v["sb_ld"]
        status = "OK" if (nd_ok and ld_ok) else "MISMATCH"
        print(f"  {status} {v['vid']}: ND={jr['Notification_Date']} LD={jr['Last_Date_To_Apply']}")

    print(f"\nDone. {len(to_fix)} rows corrected in data/vacancies.json.")
    print("Commit and push to regenerate the public site.")


if __name__ == "__main__":
    main()
