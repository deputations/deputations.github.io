"""Capture screenshots of each My Deputation tab for the user manual."""
import json
import os
import sys
from pathlib import Path
from datetime import datetime, timedelta

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parent.parent
OUT_DIR = REPO / "assets" / "manual"
OUT_DIR.mkdir(parents=True, exist_ok=True)
PORT = 8765
URL = f"http://localhost:{PORT}/my-deputation.html"


def in_days(n: int) -> str:
    return (datetime.utcnow() + timedelta(days=n)).strftime("%Y-%m-%d")


def now_ms() -> int:
    return int(datetime.utcnow().timestamp() * 1000)


def seed_payload() -> dict:
    return {
        "dep_profile_v1": {
            "payLevel": "12", "service": "CSS", "cadre": "",
            "currentMinistry": "Finance", "currentPost": "Under Secretary",
            "yearsOfService": "14",
            "preferredMinistries": ["Defence", "Finance", "Home Affairs", "Personnel & Training (DoPT)"],
            "preferredLocations": ["Delhi / NCR", "Bengaluru", "Mumbai"],
            "experienceTags": ["procurement", "budget", "audit", "policy"],
            "lastDeputationStartDate": "2023-06-01",
            "lastDeputationEndDate": "2025-06-01",
            "coolingOffYears": 3  # intentional override so the manual screenshot shows the "override" rule chip
        },
        "deputationWatchlist": [
            "CULT-2026-L11-001", "AGRI-2026-L10-003",
            "MORD-2026-L12-001", "EDUC-2026-L14-001", "MOCA-2026-L11-001"
        ],
        "dep_tracker_v1": [
            {
                "vacancyId": "CULT-2026-L11-001", "stage": "awaiting",
                "stageHistory": [
                    {"stage": "saved", "at": now_ms() - 86400000 * 10, "note": "Added from bookmarks"},
                    {"stage": "drafting", "at": now_ms() - 86400000 * 7, "note": ""},
                    {"stage": "submitted", "at": now_ms() - 86400000 * 4, "note": "File with SO (Estt)"},
                    {"stage": "awaiting", "at": now_ms() - 86400000 * 2, "note": "Awaiting vigilance clearance"}
                ],
                "officialDeadline": in_days(8), "internalDeadline": in_days(3),
                "nextAction": "Send vigilance clearance reminder",
                "contactPerson": "Shri R. Kumar, Section Officer",
                "notes": "File currently with Vigilance Branch"
            },
            {
                "vacancyId": "AGRI-2026-L10-003", "stage": "drafting",
                "stageHistory": [
                    {"stage": "saved", "at": now_ms() - 86400000 * 3, "note": ""},
                    {"stage": "drafting", "at": now_ms() - 86400000 * 1, "note": ""}
                ],
                "officialDeadline": in_days(6), "internalDeadline": in_days(2),
                "nextAction": "Finalise bio-data & gather APAR PDFs",
                "contactPerson": "", "notes": ""
            },
            {
                "vacancyId": "MORD-2026-L12-001", "stage": "forwarded",
                "stageHistory": [
                    {"stage": "saved", "at": now_ms() - 86400000 * 20, "note": ""},
                    {"stage": "submitted", "at": now_ms() - 86400000 * 15, "note": ""},
                    {"stage": "forwarded", "at": now_ms() - 86400000 * 5, "note": "Forwarded to MoRD on 22 May"}
                ],
                "officialDeadline": in_days(21), "internalDeadline": "",
                "nextAction": "Await acknowledgement from MoRD",
                "contactPerson": "Ms. P. Sharma, DS (Estt)", "notes": ""
            },
            {
                "vacancyId": "EDUC-2026-L14-001", "stage": "saved",
                "stageHistory": [{"stage": "saved", "at": now_ms() - 86400000, "note": "Added from bookmarks"}],
                "officialDeadline": in_days(28), "internalDeadline": "",
                "nextAction": "Review eligibility & start drafting",
                "contactPerson": "", "notes": ""
            }
        ],
        "dep_documents_v1": [
            {"docKey": "biodata",  "status": "ready",    "issuedOn": "",           "expiresOn": "",           "notes": "Master in profile"},
            {"docKey": "apar",     "status": "ready",    "issuedOn": "",           "expiresOn": "",           "notes": "Bundled PDF"},
            {"docKey": "vigilance","status": "expiring", "issuedOn": "2025-05-14", "expiresOn": "2026-05-14", "notes": "Renew before MHA push"},
            {"docKey": "integrity","status": "ready",    "issuedOn": "2026-01-02", "expiresOn": "",           "notes": ""},
            {"docKey": "cadre",    "status": "missing",  "issuedOn": "",           "expiresOn": "",           "notes": "With SO (Estt)"},
            {"docKey": "noc",      "status": "ready",    "issuedOn": "2026-04-10", "expiresOn": "",           "notes": ""},
            {"docKey": "experience","status": "ready",   "issuedOn": "",           "expiresOn": "",           "notes": ""},
            {"docKey": "education","status": "ready",    "issuedOn": "",           "expiresOn": "",           "notes": ""},
            {"docKey": "prevdep",  "status": "na",       "issuedOn": "",           "expiresOn": "",           "notes": "First deputation"},
            {"docKey": "forward",  "status": "requested","issuedOn": "",           "expiresOn": "",           "notes": "Asked SO 23 May"}
        ],
        "dep_savedSearches_v1": [
            {"id": "s1", "name": "Level 12–13 · Delhi · Defence",
             "filters": {"search": "", "level": "", "ministry": "", "location": "", "status": "Active", "myPayLevel": "12", "quick": ""},
             "createdAt": now_ms() - 86400000 * 5, "lastRunAt": now_ms() - 86400000, "lastResultIds": []},
            {"id": "s2", "name": "Anywhere · Closing in 7 days",
             "filters": {"search": "", "level": "", "ministry": "", "location": "", "status": "Active", "myPayLevel": "", "quick": "closing7"},
             "createdAt": now_ms() - 86400000 * 8, "lastRunAt": now_ms() - 86400000 * 3, "lastResultIds": []},
            {"id": "s3", "name": "Finance / DoPT · My Level",
             "filters": {"search": "", "level": "", "ministry": "", "location": "", "status": "Active", "myPayLevel": "12", "quick": ""},
             "createdAt": now_ms() - 86400000 * 12, "lastRunAt": None, "lastResultIds": []},
        ]
    }


# Patch script that boosts Days_Left for our seeded bookmarks so the UI looks alive
DAYS_PATCH = """
(() => {
  const targets = {
    'CULT-2026-L11-001': 8,
    'AGRI-2026-L10-003': 6,
    'MORD-2026-L12-001': 21,
    'EDUC-2026-L14-001': 28,
    'MOCA-2026-L11-001': 14
  };
  const origFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (!/vacancies\\.json/.test(url)) return origFetch(input, init);
    return origFetch(input, init).then(r => r.json()).then(data => {
      const today = new Date(); today.setHours(0,0,0,0);
      data.forEach(v => {
        if (targets[v.Vacancy_ID] != null) {
          const n = targets[v.Vacancy_ID];
          v.Days_Left = n;
          v.expired_flag = false;
          v.Status = 'Active';
          const d = new Date(today); d.setDate(d.getDate() + n);
          v.Last_Date_To_Apply = d.toISOString().slice(0, 10);
          v.Last_Date_To_Apply_Display = d.toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric'});
        }
      });
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' }});
    });
  };
})();
"""


def seed_script(payload: dict) -> str:
    items = json.dumps(payload)
    return f"""
const payload = {items};
for (const [k, v] of Object.entries(payload)) {{
  localStorage.setItem(k, JSON.stringify(v));
}}
localStorage.setItem('deputation_theme_v1', 'dark');
{DAYS_PATCH}
"""


TABS = ["overview", "bookmarks", "searches", "tracker", "documents", "calendar", "profile"]


def main():
    payload = seed_payload()
    init_script = seed_script(payload)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            device_scale_factor=2,
        )
        context.add_init_script(init_script)
        page = context.new_page()
        page.goto(URL + "#overview", wait_until="networkidle")
        page.wait_for_selector(".md-tab[data-tab='overview']", timeout=10000)
        # Hide decorative shapes that bleed across pages
        page.add_style_tag(content=".bg-shapes{display:none!important;} .md-toast{display:none!important;}")
        page.wait_for_timeout(800)

        for tab in TABS:
            page.evaluate(f"document.querySelector('.md-tab[data-tab=\"{tab}\"]').click();")
            page.wait_for_timeout(700)
            # Scroll to top
            page.evaluate("window.scrollTo(0,0)")
            page.wait_for_timeout(200)
            out = OUT_DIR / f"{tab}.png"
            page.screenshot(path=str(out), full_page=False)
            print(f"saved {out.relative_to(REPO)}")

        # Bonus: tracker modal opened on first card, for a "click any card" illustration
        page.evaluate("document.querySelector('.md-tab[data-tab=\"tracker\"]').click();")
        page.wait_for_timeout(600)
        page.evaluate("document.querySelector('.md-kanban-card[data-vid=\"CULT-2026-L11-001\"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));")
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT_DIR / "tracker-modal.png"), full_page=False)
        print(f"saved {(OUT_DIR/'tracker-modal.png').relative_to(REPO)}")

        browser.close()

    print("done")


if __name__ == "__main__":
    sys.exit(main() or 0)
