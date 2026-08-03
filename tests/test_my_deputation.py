"""Smoke tests for my-deputation.html — the personal cockpit (localStorage).

The page is purely localStorage-driven (no auth, no forms POSTing). We seed
the bookmarks via add_init_script and verify the bookmarks tab renders them.
"""
from __future__ import annotations

import json

from playwright.sync_api import BrowserContext, Page


def test_my_deputation_tabs_switch(context: BrowserContext, base_url: str):
    """All 7 tabs render their corresponding panel."""
    p = context.new_page()
    try:
        p.goto(f"{base_url}/my-deputation.html")
        p.wait_for_selector(".md-tab")
        for tab in ("overview", "bookmarks", "searches", "tracker", "documents", "calendar", "profile"):
            p.locator(f'.md-tab[data-tab="{tab}"]').click()
            p.wait_for_function(
                f"() => document.getElementById('panel-{tab}')?.classList.contains('active')",
                timeout=5000,
            )
    finally:
        p.close()


def test_my_deputation_bookmarks_seeded(context: BrowserContext, base_url: str):
    """Seed bookmarks via localStorage with IDs that exist in data/vacancies.json;
    verify the bookmarks panel renders .md-vacancy-card entries."""
    # Real Active IDs from data/vacancies.json (verified 2026-07-30; if the
    # dataset rotates and these go inactive, the panel falls through to the
    # "No bookmarks yet" empty state and the test fails — that's the right
    # behaviour for catching data drift).
    seed = json.dumps(["A-2026-L6-014", "A-2026-L11-011", "E-2026-L14-127"])
    context.add_init_script(
        f"try {{ localStorage.setItem('deputationWatchlist', {json.dumps(seed)}); }} catch(e) {{}}"
    )
    p = context.new_page()
    try:
        p.goto(f"{base_url}/my-deputation.html")
        # Click bookmarks tab and wait for the panel to render cards. The page
        # populates `vacancyById` from data/vacancies.json asynchronously, so
        # wait for at least one card to appear.
        p.locator('.md-tab[data-tab="bookmarks"]').click()
        p.wait_for_selector("#panel-bookmarks .md-vacancy-card", timeout=10000)
        n = p.locator("#panel-bookmarks .md-vacancy-card").count()
        assert n >= 1, f"expected >= 1 bookmark card, got {n}"
    finally:
        p.close()


def test_my_deputation_bookmarks_survive_supabase_offline(
    context: BrowserContext, base_url: str
):
    """Bookmarks must still resolve when Supabase is unreachable (NIC).

    Regression: `fetchVacancies()` used to branch on `SUPABASE_READY()`, which
    only checks that the URL and anon key LOOK valid — they do on NIC, where
    the resolver sinkholes supabase.co into a walled garden. The page took the
    Supabase branch, the cross-origin fetch rejected, `loadVacancies()`'s
    `.catch` left `vacancies` empty, and every saved bookmark reconciled as
    "N bookmarked vacancy is no longer in the current list (likely closed or
    removed)" while the header still counted it.

    The fix mirrors index.html: the committed JSON is primary, Supabase is an
    enhancement gated on the reachability probe.
    """
    seed = json.dumps(["A-2026-L6-014", "A-2026-L11-011", "E-2026-L14-127"])
    context.add_init_script(
        f"try {{ localStorage.setItem('deputationWatchlist', {json.dumps(seed)}); }} catch(e) {{}}"
    )
    p: Page = context.new_page()
    try:
        # Kill every cross-origin Supabase call before the page loads — the
        # `/rest/v1/` probe in config.js and the vacancies query alike.
        p.route("**/rest/v1/**", lambda r: r.abort("failed"))
        p.route("**/functions/v1/**", lambda r: r.abort("failed"))

        p.goto(f"{base_url}/my-deputation.html")
        p.locator('.md-tab[data-tab="bookmarks"]').click()
        p.wait_for_selector("#panel-bookmarks .md-vacancy-card", timeout=10000)

        n = p.locator("#panel-bookmarks .md-vacancy-card").count()
        assert n >= 1, (
            f"bookmarks must resolve from the bundled JSON when Supabase is "
            f"unreachable; got {n} cards"
        )

        panel_text = p.locator("#panel-bookmarks").text_content() or ""
        assert "no longer in the current list" not in panel_text, (
            "bookmarks were wrongly reported stale on an offline network: "
            f"{panel_text[:200]!r}"
        )
    finally:
        p.close()
