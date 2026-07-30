"""Helpers shared between the smoke suite and `scripts/verify_admin.py`.

CORS headers, JSON-response helper, and an `alg:none` JWT forgery used to
seed localStorage in admin tests.
"""
from __future__ import annotations

import base64
import json

# CORS headers — match the set the live Supabase REST responses send.
# The browser will reject the response without these on cross-origin fetches.
CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": (
        "authorization, apikey, content-type, prefer, x-client-info, range"
    ),
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Range",
}


def reply_json(route, body, *, status: int = 200, extra_headers: dict | None = None):
    """Fulfill a Playwright route with a JSON body and CORS headers.

    `body` may be a dict (encoded as JSON) or a string (sent as-is — useful
    for empty preflight bodies). `extra_headers` is merged on top of CORS and
    Content-Type, e.g. for Content-Range on count responses.
    """
    headers = dict(CORS, **{"Content-Type": "application/json"})
    if extra_headers:
        headers.update(extra_headers)
    route.fulfill(
        status=status,
        headers=headers,
        body=json.dumps(body) if not isinstance(body, str) else body,
    )


def reply_empty_cors(route):
    """Fulfill an OPTIONS preflight with the bare CORS headers and an empty body."""
    route.fulfill(status=200, headers=dict(CORS), body="")


def jwt(email: str) -> str:
    """Forged `alg:none` JWT — sufficient for stub responses, not for security.

    Used by tests that seed localStorage with a fake admin session, and by
    `scripts/verify_admin.py` for the same purpose.
    """
    def seg(obj):
        return (
            base64.urlsafe_b64encode(json.dumps(obj).encode())
            .decode()
            .rstrip("=")
        )
    return f"{seg({'alg': 'none'})}.{seg({'email': email})}.sig"
