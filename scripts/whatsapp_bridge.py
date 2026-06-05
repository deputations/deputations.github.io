#!/usr/bin/env python3
r"""whatsapp_bridge.py — local helper so the admin page's "Send WhatsApp Update"
button can post to the channel in one click.

Why a local service: WhatsApp Channels have no API, and a web page can't drive
WhatsApp Web — so the actual posting must happen in a browser on your PC. This
bridge holds ONE persistent, logged-in Playwright session and exposes a tiny
HTTP API on localhost that the admin button calls.

Endpoints (bound to 127.0.0.1 only):
  GET  /health   -> {"ok": true, "logged_in": bool}
  GET  /pending  -> {"count": n, "items": [{vacancy_id, message}, ...], "source"}
  POST /post     -> {"posted": [...], "failed": [...], "count", "requested"}

Run it:
  python scripts/whatsapp_watcher.py --login     # once, scan the QR
  python scripts/whatsapp_bridge.py              # leave running while you work

The browser session is shared with the watcher (same profile dir), so logging in
once via the watcher is enough. CORS is limited to the admin origins below.

Config (env): WA_BRIDGE_PORT (default 8787), WA_BRIDGE_SOURCE (default auto),
WA_CHANNEL_NAME / WA_HEADLESS (as for the watcher).
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# Reuse the core + the watcher's browser/posting helpers.
sys.path.insert(0, str(Path(__file__).resolve().parent))
import whatsapp_feed as feed      # noqa: E402
import whatsapp_watcher as ww     # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright is not installed. Run:\n"
          "  pip install -r scripts/requirements.txt\n"
          "  python -m playwright install chromium", file=sys.stderr)
    raise SystemExit(2)

PORT = int(os.environ.get("WA_BRIDGE_PORT", "8787"))
SOURCE = os.environ.get("WA_BRIDGE_SOURCE", "auto")

# Only these page origins may call the bridge. The server binds to 127.0.0.1, so
# this is the surface a local web page could reach. Requiring an allow-listed
# origin (plus the JSON preflight on /post) blocks a random site from triggering
# a post via the user's browser.
ALLOWED_ORIGINS = {
    "https://deputations.github.io",
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:5500", "http://127.0.0.1:5500",
    "http://localhost:3000", "http://127.0.0.1:3000",
}
# extra origins via env, comma-separated (e.g. a custom local port)
for _o in (os.environ.get("WA_BRIDGE_ORIGINS", "") or "").split(","):
    _o = _o.strip()
    if _o:
        ALLOWED_ORIGINS.add(_o)

_browser = {"pw": None, "ctx": None, "page": None}


def log(msg: str) -> None:
    print(f"[whatsapp_bridge] {msg}", file=sys.stderr, flush=True)


def ensure_browser():
    """Lazily launch (and reuse) the persistent logged-in browser/page."""
    if _browser["page"] is not None:
        return _browser["page"]
    pw = sync_playwright().start()
    pdir = ww.profile_dir()
    pdir.mkdir(parents=True, exist_ok=True)
    headless = os.environ.get("WA_HEADLESS") == "1"
    ctx = pw.chromium.launch_persistent_context(
        user_data_dir=str(pdir),
        headless=headless,
        viewport={"width": 1280, "height": 900},
        args=["--disable-blink-features=AutomationControlled"],
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(ww.WA["url"], wait_until="domcontentloaded")
    _browser.update(pw=pw, ctx=ctx, page=page)
    log("Browser ready.")
    return page


def shutdown_browser():
    try:
        if _browser["ctx"]:
            _browser["ctx"].close()
        if _browser["pw"]:
            _browser["pw"].stop()
    except Exception:  # noqa: BLE001
        pass
    _browser.update(pw=None, ctx=None, page=None)


def get_pending():
    rows, used = feed.load_normalized(SOURCE)
    pending = feed.compute_pending(rows, feed.load_ledger())
    return pending, used


class Handler(BaseHTTPRequestHandler):
    # ---- helpers ----
    def _cors(self):
        origin = self.headers.get("Origin", "")
        allow = origin if origin in ALLOWED_ORIGINS else "null"
        self.send_header("Access-Control-Allow-Origin", allow)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Private Network Access: allow secure pages (github.io) to reach localhost.
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Vary", "Origin")

    def _json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self._cors()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # silence default per-request stderr spam
        pass

    # ---- routes ----
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/health":
            try:
                page = ensure_browser()
                # Patient check — a cold browser needs ~10-15s before the pane shows.
                return self._json(200, {"ok": True, "logged_in": ww.wait_logged_in(page)})
            except Exception as exc:  # noqa: BLE001
                return self._json(200, {"ok": True, "logged_in": False, "error": str(exc)})
        if path == "/pending":
            try:
                pending, used = get_pending()
                return self._json(200, {"count": len(pending), "items": pending, "source": used})
            except Exception as exc:  # noqa: BLE001
                return self._json(500, {"error": str(exc)})
        return self._json(404, {"error": "not found"})

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/post":
            return self._json(404, {"error": "not found"})
        # Drain any body (button sends "{}").
        try:
            n = int(self.headers.get("Content-Length", "0") or "0")
            if n:
                self.rfile.read(n)
        except Exception:  # noqa: BLE001
            pass
        try:
            page = ensure_browser()
            if not ww.wait_logged_in(page):
                return self._json(409, {
                    "error": "not_logged_in",
                    "message": "WhatsApp Web isn't logged in. Run: "
                               "python scripts/whatsapp_watcher.py --login",
                })
            pending, _ = get_pending()
            if not pending:
                return self._json(200, {"posted": [], "failed": [], "count": 0,
                                        "requested": 0, "message": "nothing new"})
            res = ww.post_pending(page, pending, dry_run=False)
            res["count"] = len(res.get("posted", []))
            res["requested"] = len(pending)
            return self._json(200, res)
        except Exception as exc:  # noqa: BLE001
            return self._json(500, {"error": str(exc)})


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    srv = HTTPServer(("127.0.0.1", PORT), Handler)
    log(f"listening on http://127.0.0.1:{PORT}  (source={SOURCE}, "
        f"channel='{ww.WA['channel_name']}')")
    log("Leave this running. The admin 'Send WhatsApp Update' button calls it. "
        "Ctrl-C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("shutting down")
    finally:
        shutdown_browser()
        srv.server_close()


if __name__ == "__main__":
    main()
