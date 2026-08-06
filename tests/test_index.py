"""Smoke tests for index.html — the home dashboard.

These tests verify the happy path: page loads, vacancies render from
data/vacancies.json (default view is **table**, not card), search debounces,
modal opens, filter triggers toggle. The four site-wide RPCs are stubbed by
the `page` fixture so the suite never depends on a live Supabase project.

Note: the card-view toggle test was intentionally omitted. `btnCardView`'s
`setView('card')` calls `renderDashboard()` which uses
`document.startViewTransition` when available; in the headless Chromium
used by CI the view-transition API triggers a flaky race with the locator
query. The card view is exercised manually in development; the table view
is the one users hit first and is the primary smoke target.
"""
from __future__ import annotations

import re
from datetime import date, timedelta

from tests.pages.route_helpers import reply_json


def test_index_renders_vacancy_rows(page, base_url: str):
    page.goto(f"{base_url}/index.html")
    # Wait for the loader text to disappear and the table to paint.
    page.wait_for_function(
        "() => {"
        "  const el = document.getElementById('resultsCount');"
        "  if (!el) return false;"
        "  const t = el.textContent || '';"
        "  return !t.includes('Loading vacancies') && t.includes('vacancies');"
        "}"
    )
    rows = page.locator("tr.clickable-row[data-open-details]")
    count = rows.count()
    # data/vacancies.json has 73 Active rows; default filter is Status: Active.
    # Assert at least 8 to catch "no rows rendered" regressions without flaking
    # on data churn.
    assert count >= 8, f"expected >= 8 vacancy rows, got {count}"
    text = page.locator("#resultsCount").text_content() or ""
    assert "vacancies" in text, f"resultsCount didn't update: {text!r}"


def test_search_post_debounces(page, base_url: str):
    page.goto(f"{base_url}/index.html")
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '').includes('vacancies')"
    )
    before = page.locator("tr.clickable-row[data-open-details]").count()
    page.fill("#searchPost", "Director")
    # app.js debounces search; wait for the row count to change. We don't
    # hardcode the new count — any change is enough to prove the debounced
    # search is wired up. The arg is passed via a closure variable.
    page.wait_for_function(
        "(prev) =>"
        "  document.querySelectorAll('tr.clickable-row[data-open-details]').length !== prev",
        arg=before,
        timeout=5000,
    )


def test_first_row_opens_modal(page, base_url: str):
    page.goto(f"{base_url}/index.html")
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '').includes('vacancies')"
    )
    page.wait_for_selector("tr.clickable-row[data-open-details]")
    page.locator("tr.clickable-row[data-open-details]").first.click()
    # The modal is a <dialog>; it's "open" when the `open` attribute is set.
    page.wait_for_selector("#modal[open]")
    body_text = page.locator("#modalBody").text_content() or ""
    assert len(body_text) > 20, f"modal body too short: {body_text!r}"


def test_filter_trigger_toggles(page, base_url: str):
    page.goto(f"{base_url}/index.html")
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '').includes('vacancies')"
    )
    # Pick the first multi-select trigger button in the filter sidebar and
    # assert its aria-expanded flips to "true".
    trigger = page.locator(".ms-trigger").first
    trigger.click()
    page.wait_for_function(
        "() => document.querySelector('.ms-trigger')?.getAttribute('aria-expanded') === 'true'"
    )


# --------------------------------------------------------------------------
# Phase 0 defect regressions (REDESIGN.md items 1 and 2)
# --------------------------------------------------------------------------


def _row(vid: str, days_out: int) -> dict:
    """A minimal ACTIVE vacancy row closing `days_out` days from today.

    `Days_Left` is NOT set here on purpose. `app.js#recomputeStatus` (line
    609) discards whatever the JSON carries and recomputes it from
    `Last_Date_To_Apply` on every load, so seeding a literal `Days_Left`
    would test nothing. Driving it from a relative date exercises the real
    path that produces the user-visible pill.
    """
    closing = date.today() + timedelta(days=days_out)
    return {
        "Vacancy_ID": vid,
        "DRAFT / APPROVED": "APPROVED",
        "Post_Name": f"Test Post {vid}",
        "Ministry": "Ministry of Testing",
        "Organisation": "Test Organisation",
        "Organisation_Type": "Attached Office",
        "Level_Text": "Level 12",
        "Req_Level1": "11",
        "Location_City": "New Delhi",
        "Location_State": "Delhi",
        "Region": "North",
        "Last_Date_To_Apply": closing.isoformat(),
        "Notification_Date": date.today().isoformat(),
        "Status": "Active",
    }


def _serve_fixture_rows(page, rows: list[dict]) -> None:
    """Make `rawData` exactly `rows`.

    `fetchVacancies()` races the bundled `data/vacancies.json` against the
    Supabase REST query and merges both. Stub the JSON and force the probe
    to report Supabase unreachable, so production rows can't drown out the
    fixture. Mirrors `_force_supabase_offline` in test_watchlist.py.
    """
    page.add_init_script(
        """let _installed = false;
        const _install = () => {
            if (_installed) return;
            _installed = true;
            window.ensureSupabaseAvailable = () => Promise.resolve(false);
        };
        if (typeof window.ensureSupabaseAvailable === 'function') _install();
        Promise.resolve().then(_install);"""
    )
    page.route(
        re.compile(r"^https?://[a-z0-9.-]*supabase\.co/rest/v1/vacancies(\?|$)"),
        lambda r: reply_json(r, []),
    )
    page.route("**/data/vacancies.json", lambda r: reply_json(r, rows))


def test_days_left_pill_pluralises_one_day(page, base_url: str):
    """`Days_Left == 1` must render "1 day", not "1 days".

    REDESIGN.md Phase 0 item 1. Fixed at app.js#formatDaysLeft; the
    already-correct twin lives at shared/vacancy-utils.js:76.

    This can't be asserted against live data — on any given day the real
    dataset may contain zero rows closing tomorrow (on 2026-08-06 it had
    exactly one), so the singular branch would go unexercised.
    """
    _serve_fixture_rows(page, [_row("TEST-SINGULAR", 1), _row("TEST-PLURAL", 2)])
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("tr.clickable-row[data-open-details]")

    pills = {
        row.get_attribute("data-open-details"): (
            row.locator(".days-pill").first.text_content() or ""
        ).strip()
        for row in page.locator("tr.clickable-row[data-open-details]").all()
    }

    assert pills.get("TEST-SINGULAR") == "1 day", (
        f"singular deadline rendered as {pills.get('TEST-SINGULAR')!r} — "
        f"expected '1 day'. app.js#formatDaysLeft lost its plural guard."
    )
    assert pills.get("TEST-PLURAL") == "2 days", (
        f"plural deadline rendered as {pills.get('TEST-PLURAL')!r} — expected '2 days'."
    )


def test_footer_shows_canonical_domain(page, base_url: str):
    """The footer must name alldeputations.com, not the old Pages URL.

    REDESIGN.md Phase 0 item 2. One string in site-widgets.js#buildDisclaimer
    feeds the footer on all 8 pages.
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector(".sw-footer")
    footer = page.locator(".sw-footer").text_content() or ""

    assert "alldeputations.com" in footer, f"canonical domain missing from footer: {footer!r}"
    assert "github.io" not in footer, f"stale Pages domain still in footer: {footer!r}"
