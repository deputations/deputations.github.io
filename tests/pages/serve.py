"""Tiny in-process static HTTP server for the smoke suite.

Same shape as the server block at the top of `scripts/verify_admin.py`,
factored out so both that script and `tests/conftest.py` use it.

Returns (server, thread) so callers can `server.shutdown()` and
`thread.join()` at fixture teardown.
"""
from __future__ import annotations

import http.server
import threading
from pathlib import Path


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler that doesn't spam stderr on every GET."""

    def log_message(self, format, *args):  # noqa: A002 (signature is fixed)
        pass


def serve(repo_root: Path, port: int):
    """Start a daemon thread serving `repo_root` on 127.0.0.1:`port`.

    Use `127.0.0.1` (not `0.0.0.0`) — keeps the test server off the LAN and
    matches the localhost check in `site-widgets.js` that skips service-worker
    registration.
    """
    import os

    os.chdir(repo_root)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), _QuietHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread
