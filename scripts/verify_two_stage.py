#!/usr/bin/env python3
"""Headless verification of the two-stage approval flow (Verify tab).

Same harness shape as scripts/verify_admin.py: serves the repo and intercepts
every Supabase call with fixtures, so no real backend or magic-link login is
needed.

Checks the invariants the feature rests on:
  1. approving ONE draft sends admin_verified=true   (lands verified)
  2. bulk approve sends admin_verified=false          (lands in Verify)
  3. the Verify tab lists only approved+unverified rows, with an amber ribbon
     whose tooltip reads "Admin verification pending"
  4. a per-row Verify PATCHes admin_verified=true and turns the ribbon green
  5. "Verify checked" PATCHes one id=in.() batch
  6. "Verify all pending" PATCHes the whole approved+unverified filter
"""
import json
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import sync_playwright

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))

from tests.pages.route_helpers import jwt, reply_empty_cors, reply_json  # noqa: E402
from tests.pages.serve import serve  # noqa: E402

ROOT = _ROOT
PORT = 8773
SUPA_HOST = "djaxutkmhazufsxeobal.supabase.co"

PENDING_N = 8  # < 50 so the bulk confirms are confirm() not prompt()


def draft(i):
    return {
        "id": i, "vacancy_id": f"T-2026-L12-{i:03d}", "post_name": f"Test Post {i}",
        "organisation": f"Org {i}", "ministry": "Finance", "level": "12",
        "location_city": "Delhi", "confidence": "high",
        "status": "draft", "source_type": "employment_news", "source_category": "EN Test",
        "source_file_url": "", "official_notification_link": "",
        "notification_date": "2026-05-01", "last_date_to_apply": "2027-07-01",
        "created_at": "2026-06-01T10:00:00", "ingest_job_id": 1, "raw_extraction": None,
    }


def pending(i):
    return {
        "id": 500 + i, "vacancy_id": f"P-2026-L13-{i:03d}", "post_name": f"Pending Post {i}",
        "organisation": f"Bulk Org {i}", "department": "", "ministry": "Home Affairs",
        "level_text": "Level-13", "location_city": "Mumbai", "location_state": "Maharashtra",
        "last_date_to_apply": "2027-07-15", "notification_date": "2026-05-20",
        "official_notification_link": "https://example.gov.in/pending.pdf",
        "source_file_url": "", "confidence": "medium",
        "created_at": f"2026-06-{(i % 28) + 1:02d}T09:00:00",
        "status": "approved", "admin_verified": False,
    }


DRAFTS = [draft(i) for i in range(1, 21)]
PENDING = [pending(i) for i in range(1, PENDING_N + 1)]
STATE = {"patches": []}


def page_slice(rows, url):
    qs = parse_qs(urlparse(url).query)
    off = int(qs.get("offset", ["0"])[0])
    lim = int(qs.get("limit", ["1000"])[0])
    return rows[off:off + lim]


def sb_handler(route):
    req = route.request
    url, method = req.url, req.method

    if method == "OPTIONS":
        reply_empty_cors(route); return
    if "/auth/v1/token" in url:
        reply_json(route, {"access_token": jwt("admin@test.dev"), "refresh_token": "r2",
                           "expires_in": 3600}); return
    if "/rest/v1/admins" in url:
        reply_json(route, [{"email": "admin@test.dev"}]); return
    if "/rest/v1/ingest_jobs" in url:
        reply_json(route, []); return
    if "/rest/v1/vacancy_updates" in url or "/rest/v1/vacancy_flags" in url:
        reply_json(route, [], extra_headers={"Content-Range": "*/0"}); return

    if "/rest/v1/vacancies" in url:
        if method == "PATCH":
            STATE["patches"].append((url, req.post_data or ""))
            reply_json(route, [{"id": r["id"]} for r in PENDING])
            return
        # countOf(): select=id&limit=1
        if "select=id&limit=1" in url:
            n = PENDING_N if "admin_verified=eq.false" in url else 3
            reply_json(route, [], extra_headers={"Content-Range": f"0-0/{n}"})
            return
        if "admin_verified=eq.false" in url:
            rows = page_slice(PENDING, url)
            reply_json(route, rows, extra_headers={"Content-Range": f"0-{len(rows)}/{PENDING_N}"})
            return
        if "status=eq.draft" in url:
            reply_json(route, page_slice(DRAFTS, url)); return
        reply_json(route, [], extra_headers={"Content-Range": "*/0"}); return

    reply_json(route, {"error": "not mocked"}, status=404)


def body_of(url_frag, *, method_body_contains=None):
    """Latest PATCH body whose URL contains `url_frag`."""
    for url, body in reversed(STATE["patches"]):
        if url_frag in url and (method_body_contains is None or method_body_contains in body):
            return body
    return ""


def main():
    srv, _t = serve(ROOT, PORT)
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
        page.route("http://127.0.0.1:8787/**", lambda r: r.abort())

        sess = {"access_token": jwt("admin@test.dev"), "refresh_token": "r1",
                "expires_at": int(time.time()) + 3600, "email": "admin@test.dev"}
        page.add_init_script(
            f"localStorage.setItem('dep_admin_sess_v1', {json.dumps(json.dumps(sess))});"
            "localStorage.removeItem('dep_admin_ui_v1');"
        )

        page.goto(f"http://localhost:{PORT}/admin-ingest.html")
        page.wait_for_selector("#app:not(.hidden)", timeout=15000)

        print("== 1. single approve lands VERIFIED ==")
        page.click("#tabReview")
        page.wait_for_selector("#draftList .draft")
        STATE["patches"].clear()
        page.locator('#draftList .draft [data-act="approve"]').first.click()
        page.wait_for_timeout(700)
        b = body_of("/vacancies?id=eq.")
        check('"admin_verified":true' in b, f"single approve sends admin_verified=true  [{b[:90]}]")
        check('"verified_at"' in b and '"verified_at":null' not in b,
              "single approve stamps verified_at")

        print("== 2. bulk approve lands UNVERIFIED ==")
        STATE["patches"].clear()
        boxes = page.locator('#draftList .draft input[type="checkbox"]')
        for i in range(min(3, boxes.count())):
            boxes.nth(i).check()
        page.wait_for_timeout(200)
        page.click("#bulkApproveBtn")
        page.wait_for_timeout(900)
        b = body_of("/vacancies?id=in.")
        check('"admin_verified":false' in b, f"bulk approve sends admin_verified=false  [{b[:90]}]")
        check('"verified_at":null' in b, "bulk approve clears verified_at")

        print("== 3. Verify tab lists pending rows with an amber ribbon ==")
        page.click("#tabVerify")
        page.wait_for_selector("#vfList .vf-row", timeout=8000)
        rows = page.locator("#vfList .vf-row")
        check(rows.count() == PENDING_N, f"Verify lists {PENDING_N} pending rows (got {rows.count()})")
        tip = page.locator("#vfList .vf-ribbon").first.get_attribute("title")
        check(tip == "Admin verification pending", f"ribbon tooltip reads correctly  [{tip!r}]")
        amber = page.evaluate(
            "() => getComputedStyle(document.querySelector('#vfList .vf-ribbon')).backgroundImage")
        check("245, 179, 1" in amber, f"ribbon renders amber  [{amber[:60]}]")
        check("(8)" in (page.locator("#verifyCount").inner_text() or ""), "tab badge shows (8)")
        check(page.locator('#vfList a[href="https://example.gov.in/pending.pdf"]').count() > 0,
              "source link is present and clickable")
        (ROOT / "_verify").mkdir(exist_ok=True)
        page.locator("#paneVerify").screenshot(path=str(ROOT / "_verify" / "verify_tab.png"))

        print("== 4. per-row verify -> PATCH true + ribbon turns green ==")
        STATE["patches"].clear()
        page.locator("#vfList [data-vf-verify]").first.click()
        page.wait_for_timeout(400)
        b = body_of("/vacancies?id=in.")
        check('"admin_verified":true' in b, f"row verify sends admin_verified=true  [{b[:90]}]")
        green = page.evaluate(
            "() => { const r = document.querySelector('#vfList .vf-ribbon.is-verified');"
            " return r ? getComputedStyle(r).backgroundImage : ''; }")
        check("55, 196, 107" in green, f"ribbon turns green after verify  [{green[:60]}]")

        print("== 5. Verify checked -> one id=in.() batch ==")
        page.wait_for_timeout(1200)  # let the list reload after step 4
        page.wait_for_selector("#vfList .vf-row")
        STATE["patches"].clear()
        page.check("#vfCheckAll")
        page.wait_for_timeout(200)
        checked_label = page.locator("#vfCheckedCount").inner_text()
        check("selected" in checked_label, f"bulk bar reports selection  [{checked_label!r}]")
        page.click("#vfVerifyChecked")
        page.wait_for_timeout(600)
        in_patches = [u for u, _ in STATE["patches"] if "id=in.(" in u]
        check(len(in_patches) == 1, f"Verify checked sends exactly one id=in.() PATCH (got {len(in_patches)})")

        print("== 6. Verify all pending -> filter-wide PATCH ==")
        page.wait_for_timeout(1200)
        STATE["patches"].clear()
        page.click("#vfVerifyAll")
        page.wait_for_timeout(800)
        wide = [u for u, _ in STATE["patches"]
                if "status=eq.approved" in u and "admin_verified=eq.false" in u]
        check(len(wide) >= 1, "Verify all PATCHes the approved+unverified filter")

        check(page_errors == [], f"no page errors  {page_errors[:2]}")
        browser.close()

    srv.shutdown(); srv.server_close()
    print("\n" + ("ALL PASS" if not failures else f"{len(failures)} FAILURE(S): {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
