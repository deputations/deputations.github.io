"""Smoke tests for the P3-3 semantic-search feature on index.html.

Covers:
  • chip toggle behaviour (default off, click flips state + shows panel)
  • ranked-matches path (stub the Edge Function, assert the panel renders
    rows + clicking a row opens the existing vacancy modal)
  • disabled-state handling (Edge Function 503 → graceful inline message,
    no JS exception)
  • default-off invariant (no fetch fires when the AI mode is off)

The Edge Function is stubbed at `**/functions/v1/semantic-search` with
`tests.pages.route_helpers.reply_json`. We do NOT exercise the Edge
Function's internal RPC path — only that the page sends a sensible POST
and renders whatever it gets back.
"""
from __future__ import annotations

from tests.pages.route_helpers import reply_json


def test_semantic_chip_is_off_by_default(page, base_url: str):
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#searchPost")
    # Chip exists and starts unpressed; panel is hidden; nothing fetched.
    page.wait_for_selector("#semanticToggle", timeout=5000)
    assert page.locator("#semanticToggle").get_attribute("aria-pressed") == "false"
    # Panel exists but is hidden.
    assert page.locator("#semanticResults").is_hidden()
    # Typing without toggling must NOT fire a request to /functions/v1/semantic-search.
    fired: list[str] = []
    page.on(
        "request",
        lambda r: fired.append(r.url)
        if "/functions/v1/semantic-search" in r.url
        else None,
    )
    page.fill("#searchPost", "Director")
    # Give the keyword debounce a beat.
    page.wait_for_timeout(400)
    assert not fired, (
        "semantic-search Edge Function was called while AI mode was off: "
        + ", ".join(fired)
    )


def test_semantic_chip_toggles_and_shows_panel(page, base_url: str):
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#searchPost")
    page.wait_for_selector("#semanticToggle", timeout=5000)

    # Stub the Edge Function with an empty (but well-formed) success body so
    # the in-flight request doesn't 404 if a stray keystroke fires.
    page.route(
        "**/functions/v1/semantic-search",
        lambda r: reply_json(r, {"ok": True, "results": []}),
    )

    toggle = page.locator("#semanticToggle")
    toggle.click()
    # aria-pressed flips + panel becomes visible.
    page.wait_for_function(
        "() => document.getElementById('semanticToggle').getAttribute('aria-pressed') === 'true'",
        timeout=3000,
    )
    page.wait_for_function(
        "() => !document.getElementById('semanticResults').hidden",
        timeout=3000,
    )
    # And clicking again turns it off + re-hides the panel.
    toggle.click()
    page.wait_for_function(
        "() => document.getElementById('semanticToggle').getAttribute('aria-pressed') === 'false'",
        timeout=3000,
    )
    page.wait_for_function(
        "() => document.getElementById('semanticResults').hidden",
        timeout=3000,
    )


def test_semantic_search_renders_ranked_matches(page, base_url: str):
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#searchPost")
    page.wait_for_selector("#semanticToggle", timeout=5000)

    # Three fixture matches — IDs match the data/vacancies.json shape so the
    # modal-open path can resolve them via getItemById().
    fixture_results = [
        {
            "vacancy_id": "A-2026-L6-014",
            "post_name": "Accountant",
            "organisation": "NMPB",
            "ministry": "AYUSH",
            "level": "6",
            "last_date": "2026-09-30",
            "score": 0.92,
        },
        {
            "vacancy_id": "A-2026-L8-022",
            "post_name": "Deputy Director (Finance)",
            "organisation": "Ministry of Finance",
            "ministry": "Finance",
            "level": "8",
            "last_date": "2026-10-12",
            "score": 0.87,
        },
        {
            "vacancy_id": "A-2026-L10-005",
            "post_name": "Director",
            "organisation": "Department of Expenditure",
            "ministry": "Finance",
            "level": "10",
            "last_date": "2026-11-01",
            "score": 0.81,
        },
    ]

    captured: dict = {}

    def handler(route):
        try:
            import json as _json
            body = _json.loads(route.request.post_data or "{}")
            captured["query"] = body.get("query")
        except Exception:
            pass
        reply_json(route, {"ok": True, "results": fixture_results})

    page.route("**/functions/v1/semantic-search", handler)

    # Turn AI mode on, type a query.
    page.locator("#semanticToggle").click()
    page.wait_for_function(
        "() => document.getElementById('semanticToggle').getAttribute('aria-pressed') === 'true'",
        timeout=3000,
    )
    page.fill("#searchPost", "finance posts in the northeast")

    # Wait for the panel to render three <li> rows.
    page.wait_for_function(
        "() => document.querySelectorAll('#semanticResultsList li').length === 3",
        timeout=8000,
    )
    rows = page.locator("#semanticResultsList li")
    assert rows.count() == 3, f"expected 3 ranked rows, got {rows.count()}"

    # First row carries the highest score + the right vacancy_id.
    first = rows.first
    assert first.get_attribute("data-vid") == "A-2026-L6-014"
    score_text = first.locator(".semantic-score").text_content() or ""
    assert "0.92" in score_text, f"score badge missing 0.92: {score_text!r}"

    # Query was sent verbatim to the Edge Function.
    assert captured.get("query") == "finance posts in the northeast", (
        f"unexpected query body: {captured.get('query')!r}"
    )

    # Clicking a row opens the existing modal. The modal is a <dialog>;
    # it's "open" when the `open` attribute is set.
    first.click()
    page.wait_for_selector("#modal[open]", timeout=5000)
    body_text = page.locator("#modalBody").text_content() or ""
    assert len(body_text) > 20, f"modal body too short: {body_text!r}"


def test_semantic_search_disabled_state_handled_gracefully(page, base_url: str):
    """Edge Function returns 503 + code='disabled' (free-tier overflow).

    The page must show an inline message — NOT throw a JS exception,
    NOT show a raw error string, NOT silently fail.
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#searchPost")
    page.wait_for_selector("#semanticToggle", timeout=5000)

    # Console errors raised during the test fail the test — we'll surface
    # them through Playwright's pageerror listener.
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.route(
        "**/functions/v1/semantic-search",
        lambda r: reply_json(
            r,
            {
                "ok": False,
                "code": "disabled",
                "message": "AI search temporarily disabled (free-tier limit).",
                "disabled_until": "2099-01-01T00:00:00Z",
            },
            status=503,
        ),
    )

    page.locator("#semanticToggle").click()
    # "Director" matches lots of keyword rows in the fixture data, so we can
    # assert the keyword path is unaffected by the disabled-AI state.
    page.fill("#searchPost", "Director")

    # Wait for the status line to paint.
    page.wait_for_function(
        "() => (document.getElementById('semanticResultsStatus')?.textContent || '')"
        ".includes('free-tier')",
        timeout=8000,
    )
    status = page.locator("#semanticResultsStatus").text_content() or ""
    assert "free-tier" in status, f"status missing free-tier message: {status!r}"
    assert "midnight UTC" in status, (
        f"status should mention when AI comes back: {status!r}"
    )
    # No <li> rows when the function is disabled.
    assert page.locator("#semanticResultsList li").count() == 0

    # The keyword-search path (table below) keeps working — the disabled
    # AI panel does NOT block the user from typing or filtering.
    keyword_rows = page.locator("tr.clickable-row[data-open-details]").count()
    assert keyword_rows >= 8, (
        f"keyword rows regressed during disabled AI: got {keyword_rows}"
    )

    assert not errors, f"unexpected page errors: {errors}"
