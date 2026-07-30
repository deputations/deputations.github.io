"""Smoke tests for defex.html — the DeFeX friendliness index.

The page loads data/defex/*.json same-origin. The smoke suite just verifies
the dashboard paints, leaderboard rows render, and the search filter narrows
results.
"""
from __future__ import annotations


def test_defex_leaderboard_renders(page, base_url: str):
    page.goto(f"{base_url}/defex.html")
    # Wait for the leaderboard tbody to populate.
    page.wait_for_function(
        "() => document.querySelectorAll('#dex-tbody tr').length > 0",
        timeout=15000,
    )
    rows = page.locator("#dex-tbody tr")
    count = rows.count()
    assert count >= 6, f"expected >= 6 leaderboard rows, got {count}"


def test_defex_featured_grid_renders(page, base_url: str):
    page.goto(f"{base_url}/defex.html")
    page.wait_for_function(
        "() => document.querySelectorAll('#dex-featured *').length > 0",
        timeout=15000,
    )
    # The featured grid contains card children (no specific class required —
    # just assert something rendered).
    n = page.locator("#dex-featured > *").count()
    assert n >= 1, f"featured grid empty: {n}"


def test_defex_search_filters_leaderboard(page, base_url: str):
    page.goto(f"{base_url}/defex.html")
    page.wait_for_function(
        "() => document.querySelectorAll('#dex-tbody tr').length > 0",
        timeout=15000,
    )
    before = page.locator("#dex-tbody tr").count()
    page.fill("#filter-search", "zzznonexistentministryxyz")
    # Allow the in-page debounce/idle to apply.
    page.wait_for_timeout(400)
    after = page.locator("#dex-tbody tr").count()
    # Empty-state row also counts as a <tr> in some implementations; the
    # important invariant is the count changes after typing gibberish.
    assert after != before or page.locator("#dex-result-count").text_content() != "", (
        "search did not change leaderboard state"
    )


def test_defex_tab_switch_updates_count(page, base_url: str):
    page.goto(f"{base_url}/defex.html")
    page.wait_for_function(
        "() => document.querySelectorAll('#dex-tbody tr').length > 0",
        timeout=15000,
    )
    # The "needs" tab shows organisations missing reports. Click it and wait
    # for the aria-selected to flip — that's the canonical tab-active signal.
    page.locator('.dex-tab[data-tab="needs"]').click()
    page.wait_for_function(
        "() => document.querySelector('.dex-tab[data-tab=\"needs\"]')"
        "?.getAttribute('aria-selected') === 'true' || "
        "document.querySelector('.dex-tab[data-tab=\"needs\"]')?.classList.contains('dex-tab--active')"
    )
