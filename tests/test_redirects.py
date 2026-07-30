"""Smoke tests for redirect stubs.

`Rules/faq.html` is a 15-line stub that redirects to `/faq.html` so old
bookmarks keep working (kept around since P0-11).
"""
from __future__ import annotations


def test_rules_faq_redirects_to_root_faq(page, base_url: str):
    # Note the capital R in /Rules/faq.html — this is intentional, the
    # legacy bookmark path.
    page.goto(f"{base_url}/Rules/faq.html")
    # The page uses location.replace() + meta refresh; the final URL must
    # be /faq.html.
    page.wait_for_url("**/faq.html", timeout=10000)
    # And the destination page renders FAQ items in the DOM. They're inside
    # collapsed sections so use state="attached".
    page.wait_for_selector(".faq-item", state="attached", timeout=10000)