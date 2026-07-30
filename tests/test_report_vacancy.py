"""Smoke tests for report-vacancy.html — vacancy submission form.

Form submit POSTs to `${SUPABASE_URL}/functions/v1/submit`. The smoke suite
intercepts that URL and returns a stub `{ok:true, reportId:"RV-T-1"}` so the
"success" view can be exercised without a real backend.
"""
from __future__ import annotations

import json


def test_report_vacancy_tabs_switch(page, base_url: str):
    page.goto(f"{base_url}/report-vacancy.html")
    page.wait_for_selector("#rvForm")
    # Default tab is "link"; click "pdf" then "manual" and assert the
    # matching pane becomes visible.
    page.locator("#rvTabPdf").click()
    page.wait_for_function(
        "() => document.querySelector('[data-pane=\"pdf\"]')?.hidden === false"
    )
    page.locator("#rvTabManual").click()
    page.wait_for_function(
        "() => document.querySelector('[data-pane=\"manual\"]')?.hidden === false"
    )


def test_report_vacancy_submit_success(page, base_url: str):
    page.goto(f"{base_url}/report-vacancy.html")
    page.wait_for_selector("#rvForm")

    # Stub the Edge Function submit POST.
    def handler(route):
        route.fulfill(
            status=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            body=json.dumps({"ok": True, "reportId": "RV-T-1"}),
        )

    page.route("**/functions/v1/submit", handler)

    # Use the link tab (default). Fill all required fields:
    #   rvUrl (link mode), rvTitle, rvMinistry, rvOrg, rvConfirm checkbox.
    # The ministries dropdown is populated from data/ministries.json so wait
    # for it to populate before selecting.
    page.wait_for_function(
        "() => document.querySelectorAll('#rvMinistry option').length > 1"
    )
    page.fill("#rvUrl", "https://example.gov.in/vacancy.pdf")
    page.fill("#rvTitle", "Deputy Director (Test)")
    page.select_option("#rvMinistry", index=1)  # first non-placeholder
    # Org dropdown enables after ministry selection.
    page.wait_for_function(
        "() => document.getElementById('rvOrg')?.disabled === false"
    )
    page.select_option("#rvOrg", index=1)
    page.check("#rvConfirm")

    page.click("#rvPreviewBtn")
    page.wait_for_selector("#rvModal:not([hidden])")
    page.click("#rvSubmitBtn")

    # Success view shows the report id.
    page.wait_for_selector("#rvSuccess:not([hidden])", timeout=10000)
    success_text = page.locator("#rvSuccess").text_content() or ""
    assert "RV-T-1" in success_text or "RV-" in success_text, (
        f"success view didn't render report id: {success_text!r}"
    )
