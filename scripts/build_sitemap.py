#!/usr/bin/env python3
"""
build_sitemap.py — regenerate sitemap.xml from data/vacancies.json +
the canonical static page list.

Output: ../sitemap.xml (overwrites the existing sitemap.xml).
Called by the daily data cron (build-data.yml) right after
build_data.py commits the JSON.

The Astro build does NOT include sitemap generation (P2-5 deferred),
so this is the source of truth for now. Once P2-5 lands, the Astro
build emits its own sitemap and this becomes a fallback.
"""

import json
import os
import re
from datetime import date, datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR  = REPO_ROOT / "data"
OUT       = REPO_ROOT / "sitemap.xml"

BASE = "https://alldeputations.com"

# Static pages — clean-URL form matches the Astro build (P2-2).
STATIC = [
    # (path, changefreq, priority)
    ("/",          "daily",   1.0),
    ("/rules/",    "monthly", 0.8),
    ("/faq/",      "monthly", 0.7),
    ("/defex/",    "weekly",  0.7),
    ("/report-vacancy/", "monthly", 0.6),
    ("/contact/",  "monthly", 0.6),
    ("/my-deputation/", "monthly", 0.6),
    ("/upcoming-projects/", "weekly", 0.6),
]

# Templates + sitemap splitting: Google + Bing accept sitemaps up to
# 50,000 URLs (50 MB). With ~380 per-vacancy URLs we're well under.
# Single sitemap.xml with everything is fine for now; if it ever
# crosses 50K, switch to a sitemap-index.xml that points to chunks.

def read_vacancies():
    p = DATA_DIR / "vacancies.json"
    if not p.exists():
        return []
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return []

def safe_date_iso(s):
    """Return YYYY-MM-DD for the date string, or empty string on parse failure."""
    if not s:
        return ""
    try:
        # Prefer ISO format; the JSON has YYYY-MM-DD strings.
        d = datetime.fromisoformat(str(s)[:10])
        return d.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        return ""

def iso_today():
    return date.today().isoformat()

def main():
    today = iso_today()
    rows = read_vacancies()
    # One URL per vacancy; prefer the vacancy's notification_date as
    # lastmod (search engines use lastmod to know when to recrawl).
    vacancy_urls = []
    for r in rows:
        if not r.get("Vacancy_ID"):
            continue
        vid  = str(r["Vacancy_ID"])
        # URL-encode '#' if any ID has it (likely none, but defensive).
        vid_safe = re.sub(r"[^A-Za-z0-9_\-]", lambda m: "%{:02X}".format(ord(m.group(0))), vid)
        path = "/vacancy/{}/".format(vid_safe)
        lastmod = safe_date_iso(r.get("Notification_Date")) or today
        vacancy_urls.append((path, lastmod, "weekly", 0.6))

    # Static pages use the build date as lastmod (sitemap regenerates daily).
    static_urls = [(p, today, cf, pr) for (p, cf, pr) in STATIC]

    # Sitemap protocol caps 50,000 URLs; we have ~388. Safe.
    all_urls = static_urls + vacancy_urls

    # Build XML.
    out = ['<?xml version="1.0" encoding="UTF-8"?>']
    out.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for (path, lastmod, cf, pr) in all_urls:
        loc = BASE + path
        out.append("  <url>")
        out.append("    <loc>{}</loc>".format(loc))
        out.append("    <lastmod>{}</lastmod>".format(lastmod))
        out.append("    <changefreq>{}</changefreq>".format(cf))
        out.append("    <priority>{}</priority>".format(pr))
        out.append("  </url>")
    out.append("</urlset>")
    out.append("")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(out), encoding="utf-8")
    print("Wrote {} ({} URLs: {} static + {} vacancy)".format(
        OUT, len(all_urls), len(static_urls), len(vacancy_urls)))

if __name__ == "__main__":
    main()