"""Route stubs for the four site-wide Supabase RPCs.

Every page hits these via `site-widgets.js`:
- bump_visit        (POST /rest/v1/rpc/bump_visit)
- heartbeat         (POST /rest/v1/rpc/heartbeat)
- get_sentiment     (POST /rest/v1/rpc/get_sentiment)
- record_sentiment  (POST /rest/v1/rpc/record_sentiment)

The smoke suite stubs all four so the suite never depends on a live Supabase
project. Tests that need to *observe* an RPC call can register an additional
`page.route()` after `install()` — Playwright matches in LIFO order.
"""
from __future__ import annotations

import json
import re

from playwright.sync_api import Page

from tests.fixtures.constants import SUPA_HOST
from tests.pages.route_helpers import CORS, reply_json


def install(page: Page, *, anon_key: str = "") -> None:
    """Register route stubs for the four site-wide RPCs.

    `anon_key` is unused by the stubs themselves — it's accepted so tests that
    want to assert the browser sent the correct header can add their own route.
    """

    def rpc(name: str, body: dict):
        def handler(route):
            # Sanity: confirm browser is hitting the right host. If a test
            # accidentally forwards to a different Supabase project, fail loud.
            assert SUPA_HOST in route.request.url, (
                f"rpc_stub routed {route.request.url} but expected {SUPA_HOST}"
            )
            reply_json(route, body)
        page.route(
            re.compile(rf"^https?://[a-z0-9.-]*supabase\.co/rest/v1/rpc/{name}(\?|$)"),
            handler,
        )

    rpc("bump_visit", {"ok": True, "count": 42})
    rpc("heartbeat", {"ok": True})
    rpc("get_sentiment", {"ok": True, "ups": 100, "downs": 0})
    rpc("record_sentiment", {"ok": True, "ups": 101, "downs": 0})

    # Note: we deliberately do NOT register a catch-all OPTIONS handler here.
# Playwright dispatches routes in registration order (first match wins); a
# catch-all for `**/supabase.co/**` would shadow any per-test route that
# tests register later (e.g. to stub the Edge Function submit POST or the
# /auth/v1/otp call). Browser-driven CORS preflights work fine without
# explicit interception in headless mode — the response just needs the
# right CORS headers, which the test stubs already provide.
