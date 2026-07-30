"""Smoke tests for rules.html — the static rules knowledge hub.

All rule data is inline; the page is fully readable without any backend.
The smoke suite verifies the page loads, search input is present, and
typing in it narrows results.
"""
from __future__ import annotations


def test_rules_loads_with_search_input(page, base_url: str):
    page.goto(f"{base_url}/rules.html")
    page.wait_for_selector("#searchRules", timeout=15000)
    # Sanity: the page renders a meaningful title and the search input is
    # visible. The page is huge (3k+ lines) so we don't assert every section.
    assert page.locator("#searchRules").is_visible(), "searchRules input not visible"


def test_rules_search_filters_results(page, base_url: str):
    page.goto(f"{base_url}/rules.html")
    page.wait_for_selector("#searchRules", timeout=15000)
    # Wait for the rule cards to render (the script populates them after the
    # inline data block runs).
    page.wait_for_function(
        "() => document.querySelectorAll('.rule-card, .card-rule').length > 0",
        timeout=15000,
    )
    before = page.locator(".rule-card, .card-rule").count()
    page.fill("#searchRules", "tenure")
    page.wait_for_timeout(500)  # allow client-side filter to settle
    after = page.locator(".rule-card, .card-rule").count()
    # "tenure" is a common rule keyword; the count should narrow (or at
    # least change) after the filter applies. Empty-state rows also count
    # as .rule-card in some implementations, so we don't require exact
    # non-zero — just a change.
    assert before > 0, f"no rules rendered initially: {before}"
    # Either count changed, OR the result-count label updated.
    changed = after != before
    assert changed, f"search did not narrow rules: before={before} after={after}"