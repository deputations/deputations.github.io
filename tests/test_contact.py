"""Smoke tests for contact.html — feedback form.

The form POSTs to `${SUPABASE_URL}/functions/v1/submit` with
`{action:"feedback", ...}`. The smoke suite intercepts and returns a stub
response so the success view can be exercised without a real backend.
"""
from __future__ import annotations

import json


def test_contact_category_reveals_rest(page, base_url: str):
    page.goto(f"{base_url}/contact.html")
    page.wait_for_selector("#ctForm")
    # The #ctRest panel starts hidden and reveals when a category is picked.
    page.select_option("#ctCategory", index=1)  # first non-empty option
    page.wait_for_function(
        "() => document.getElementById('ctRest')?.hidden === false"
    )


def test_contact_validation_blocks_empty_submit(page, base_url: str):
    page.goto(f"{base_url}/contact.html")
    page.wait_for_selector("#ctForm")
    # The submit button posts through the page's own handler. With an empty
    # category the form should show an error and NOT fetch /functions/v1/submit.
    page.click("#ctSubmitBtn")
    # Category is required; the page sets a visible error element.
    page.wait_for_function(
        "() => (document.getElementById('ctCategoryErr')?.textContent || '').length > 0",
        timeout=5000,
    )


def test_contact_submit_success(page, base_url: str):
    page.goto(f"{base_url}/contact.html")
    page.wait_for_selector("#ctForm")

    # Stub submit; the page may fetch data/defex/meta or similar — we only
    # care about the Edge Function POST.
    def handler(route):
        if "/functions/v1/submit" in route.request.url:
            route.fulfill(
                status=200,
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Content-Type": "application/json",
                },
                body=json.dumps({"ok": True, "feedbackId": "FB-T-1"}),
            )
        else:
            route.continue_()

    page.route("**/supabase.co/**", handler)

    # Required: category, subject, message (>=8 chars), confirm checkbox.
    # Some categories also require ctRelatedPage; pick the first non-required
    # category (typically "General Feedback" — index 1) to avoid that branch.
    page.select_option("#ctCategory", index=1)
    page.fill("#ctSubject", "Smoke test")
    page.fill("#ctMessage", "Smoke test feedback — please ignore this automated message.")
    page.check("#ctConfirm")
    page.click("#ctSubmitBtn")
    page.wait_for_selector("#ctSuccess:not([hidden])", timeout=10000)
    success_text = page.locator("#ctSuccess").text_content() or ""
    assert "FB-T-1" in success_text or "FB-" in success_text, (
        f"success view missing feedback id: {success_text!r}"
    )
