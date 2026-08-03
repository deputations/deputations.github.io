"""Diagnostic smoke test for the NIC failure mode.

Reproduces the user's report: inside a NIC-like network where every
`*.supabase.co` call fails at the TLS layer, the console should show
ZERO errors (the AI search bar's own placeholder swap is the user-visible
signal — the standalone offline banner was removed) and the bookmark UI
(header favBtn + per-row heart) should remain visible — and the website
feedback widget (heart + thumbs-down) should also remain visible at the
top-right of the page.

Run in isolation:
    .venv-smoke/Scripts/python.exe -m pytest tests/test_nic_overview.py -v
"""
from __future__ import annotations

import re


def test_nic_network_silent_console_and_hearts_visible(page, base_url: str):
    """NIC failure simulation.

    The default `page` fixture (see `tests/conftest.py`) installs four RPC
    stubs (bump_visit, heartbeat, get_sentiment, record_sentiment) that
    return mock JSON. To simulate NIC, those four routes must each fail at
    the transport layer.

    Playwright dispatches routes in **registration order** (the first
    matching handler wins). The fixture's handlers are registered first
    with the glob `**/supabase.co/rest/v1/rpc/<name>` — re-registering
    the SAME glob later is what wins. We re-register each of the four RPC
    routes with the same URL pattern, plus the `/rest/v1/` probe route
    from `config.js`, and abort them. The last registration wins for an
    identical URL pattern.
    """
    page_errors: list[str] = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    def abort(route):
        route.abort("failed")

    # Override the four RPCs the fixture stubbed. Registering AFTER the
    # fixture with the same URL pattern wins for that URL.
    for rpc_name in ("bump_visit", "heartbeat", "get_sentiment", "record_sentiment"):
        page.route(
            re.compile(rf"^https?://[a-z0-9.-]*supabase\.co/rest/v1/rpc/{rpc_name}(\?|$)"),
            abort,
        )
    # Also catch the OAuth/config probe (`/rest/v1/` HEAD) so the network
    # truly fails on every code path. The dashboard's `fetchVacancies()` no
    # longer calls `ensureSupabaseAvailable()` (P3-7 PR 1 fix), but the
    # AI pre-flight + the realtime-toast still do.
    page.route(
        re.compile(r"^https?://[a-z0-9.-]*supabase\.co/rest/v1/(?:|$|\?)"),
        abort,
    )

    page.goto(f"{base_url}/index.html")
    page.wait_for_selector("#favBtn", timeout=5000)
    page.wait_for_function(
        "() => (document.getElementById('resultsCount')?.textContent || '')"
        ".includes('vacancies')"
    )
    # Wait for the first RPC failure to set the offline state. The 3-strike
    # breaker in `onRpcFail()` flips SB_OK=false after 3 strikes; the FIRST
    # strike sets the body class, which the AI search bar's CSS hooks off.
    page.wait_for_function(
        "() => document.body.classList.contains('is-supabase-down')",
        timeout=10000,
    )

    # Console silent — no ERR_SSL_PROTOCOL_ERROR leaks. (pageerror captures
    # only uncaught exceptions, not fetch-rejected promise warnings. The
    # fetch is caught by rpc()'s .catch(), so no page error fires.)
    assert page_errors == [], (
        f"unexpected page errors on NIC: {page_errors!r}"
    )

    # favBtn visible + ARIA complete.
    favBtn = page.locator("#favBtn")
    assert favBtn.is_visible(), "favBtn should be visible on NIC"
    label = favBtn.get_attribute("aria-label") or ""
    assert "Stored on this device" in label, (
        f"favBtn aria-label missing storage hint on NIC: {label!r}"
    )

    # Row hearts visible — wait for at least one row.
    page.wait_for_selector("tr.clickable-row .table-heart-btn", timeout=5000)
    hearts = page.locator("tr.clickable-row .table-heart-btn")
    n = hearts.count()
    assert n >= 5, f"expected ≥5 row hearts visible on NIC, got {n}"
    for i in range(min(n, 5)):
        h = hearts.nth(i)
        assert h.is_visible(), f"row heart {i} should be visible on NIC"

    # P3-7 PR 1 fix: the feedback widget's heart (top-right) is rendered
    # UNCONDITIONALLY — even on NIC. The probe-gate that hid it was reverted
    # because users expected the heart + thumbs-down to be there, and the
    # 3-strike breaker in `rpc()` already handles click failures silently.
    # Count shows "—" while offline (the `.sw-fb .cnt` element).
    page.wait_for_selector(".sw-fb", timeout=5000)
    sw_fb = page.locator(".sw-fb")
    assert sw_fb.is_visible(), "feedback widget should be visible on NIC"
    like_btn = page.locator(".sw-fb .like")
    assert like_btn.is_visible(), "feedback heart (like button) should be visible on NIC"
    dislike_btn = page.locator(".sw-fb .dislike")
    assert dislike_btn.is_visible(), "feedback thumbs-down should be visible on NIC"
    # Count is "—" while offline (no successful rpc() resolved).
    cnt = page.locator(".sw-fb .cnt").text_content() or ""
    assert cnt.strip() == "—", f"feedback count should be '—' on NIC, got {cnt!r}"
