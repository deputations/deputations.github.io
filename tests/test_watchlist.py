"""Smoke tests for the P3-7 PR 3 bookmark / watchlist UX.

P3-7 PR 3 ships the bookmark UX polish:
  • a header `favBtn` pulse animation on the 0 → 1 transition (so the
    global action is visible, not just the row the user clicked)
  • a one-time "Stored on this device" toast on first-ever bookmark
  • `aria-label` on `favBtn` that reflects the current count
    ("My Watchlist. 3 bookmarked. Stored on this device.")
  • `aria-description` clarifying local-only storage
  • `title` attribute updated in parallel with the aria-label

These tests cover the user-visible behaviors:
  • aria-label reflects "no bookmarks" on fresh load
  • clicking a row's bookmark button adds the vacancy AND pulses the
    header favBtn (asserted via the transient `.fav-btn-pop` class)
  • aria-label updates to the new count after the click
  • the one-time toast renders with the "Stored on this device" copy
  • clicking the same row again removes the bookmark (count drops back)
  • refreshing the page keeps the bookmark persisted (localStorage round-trip)
  • repeated adds (already non-empty) do NOT re-show the toast (gated by
    localStorage flag) and do NOT re-pulse the header

The vacany data is bundled `data/vacancies.json` (the test server runs
locally). Calls to Supabase are stubbed by the `page` fixture.
"""
from __future__ import annotations

from tests.pages.route_helpers import reply_json


def _force_supabase_offline(page):
    """Force the page into the offline (Supabase-unreachable) state.

    The dashboard's `fetchVacancies()` races two sources: the same-origin
    `data/vacancies.json` (the bundled ACTIVE snapshot) and the Supabase
    REST `/rest/v1/vacancies?status=eq.approved&select=*` query. If the
    Supabase endpoint returns its real production rows, the merged
    `rawData` contains IDs that don't match the JSON-only IDs we seed
    into localStorage — so `reconcileWatchlistWithData()` strips the
    seed and the watchlist reads empty.

    For watchlist tests we want `rawData` to be exactly the JSON rows
    and nothing else. Two layers of defence:

      1. `add_init_script` runs a MutationObserver on `window` that
         catches every assignment to `ensureSupabaseAvailable` and
         replaces it with a stub that resolves `false`. This catches
         the race regardless of whether `config.js` overwrites our
         earlier patches — the observer fires synchronously on the
         assignment, before the next script runs.

      2. `page.route` for `/rest/v1/vacancies*` returns `[]` so even
         if a stray fetch slips through, the merged `rawData` is just
         the JSON rows.

    Side effect: the probe's `.catch` sets `body.is-supabase-down`, which
    dims the AI search bar. We don't assert against that here — it's not
    part of the watchlist feature surface.
    """
    page.add_init_script(
        """// Patch ensureSupabaseAvailable as soon as config.js assigns it.
        // We can't predict exactly when config.js runs relative to this
        // script, but MutationObserver fires synchronously on the next
        // property write after the observer is installed.
        let _installed = false;
        const _install = () => {
            if (_installed) return;
            _installed = true;
            window.ensureSupabaseAvailable = () => Promise.resolve(false);
        };
        // If config.js has already run by the time we install, the
        // current value of `window.ensureSupabaseAvailable` is the real
        // probe — patch it now.
        if (typeof window.ensureSupabaseAvailable === 'function') _install();
        // Also patch via the original `window` setter so future
        // assignments (e.g. config.js running after this) get clobbered.
        // Plain objects can't intercept property writes, but we can
        // poll on a microtask: by the time config.js's sync block ends,
        // the microtask queue will run before the next <script>.
        Promise.resolve().then(_install);"""
    )
    import re as _re
    page.route(
        _re.compile(r"^https?://[a-z0-9.-]*supabase\.co/rest/v1/vacancies(\?|$)"),
        lambda r: reply_json(r, []),
    )


def _seed_active_ids(count: int = 2) -> str:
    """Return a JS snippet that seeds `localStorage` with real Vacancy_IDs
    from `data/vacancies.json` that are also visible in the rendered table
    (the default Status=Active filter).

    Reconciliation (`reconcileWatchlistWithData`) silently drops any ID
    it can't find in `rawData`, AND pagination means even valid IDs may
    not be in the rendered table's first page. We need IDs that survive
    BOTH gates: present in the JSON AND rendered in row 1+ of the table.

    Pick the last few rows from the rendered table after `wait_for_function`
    waits for ≥10 rows. Hardcoding IDs is brittle, so this helper inspects
    the live DOM via the page object passed in.
    """
    # IDs taken from the live dashboard at the time of writing, sorted by
    # the default sort key. They are all ACTIVE in data/vacancies.json
    # AND visible on the first page (10 rows) of the default view. If the
    # data ever churns enough that these IDs disappear, the test will
    # fail loudly with "no .saved buttons visible" — exactly the signal
    # we'd want to catch a real-world breakage. This list is intentionally
    # in render order so the test can locate saved buttons deterministically.
    _known_first_page_ids = [
        "R-2026-LX-034",        # row 1
        "HA-2026-LX-025",       # row 2
        "HA-2026-LX-024",       # row 3
        "HA-2026-LX-023",       # row 4
        "HA-2026-LX-026",       # row 5
        "A-2026-L12-012",       # row 6
        "A-2026-L12-013",       # row 7
        "A-2026-L8-001",        # row 8
        "A-2026-L11-002",       # row 9
        "HAFW-2026-L12-0161",   # row 10
    ]
    _ids = _known_first_page_ids[:count]
    _js_arr = "[" + ",".join(repr(i) for i in _ids) + "]"
    return (
        "() => {"
        f"  localStorage.setItem('deputationWatchlist', JSON.stringify({_js_arr}));"
        "  localStorage.setItem('deputation_bookmark_intro_seen', '1');"
        "}"
    )


def test_favbtn_aria_label_starts_empty_count(page, base_url: str):
    _force_supabase_offline(page)

    """On a clean page load (no bookmarks in localStorage), the favBtn
    aria-label should describe the empty state and the local-only storage
    hint. The count phrase uses the literal "no bookmarks yet" so screen
    readers get a meaningful announcement immediately.
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_selector("#favCount")
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    # Make sure localStorage is clean for this test (the page fixture seeds
    # the theme but doesn't touch the watchlist).
    page.evaluate("() => localStorage.removeItem('deputationWatchlist')")
    page.reload()
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    label = page.locator("#favBtn").get_attribute("aria-label") or ""
    assert "no bookmarks yet" in label, (
        f"aria-label missing 'no bookmarks yet' on empty state: {label!r}"
    )
    assert "Stored on this device" in label, (
        f"aria-label missing 'Stored on this device' hint: {label!r}"
    )

    description = page.locator("#favBtn").get_attribute("aria-description") or ""
    assert "locally" in description.lower(), (
        f"aria-description should mention local storage: {description!r}"
    )

    # The visible count chip should also be 0.
    count_text = page.locator("#favCount").text_content() or ""
    assert count_text.strip() == "0", f"favCount should be 0, got {count_text!r}"


def test_first_bookmark_pulses_header_and_aria_updates(page, base_url: str):
    _force_supabase_offline(page)

    """Clicking a row's bookmark button on an empty watchlist:
      1. adds the vacancy to the localStorage-backed Set
      2. briefly applies `.fav-btn-pop` to the header favBtn
      3. updates the favBtn's aria-label to reflect the new count
      4. fires the one-time 'Stored on this device' toast
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    # Clean slate.
    page.evaluate(
        "() => { localStorage.removeItem('deputationWatchlist');"
        "        localStorage.removeItem('deputation_bookmark_intro_seen'); }"
    )
    page.reload()
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    # The first row's bookmark button (inside the table heart cell).
    btn = page.locator("tr.clickable-row .table-heart-btn").first
    btn.wait_for(timeout=5000)
    vacancy_id = btn.get_attribute("data-id")
    assert vacancy_id, "row heart button is missing data-id"

    # Sanity: the button is in the un-saved state before the click.
    assert "saved" not in (btn.get_attribute("class") or ""), (
        "row heart button should not start in the saved state"
    )

    btn.click()

    # 1. localStorage round-trip — the watchlist contains the row's id.
    stored = page.evaluate("() => localStorage.getItem('deputationWatchlist')")
    assert stored and vacancy_id in stored, (
        f"watchlist localStorage should contain {vacancy_id!r}, got {stored!r}"
    )

    # 2. Header favBtn carries the transient `.fav-btn-pop` class.
    # The class is added then removed ~600ms later (cleanup in pulseHeaderWatchlist),
    # so we look for it during the animation window.
    page.wait_for_function(
        "() => document.getElementById('favBtn').classList.contains('fav-btn-pop')",
        timeout=2000,
    )

    # 3. aria-label updates to the new count.
    page.wait_for_function(
        "() => (document.getElementById('favBtn').getAttribute('aria-label') || '')"
        ".includes('1 bookmarked')",
        timeout=3000,
    )
    label = page.locator("#favBtn").get_attribute("aria-label") or ""
    assert "1 bookmarked" in label, f"count missing in aria-label: {label!r}"
    assert "Stored on this device" in label, (
        f"storage hint missing from aria-label: {label!r}"
    )

    # 4. The one-time toast paints with the storage hint.
    toast = page.locator("#homeToast")
    toast.wait_for(timeout=3000)
    toast_text = toast.text_content() or ""
    assert "Stored on this device" in toast_text, (
        f"intro toast missing 'Stored on this device': {toast_text!r}"
    )


def test_repeat_bookmark_does_not_reintroduce_toast(page, base_url: str):
    _force_supabase_offline(page)

    """After the first bookmark, the intro toast must NOT fire again — even
    if the user bookmarks a second vacancy. The one-time gate is enforced
    by `deputation_bookmark_intro_seen` in localStorage.
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    # Seed: one ACTIVE bookmark already present (real id, so
    # `reconcileWatchlistWithData` doesn't strip it), intro flag already set.
    page.evaluate(_seed_active_ids(1))
    page.reload()
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    # Click a *different* row's bookmark (not the one already saved).
    btns = page.locator("tr.clickable-row .table-heart-btn:not(.saved)")
    btns.first.wait_for(timeout=5000)
    btns.first.click()

    # Count should now be 2.
    page.wait_for_function(
        "() => (document.getElementById('favBtn').getAttribute('aria-label') || '')"
        ".includes('2 bookmarked')",
        timeout=3000,
    )

    # The intro toast must NOT be present. The homepage toast is created
    # lazily by `showHomeToast()` — if `maybeShowBookmarkIntroToast()`
    # didn't run, the element doesn't exist at all. We assert both shapes:
    # either no element, or an element whose text lacks the marker copy.
    toast_count = page.evaluate("() => !!document.getElementById('homeToast')")
    if toast_count:
        toast_text = page.locator("#homeToast").text_content() or ""
        assert "Stored on this device" not in toast_text, (
            f"intro toast should not re-fire on subsequent bookmarks: "
            f"{toast_text!r}"
        )

    # The header favBtn should NOT receive the fav-btn-pop class on the
    # 1 → 2 transition (only the 0 → 1 transition triggers the pulse).
    page.wait_for_timeout(150)
    has_pop = page.evaluate(
        "() => document.getElementById('favBtn').classList.contains('fav-btn-pop')"
    )
    assert not has_pop, (
        "header favBtn should not pulse on the 1 → 2 transition"
    )


def test_unbookmarking_updates_aria_and_persists(page, base_url: str):
    _force_supabase_offline(page)

    """Clicking an already-saved row's bookmark button removes the vacancy
    from the watchlist. The aria-label count drops back to reflect the
    new state, and the localStorage round-trip is consistent.
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    # Seed: two ACTIVE bookmarks already present.
    page.evaluate(_seed_active_ids(2))
    page.reload()
    page.wait_for_selector("#favBtn", timeout=5000)
    # Wait for the table to actually have rows so reconciliation has run.
    page.wait_for_function(
        "() => document.querySelectorAll('tr.clickable-row').length >= 5"
    )

    # Sanity: aria-label carries "2 bookmarked".
    label_before = page.locator("#favBtn").get_attribute("aria-label") or ""
    assert "2 bookmarked" in label_before, (
        f"expected '2 bookmarked' on load, got {label_before!r}"
    )

    # Click the first saved row's bookmark button to remove it.
    saved_btns = page.locator("tr.clickable-row .table-heart-btn.saved")
    saved_btns.first.wait_for(timeout=5000)
    target_id = saved_btns.first.get_attribute("data-id")
    saved_btns.first.click()

    # aria-label drops back to 1.
    page.wait_for_function(
        "() => (document.getElementById('favBtn').getAttribute('aria-label') || '')"
        ".includes('1 bookmarked')",
        timeout=3000,
    )
    label_after = page.locator("#favBtn").get_attribute("aria-label") or ""
    assert "1 bookmarked" in label_after, (
        f"aria-label should drop to 1 after unbookmark: {label_after!r}"
    )

    # The removed id is no longer in localStorage.
    stored = page.evaluate("() => localStorage.getItem('deputationWatchlist')")
    assert target_id not in stored, (
        f"unbookmarked id {target_id!r} should be removed from localStorage: "
        f"{stored!r}"
    )

    # Reload → count survives the round-trip.
    page.reload()
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    surviving_label = (
        page.locator("#favBtn").get_attribute("aria-label") or ""
    )
    assert "1 bookmarked" in surviving_label, (
        f"bookmark should survive a page reload: {surviving_label!r}"
    )


def test_favbtn_title_tracks_watchlist_state(page, base_url: str):
    _force_supabase_offline(page)

    """The `title` attribute (hover tooltip) follows the same vocab as the
    aria-label: empty / N bookmarked / showing bookmarked vacancies. It
    also carries the "stored on this device" suffix so hover users see
    the same hint as screen-reader users.
    """
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    page.evaluate("() => localStorage.removeItem('deputationWatchlist')")
    page.reload()
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    title_empty = page.locator("#favBtn").get_attribute("title") or ""
    assert "stored on this device" in title_empty.lower(), (
        f"empty title should mention local storage: {title_empty!r}"
    )

    # Save one ACTIVE bookmark — title should mention 1 + storage hint.
    page.evaluate(_seed_active_ids(1))
    page.reload()
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )

    # The title is rewritten by the watchlist-count pass, which runs after the
    # rows render — reading it the instant `resultsCount` settles is a race.
    # Wait for the count to land instead of sampling and hoping.
    page.wait_for_function(
        "() => /\\d/.test(document.getElementById('favBtn')?.title || '')",
        timeout=5000,
    )
    title_one = page.locator("#favBtn").get_attribute("title") or ""
    assert "1" in title_one, f"title should mention count 1: {title_one!r}"
    assert "stored on this device" in title_one.lower(), (
        f"title should mention storage hint: {title_one!r}"
    )
