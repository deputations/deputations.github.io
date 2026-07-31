"""Smoke tests for the P3-3 semantic-search feature on index.html.

P3-3 PR 4 update: the previous `✨ AI` toggle chip (next to the sidebar
search) has been replaced by a dedicated full-width `#aiSearchInput` bar
that lives just below the KPI grid. AI search is always-on — there is no
toggle, no `aria-pressed` state. The sidebar `#searchPost` input remains
the keyword path only and must NOT trigger /functions/v1/semantic-search.

These tests cover:
  • the AI bar is visible on every page load (no toggle to flip)
  • typing in the dedicated AI bar triggers the Edge Function and renders
    ranked matches into `#semanticResultsList`
  • the Edge Function's 503 free-tier-disabled response surfaces as a
    friendly inline status, with the keyword table still working
  • typing in the sidebar `#searchPost` does NOT call the AI endpoint
    (the two paths are independent)

The Edge Function is stubbed at `**/functions/v1/semantic-search` with
`tests.pages.route_helpers.reply_json`. We do NOT exercise the Edge
Function's internal RPC path — only that the page sends a sensible POST
and renders whatever it gets back.
"""
from __future__ import annotations

from tests.pages.route_helpers import reply_json


def test_ai_search_bar_is_visible_on_load(page, base_url: str):
    """The dedicated AI search bar must be visible on every page load.

    The previous `#semanticToggle` chip is gone — there is no longer an
    off-by-default state to verify. We assert:
      • `#aiSearchInput` is present, visible, and empty
      • `#semanticResults` exists in the DOM but is hidden until typing
      • the old `#semanticToggle` chip is completely removed
      • the Edge Function is NOT called just by loading the page
      • the bar sits DIRECTLY BELOW the KPI grid (not at the bottom of
        the page after the table) — locks down the flagship positioning
        invariant so a flex-layout change can't silently sink the bar
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#searchPost")
    page.wait_for_selector("#aiSearchInput", timeout=5000)
    assert page.locator("#aiSearchInput").is_visible()
    assert (page.locator("#aiSearchInput").input_value() or "") == ""

    # Old chip must be gone — replaced by the dedicated bar.
    assert page.locator("#semanticToggle").count() == 0, (
        "Legacy #semanticToggle chip must be removed in P3-3 PR 4"
    )

    # Results panel exists but starts hidden.
    assert page.locator("#semanticResults").count() == 1
    assert page.locator("#semanticResults").is_hidden()

    # Flagship positioning: the bar must sit ABOVE the data table.
    # `.dashboard-content` is `display:flex; flex-direction:column` and
    # `.data-container` has `flex:1 1 auto`; without `flex-shrink:0` on
    # the AI section, the bar gets pushed to the bottom of the column.
    # Wait for the data table to actually have rows so its rect is real.
    page.wait_for_selector("#dataContainer tr.clickable-row", timeout=5000)
    page.wait_for_function(
        """() => {
            const ai   = document.querySelector('.ai-search-section');
            const kpi  = document.querySelector('.kpi-grid');
            const data = document.getElementById('dataContainer');
            if (!ai || !kpi || !data) return false;
            // Wait for the data container to have real height (table loaded).
            if (data.getBoundingClientRect().height < 100) return false;
            return ai.getBoundingClientRect().top   >= kpi.getBoundingClientRect().bottom
                && ai.getBoundingClientRect().bottom <= data.getBoundingClientRect().top;
        }""",
        timeout=5000,
    )

    # No fetch fires on initial page load.
    fired: list[str] = []
    page.on(
        "request",
        lambda r: fired.append(r.url)
        if "/functions/v1/semantic-search" in r.url
        else None,
    )
    page.wait_for_timeout(400)
    assert not fired, (
        "semantic-search Edge Function was called on initial load: "
        + ", ".join(fired)
    )


def test_sidebar_keyword_search_does_not_trigger_ai(page, base_url: str):
    """The sidebar `#searchPost` input is the keyword path only.

    Typing in the sidebar must filter the keyword table AND must NOT call
    the /functions/v1/semantic-search endpoint. The two paths are
    independent — only `#aiSearchInput` drives the AI endpoint.
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#searchPost")

    fired: list[str] = []
    page.on(
        "request",
        lambda r: fired.append(r.url)
        if "/functions/v1/semantic-search" in r.url
        else None,
    )

    # Stub the Edge Function anyway — if a stray request fires, the stub
    # ensures the test still completes without a network error.
    page.route(
        "**/functions/v1/semantic-search",
        lambda r: reply_json(r, {"ok": True, "results": []}),
    )

    page.fill("#searchPost", "Director")
    # Past the keyword debounce window.
    page.wait_for_timeout(500)
    assert fired == [], (
        "Sidebar #searchPost must not invoke the AI endpoint: "
        f"unexpected calls: {fired}"
    )

    # The dedicated AI bar must remain empty and the panel hidden.
    assert (page.locator("#aiSearchInput").input_value() or "") == ""
    assert page.locator("#semanticResults").is_hidden()


def test_semantic_search_renders_ranked_matches(page, base_url: str):
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#searchPost")
    page.wait_for_selector("#aiSearchInput", timeout=5000)

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

    # Type a query into the dedicated AI bar (no toggle to flip first).
    page.fill("#aiSearchInput", "finance posts in the northeast")

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
    page.wait_for_selector("#aiSearchInput", timeout=5000)

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

    # Type into the dedicated AI bar.
    page.fill("#aiSearchInput", "Director")

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

    # The keyword-search path (sidebar #searchPost) keeps working — the
    # disabled AI panel does NOT block the user from typing or filtering.
    # "Director" matches lots of keyword rows in the fixture data.
    keyword_rows = page.locator("tr.clickable-row[data-open-details]").count()
    assert keyword_rows >= 8, (
        f"keyword rows regressed during disabled AI: got {keyword_rows}"
    )

    assert not errors, f"unexpected page errors: {errors}"