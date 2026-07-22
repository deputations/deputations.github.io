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
import base64
import functools
import http.server
import json
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
PORT = 8771
SUPA_HOST = "djaxutkmhazufsxeobal.supabase.co"
OUT = ROOT / "_verify"
OUT.mkdir(exist_ok=True)


def jwt(email):
    seg = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")
    return f"{seg({'alg': 'none'})}.{seg({'email': email})}.sig"


def draft(i):
    past = i <= 10  # ten expired drafts for the "expired" chip test
    return {
        "id": i, "vacancy_id": f"T-2026-L12-{i:03d}", "post_name": f"Test Post {i}",
        "organisation": f"Org {i}", "ministry": "Finance", "level": "12",
        "location_city": "Delhi", "confidence": ["high", "medium", "low"][i % 3],
        "status": "draft", "source_type": "employment_news", "source_category": "EN Test",
        "source_file_url": "", "official_notification_link": "",
        "notification_date": "2026-05-01",
        "last_date_to_apply": "2026-06-01" if past else "2026-07-01",
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
        "notification_date": "2026-05-20", "last_date_to_apply": "2026-07-15",
        "created_at": f"2026-05-{(i % 28) + 1:02d}T09:00:00", "raw_extraction": None,
    }


DRAFTS = [draft(i) for i in range(1, 61)]
MANAGE = [live(i) for i in range(1, 61)]
STATE = {"draft_401_done": False, "patches": []}

CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, prefer, x-client-info, range",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Range",
}


def page_slice(rows, url):
    qs = parse_qs(urlparse(url).query)
    off = int(qs.get("offset", ["0"])[0])
    lim = int(qs.get("limit", ["1000"])[0])
    return rows[off:off + lim]


def sb_handler(route):
    req = route.request
    url, method = req.url, req.method

    def reply(body, status=200, headers=None):
        h = dict(CORS, **{"Content-Type": "application/json"})
        if headers:
            h.update(headers)
        route.fulfill(status=status, headers=h, body=json.dumps(body))

    if method == "OPTIONS":
        route.fulfill(status=200, headers=dict(CORS), body="")
        return
    if "/auth/v1/token" in url:
        reply({"access_token": jwt("admin@test.dev"), "refresh_token": "r2", "expires_in": 3600})
        return
    if "/rest/v1/admins" in url:
        reply([{"email": "admin@test.dev"}])
        return
    if "/rest/v1/ingest_jobs" in url:
        reply([])
        return
    if "/rest/v1/vacancy_updates" in url or "/rest/v1/vacancy_flags" in url:
        reply([], headers={"Content-Range": "*/0"})
        return
    if "/rest/v1/vacancies" in url:
        if method == "PATCH":
            STATE["patches"].append((url, req.post_data or ""))
            reply([])
            return
        if "select=id&limit=1" in url:  # countOf()
            reply([], headers={"Content-Range": "0-0/3"})
            return
        if "status=eq.draft" in url:
            if not STATE["draft_401_done"]:  # Pack A: expire the token once
                STATE["draft_401_done"] = True
                reply({"message": "JWT expired"}, status=401)
                return
            reply(page_slice(DRAFTS, url))
            return
        reply(page_slice(MANAGE, url))  # Manage list (status=eq.approved)
        return
    reply({"error": "not mocked"}, status=404)


def main():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()

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
        page.wait_for_function("document.getElementById('draftCount').textContent.includes('60')", timeout=10000)
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
        page.wait_for_function("document.getElementById('draftCount').textContent.includes('50')", timeout=10000)
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
