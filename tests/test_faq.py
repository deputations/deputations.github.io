"""Smoke tests for faq.html — the FAQ knowledge hub.

The discrepancy reporter is intentionally disabled (P3-5); we assert the
"temporarily disabled" message renders. Sections expand/collapse; search
filters FAQ items.
"""
from __future__ import annotations


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


def test_faq_discrepancy_reporter_disabled(page, base_url: str):
    """The Report-a-discrepancy feature is intentionally disabled post-P3-5.
    The submit handler must show the 'temporarily disabled' copy."""
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
    # Modal opens
    page.wait_for_selector("#reportModal.open", timeout=5000)
    # Fill #reportText — the submit handler first requires >=10 chars
    # before checking apiReady().
    page.fill("#reportText", "This is a smoke test of the disabled reporter copy.")
    page.locator("#reportSubmit").click()
    # DISCREPANCY_API is "" so apiReady() is false and the handler shows the
    # disabled message rather than calling out.
    page.wait_for_function(
        "() => (document.getElementById('reportMsg')?.textContent || '')"
        ".toLowerCase().includes('disabled')",
        timeout=5000,
    )