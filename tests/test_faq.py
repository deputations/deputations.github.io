"""Smoke tests for faq.html — the FAQ knowledge hub.

Sections expand/collapse; search filters FAQ items. The discrepancy reporter
was re-enabled in P3-6 by porting it onto the Supabase `submit` Edge Function
(`action:"faq_report"`, `action:"faq_list"`); the smoke suite stubs both
endpoints so the success view can be exercised without a live backend.
"""
from __future__ import annotations

import json


def test_faq_loads_and_shows_questions(page, base_url: str):
    page.goto(f"{base_url}/faq.html")
    # .faq-item elements live inside collapsed sections by default and are
    # `visibility:hidden`. Use state="attached" so we count DOM presence,
    # not visibility — then expand the section to confirm the content paints.
    page.wait_for_selector(".faq-item", state="attached", timeout=10000)
    n = page.locator(".faq-item").count()
    assert n >= 1, f"expected >= 1 FAQ item, got {n}"


def test_faq_section_collapse_toggle(page, base_url: str):
    page.goto(f"{base_url}/faq.html")
    page.wait_for_selector(".section-collapse-toggle", timeout=10000)
    btn = page.locator(".section-collapse-toggle").first
    btn.click()
    page.wait_for_function(
        "() => document.querySelector('.section-collapse-toggle')"
        "?.getAttribute('aria-expanded') === 'true'",
        timeout=5000,
    )


def test_faq_discrepancy_reporter_enabled(page, base_url: str):
    """P3-6 re-enabled the discrepancy reporter via the Supabase `submit`
    Edge Function. The submit handler must POST {action:"faq_report", ...},
    receive {ok:true}, and swap #reportFormView for #reportSuccessView.

    The success path triggers a follow-up loadReports() POST
    {action:"faq_list"} to refresh the public card list, so we stub both
    endpoints in one handler.
    """
    page.goto(f"{base_url}/faq.html")
    page.wait_for_selector(".faq-item", state="attached", timeout=10000)

    # Open the first section so the per-item footer (with .flag-btn) appears.
    page.locator(".section-collapse-toggle").first.click()
    page.wait_for_function(
        "() => document.querySelector('.section-collapse-toggle')"
        "?.getAttribute('aria-expanded') === 'true'"
    )
    page.locator(".faq-q").first.click()
    page.wait_for_selector(".flag-btn", timeout=5000)
    page.locator(".flag-btn").first.click()
    page.wait_for_selector("#reportModal.open", timeout=5000)

    # Stub the submit endpoint. The handler inspects the POSTed body to
    # return the right shape per action.
    captured = {"faq_report": False, "faq_list": False}

    def handler(route):
        try:
            body = json.loads(route.request.post_data or "{}")
        except Exception:
            body = {}
        action = body.get("action")
        if action == "faq_report":
            captured["faq_report"] = True
            route.fulfill(
                status=200,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": "application/json",
                },
                body=json.dumps({
                    "ok": True, "success": True,
                    "reportId": "FAQ-T-1",
                }),
            )
            return
        if action == "faq_list":
            captured["faq_list"] = True
            route.fulfill(
                status=200,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": "application/json",
                },
                body=json.dumps({"ok": True, "reports": []}),
            )
            return
        # Unknown action — let it fall through (other tests in the suite may
        # need different stubs for the same endpoint).
        route.continue_()

    page.route("**/functions/v1/submit", handler)

    page.fill("#reportText", "This is a smoke test of the re-enabled reporter.")
    page.locator("#reportSubmit").click()
    # The success view swaps in: #reportFormView hidden, #reportSuccessView
    # visible. Assert via computed display rather than inline style so the
    # test doesn't couple to the page's exact `display` value.
    page.wait_for_function(
        "() => getComputedStyle(document.getElementById('reportSuccessView'))"
        ".display !== 'none'",
        timeout=10000,
    )
    page.wait_for_function(
        "() => getComputedStyle(document.getElementById('reportFormView'))"
        ".display === 'none'",
        timeout=5000,
    )
    assert captured["faq_report"], "page did not POST action:'faq_report'"
    assert captured["faq_list"], (
        "page did not follow up with action:'faq_list' after the report"
        " succeeded — the public list will be stale"
    )