#!/usr/bin/env python3
"""Headless verification of admin-ingest.html / admin-ingest.js (v=sb44 pass).

Serves the repo locally and intercepts every Supabase request with fixtures,
so no real backend (and no magic-link login) is needed. Exercises:
  - Pack A: first drafts fetch returns 401 -> api() refreshes the token and
    retries -> the queue still loads.
  - Pack B: Manage tab renders 25 cards/page with a pager; card editors are
    EMPTY until Edit is clicked (lazy build).
  - Pack E: quick-chip filter shows the "Reject filtered (N)" button; clicking
    it PATCHes one id=in.() batch and the queue count drops.
Screenshots land in _verify/.
"""
import json
import re
import sys
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

# Make the tests/ package importable so we can reuse its statics. Adding the
# project root to sys.path avoids the need for a package install step.
_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from tests.pages.route_helpers import jwt, reply_empty_cors, reply_json  # noqa: E402
from tests.pages.serve import serve  # noqa: E402

ROOT = _ROOT
PORT = 8771
SUPA_HOST = "djaxutkmhazufsxeobal.supabase.co"
OUT = ROOT / "_verify"
OUT.mkdir(exist_ok=True)


# Fixture dates are RELATIVE to the run date. Hard-coded 2026-06/07 dates were
# in the future when this script was written and quietly rotted into the past,
# at which point the "expired" quick chip matched all 60 drafts instead of 10
# and the Pack E bulk-reject assertions could never pass.
TODAY = date.today()
EXPIRED_DATE = (TODAY - timedelta(days=20)).isoformat()
FUTURE_DATE = (TODAY + timedelta(days=45)).isoformat()


def draft(i):
    past = i <= 10  # ten expired drafts for the "expired" chip test
    return {
        "id": i, "vacancy_id": f"T-2026-L12-{i:03d}", "post_name": f"Test Post {i}",
        "organisation": f"Org {i}", "ministry": "Finance", "level": "12",
        "location_city": "Delhi", "confidence": ["high", "medium", "low"][i % 3],
        "status": "draft", "source_type": "employment_news", "source_category": "EN Test",
        "source_file_url": "", "official_notification_link": "",
        "notification_date": (TODAY - timedelta(days=60)).isoformat(),
        "last_date_to_apply": EXPIRED_DATE if past else FUTURE_DATE,
        "created_at": f"2026-06-0{(i % 9) + 1}T10:00:00", "ingest_job_id": 1,
        "raw_extraction": None,
    }


def live(i):
    return {
        "id": 100 + i, "vacancy_id": f"L-2026-L13-{i:03d}", "post_name": f"Live Post {i}",
        "organisation": f"Alpha {i}", "level": "13A" if i % 5 == 0 else "13",
        "location_city": "Mumbai", "status": "approved",
        "source_type": "notification", "source_category": "NCLT",
        "official_notification_link": "https://example.gov.in/x.pdf",
        "notification_date": (TODAY - timedelta(days=40)).isoformat(),
        "last_date_to_apply": FUTURE_DATE,
        "created_at": f"2026-05-{(i % 28) + 1:02d}T09:00:00", "raw_extraction": None,
    }


DRAFTS = [draft(i) for i in range(1, 61)]
MANAGE = [live(i) for i in range(1, 61)]
STATE = {"draft_401_done": False, "patches": []}


def page_slice(rows, url):
    qs = parse_qs(urlparse(url).query)
    off = int(qs.get("offset", ["0"])[0])
    lim = int(qs.get("limit", ["1000"])[0])
    return rows[off:off + lim]


def count_for(url):
    """Row count for a countOf() probe, derived from the LIVE fixture lists.

    countOf() reads `Content-Range: a-b/N` and the page paints that N into the
    tab badges (`#draftCount` etc.). Returning a constant here made the badge
    contradict the 60 rows the same fixture serves to the list query, so the
    "(60)" and "(50)" waits below could never pass. Deriving N from DRAFTS /
    MANAGE keeps the badge and the list in agreement, including after the bulk
    reject removes ten rows.
    """
    if "status=eq.draft" in url:
        if "marked_for_review=eq.true" in url:
            return 0
        return len(DRAFTS)
    if "status=eq.approved" in url:
        return len(MANAGE)
    return 0


def apply_bulk_patch(url, body):
    """Mirror a bulk `?id=in.(...)` status PATCH onto the fixture lists.

    Without this the queue count never moves and the post-reject "(50)" wait
    hangs: the page re-reads the count straight after the PATCH.
    """
    if "status" not in body or "rejected" not in body:
        return
    m = re.search(r"id=in\.\(([^)]*)\)", url)
    if not m:
        return
    ids = {int(x) for x in m.group(1).split(",") if x.strip().isdigit()}
    DRAFTS[:] = [d for d in DRAFTS if d["id"] not in ids]


def sb_handler(route):
    req = route.request
    url, method = req.url, req.method

    if method == "OPTIONS":
        reply_empty_cors(route)
        return
    if "/auth/v1/token" in url:
        reply_json(route, {"access_token": jwt("admin@test.dev"), "refresh_token": "r2", "expires_in": 3600})
        return
    if "/rest/v1/admins" in url:
        reply_json(route, [{"email": "admin@test.dev"}])
        return
    if "/rest/v1/ingest_jobs" in url:
        reply_json(route, [])
        return
    if "/rest/v1/vacancy_updates" in url or "/rest/v1/vacancy_flags" in url:
        reply_json(route, [], extra_headers={"Content-Range": "*/0"})
        return
    if "/rest/v1/vacancies" in url:
        if method == "PATCH":
            body = req.post_data or ""
            STATE["patches"].append((url, body))
            apply_bulk_patch(url, body)
            reply_json(route, [])
            return
        if "select=id&limit=1" in url:  # countOf()
            n = count_for(url)
            reply_json(route, [], extra_headers={"Content-Range": f"0-0/{n}"})
            return
        if "status=eq.draft" in url:
            if not STATE["draft_401_done"]:  # Pack A: expire the token once
                STATE["draft_401_done"] = True
                reply_json(route, {"message": "JWT expired"}, status=401)
                return
            reply_json(route, page_slice(DRAFTS, url))
            return
        reply_json(route, page_slice(MANAGE, url))  # Manage list (status=eq.approved)
        return
    reply_json(route, {"error": "not mocked"}, status=404)


def wait_badge(page, element_id, expected, timeout=10000):
    """Wait for a tab badge to read exactly `expected`, reporting what it held.

    A bare wait_for_function() on the badge text only ever says "timeout", which
    hides whether the badge was empty (still loading) or simply held a different
    number (fixture disagreeing with itself). Re-raise with the actual text.
    """
    try:
        page.wait_for_function(
            "([id, want]) => (document.getElementById(id)?.textContent || '').trim() === want",
            arg=[element_id, expected],
            timeout=timeout,
        )
    except Exception:
        got = page.evaluate(
            "(id) => (document.getElementById(id)?.textContent || '').trim()", element_id
        )
        raise AssertionError(
            f"#{element_id} never reached {expected!r} within {timeout}ms — last value {got!r}"
        ) from None


def main():
    srv, _thread = serve(ROOT, PORT)

    failures, page_errors = [], []

    def check(cond, label):
        print(("  PASS  " if cond else "  FAIL  ") + label)
        if not cond:
            failures.append(label)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.on("pageerror", lambda e: page_errors.append(str(e)))
        page.on("dialog", lambda d: d.accept())
        page.route(f"https://{SUPA_HOST}/**", sb_handler)
        page.route("http://127.0.0.1:8787/**", lambda r: r.abort())  # WA bridge down

        sess = {"access_token": jwt("admin@test.dev"), "refresh_token": "r1",
                "expires_at": int(time.time()) + 3600, "email": "admin@test.dev"}
        page.add_init_script(
            f"localStorage.setItem('dep_admin_sess_v1', {json.dumps(json.dumps(sess))});"
            "localStorage.removeItem('dep_admin_ui_v1');"
        )

        print("== boot + Pack A (401 -> refresh -> retry) ==")
        page.goto(f"http://localhost:{PORT}/admin-ingest.html")
        page.wait_for_selector("#app:not(.hidden)", timeout=15000)
        wait_badge(page, "draftCount", "(60)")
        check(STATE["draft_401_done"], "first drafts fetch 401'd, queue still loaded (refresh+retry)")

        print("== Review queue + Pack E (filtered bulk) ==")
        page.click("#tabReview")
        page.wait_for_selector("#draftList .draft")
        check(page.locator("#draftList .draft").count() == 25, "Review renders 25 cards/page")
        check("Page 1 / 3" in page.locator("#draftPager").inner_text(), "Review pager shows Page 1 / 3")
        check(page.locator("#draftFilteredBar").is_hidden(), "filtered bar hidden with no filters")

        page.click('#draftQuick button[data-q="expired"]')
        page.wait_for_selector("#draftFilteredBar", state="visible")
        check("(10)" in page.locator("#filtRejectBtn").inner_text(), "Reject filtered shows (10)")
        page.screenshot(path=str(OUT / "admin_filtered_bar.png"))
        page.click("#filtRejectBtn")  # confirm auto-accepted
        wait_badge(page, "draftCount", "(50)")
        check(any("id=in." in u and '"rejected"' in b for u, b in STATE["patches"]),
              "one id=in.() PATCH with status rejected sent")
        check("Rejected 10" in page.locator("#toast").inner_text(), "undo toast reports Rejected 10")
        check(page.locator("#toast .toast-undo").count() == 1, "undo button present")
        page.click('#draftQuick button[data-q="expired"]')  # clear the filter

        print("== Manage tab + Pack B (lazy editors, pager) ==")
        page.click("#tabManage")
        page.wait_for_selector("#manageList .draft")
        check(page.locator("#manageList .draft").count() == 25, "Manage renders 25 cards/page")
        check("Page 1 / 3" in page.locator("#mgPager").inner_text(), "Manage pager shows Page 1 / 3")
        first = page.locator("#manageList .draft").first
        check(first.locator(".editor").inner_html().strip() == "", "card editor empty before Edit (lazy)")
        first.locator('[data-act="toggle"]').click()
        first.locator('.editor select[data-k="status"]').wait_for(state="attached", timeout=5000)
        check(first.locator('.editor [data-k]').count() > 15, "editor builds full field set on Edit")
        page.screenshot(path=str(OUT / "admin_manage_lazy_editor.png"))

        page.locator('#mgPager [data-pg="next"]').click()
        check("Page 2 / 3" in page.locator("#mgPager").inner_text(), "Manage pager flips to Page 2 / 3")
        page.fill("#mgSearch", "Alpha 7")
        page.wait_for_timeout(450)
        n = page.locator("#manageList .draft").count()
        check(1 <= n < 25, f"search narrows the list (got {n} cards)")
        page.screenshot(path=str(OUT / "admin_manage_pager.png"))

        browser.close()
    srv.shutdown()

    print("\npage errors:", page_errors or "none")
    if page_errors:
        failures.append("uncaught page errors: " + "; ".join(page_errors))
    print(("\nALL CHECKS PASSED" if not failures else f"\n{len(failures)} FAILURE(S): {failures}"))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
