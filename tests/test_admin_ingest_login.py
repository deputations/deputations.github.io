"""Smoke tests for admin-ingest.html — login card + magic-link POST.

We do NOT exercise the authenticated admin flows in v1 — they live in
scripts/verify_admin.py (and will migrate onto the shared helpers in PR 4).
This file just verifies the login card renders for an unauthenticated
visitor and that clicking the magic-link button issues the expected POST.
"""
from __future__ import annotations

import json


def test_admin_login_card_visible_without_session(page, base_url: str):
    page.goto(f"{base_url}/admin-ingest.html")
    # With no localStorage session, the login card must be visible and the
    # app card hidden. The exact classes may be `hidden` or use display:none —
    # check both classes.
    page.wait_for_selector("#loginCard", timeout=10000)
    visible = page.evaluate(
        "() => {"
        "  const c = document.getElementById('loginCard');"
        "  if (!c) return false;"
        "  if (c.classList.contains('hidden')) return false;"
        "  return window.getComputedStyle(c).display !== 'none';"
        "}"
    )
    assert visible, "login card should be visible without a session"

    app_hidden = page.evaluate(
        "() => {"
        "  const c = document.getElementById('app');"
        "  if (!c) return true;"
        "  return c.classList.contains('hidden') ||"
        "         window.getComputedStyle(c).display === 'none';"
        "}"
    )
    assert app_hidden, "#app should be hidden without a session"


def test_admin_magic_link_post_stubbed(page, base_url: str):
    """Stub the magic-link POST and assert the page issues it on click."""
    # Register the OTP handler FIRST (before the page fixture installs the
    # site-wide RPC stubs). Playwright dispatches routes in registration
    # order; the more specific /auth/v1/otp pattern wins over any later
    # catch-all globs.
    captured = {"called": False, "url": ""}

    def handler(route):
        captured["called"] = True
        captured["url"] = route.request.url
        route.fulfill(
            status=200,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Content-Type": "application/json",
            },
            body=json.dumps({}),
        )

    page.route("**/auth/v1/otp**", handler)

    page.goto(f"{base_url}/admin-ingest.html")
    page.wait_for_selector("#loginEmail", timeout=10000)
    page.fill("#loginEmail", "admin@example.dev")
    page.click("#loginBtn")
    page.wait_for_timeout(1500)
    assert captured["called"], (
        "magic-link click did not POST to /auth/v1/otp; the page may have"
        " bypassed the click handler or used a different endpoint"
    )