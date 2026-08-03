"""Smoke tests for the heart / feedback widget on the proxy hostname.

Regression (2026-08-03): site-widgets.js#SB_OK used a hard-coded regex
`/^https:\\/\\/[a-z0-9]+\\.supabase\\.co/` that rejected the Cloudflare
Worker proxy URL (`sb-proxy.ncrsarkarishaadi.workers.dev`) used on
`alldeputations.com`. SB_OK flipped to false, rpc() short-circuited to
Promise.resolve(null), and the heart click never reached the vote
table — even though the proxy URL was perfectly reachable from non-NIC
networks.

Fix: SB_OK now delegates to window.SUPABASE_READY() (already widened in
P3-7 PR 2 to accept either host). One source of truth for "is the URL
this app uses reachable".

These tests cover the user-visible behaviours:
  • on alldeputations.com (proxy URL), the heart click triggers a real
    POST /rest/v1/rpc/record_sentiment request — the heart fills, the
    count goes up, and the response is the live ups count from
    Supabase (proxy-amplified).
  • on deputations.github.io / localhost (direct Supabase URL), the
    same flow works.
  • the .sw-fb widget is visible on every hostname (no probe gate).
"""
import pytest
from playwright.sync_api import expect, sync_playwright


def _heart_request_made(page, action_class):
    """Click the heart and assert a POST to record_sentiment was observed."""
    heard = {"yes": False}

    def on_request(request):
        if not request.url.endswith("/rest/v1/rpc/record_sentiment"):
            return
        heard["yes"] = True

    page.on("request", on_request)
    page.locator(".sw-fb " + action_class).click()
    page.wait_for_timeout(800)  # let the fetch fire
    return heard["yes"]


@pytest.mark.parametrize("action_class", [".like"])
def test_heart_click_triggers_record_sentiment_on_proxy_hostname(page, action_class):
    """Heart click on alldeputations.com must POST to the proxy's RPC endpoint."""
    if "alldeputations.com" not in page.url:
        pytest.skip("only runs against the proxy hostname")
    assert _heart_request_made(page, action_class), (
        "Heart click did not POST to /rest/v1/rpc/record_sentiment. "
        "SB_OK gate is mis-detecting the proxy URL as unreachable; check "
        "site-widgets.js#SB_OK now delegates to window.SUPABASE_READY()."
    )


@pytest.mark.parametrize("action_class", [".like"])
def test_heart_click_triggers_record_sentiment_on_direct_hostname(page, action_class):
    """Heart click on github.io / localhost must POST to Supabase directly."""
    if "alldeputations.com" in page.url:
        pytest.skip("only runs against the direct Supabase URL")
    assert _heart_request_made(page, action_class), (
        "Heart click did not POST to /rest/v1/rpc/record_sentiment. "
        "SB_OK gate is rejecting the direct Supabase URL; check the regex."
    )


def test_heart_widget_visible(page):
    """Heart must be visible on every hostname (no probe gate)."""
    expect(page.locator(".sw-fb .like")).to_be_visible()
    expect(page.locator(".sw-fb .dislike")).to_be_visible()
