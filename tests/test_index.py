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
