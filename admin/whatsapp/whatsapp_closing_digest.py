#!/usr/bin/env python3
r"""whatsapp_closing_digest.py — the daily "closing tomorrow" digest poster.

Run by Windows Task Scheduler (default 11 AM). Self-sufficient: it launches the
Edge business-WhatsApp session (debug profile) if it isn't already up, connects
via CDP, posts ONE message listing every active+approved vacancy whose last date
to apply is tomorrow, and records it (idempotent per day). Only requirement: the
PC is on and the Edge profile (`%USERPROFILE%\edge-wa-business`) stays logged in.

Test without sending:
  python scripts/whatsapp_closing_digest.py --date 2026-06-08 --dry-run
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import whatsapp_feed as feed      # noqa: E402
import whatsapp_watcher as ww     # noqa: E402

try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright not installed. Run: pip install -r scripts/requirements.txt "
          "&& python -m playwright install chromium", file=sys.stderr)
    raise SystemExit(2)

CDP_PORT = int(os.environ.get("WA_CDP_PORT", "9222"))
CDP_URL = os.environ.get("WA_CDP_URL", f"http://127.0.0.1:{CDP_PORT}")
PROFILE = os.environ.get("WA_EDGE_PROFILE", str(Path.home() / "edge-wa-business"))
SOURCE = os.environ.get("WA_BRIDGE_SOURCE", "auto")


def log(m: str) -> None:
    print(f"[closing-digest] {m}", file=sys.stderr, flush=True)


def cdp_up() -> bool:
    try:
        urllib.request.urlopen(CDP_URL + "/json/version", timeout=4)
        return True
    except Exception:  # noqa: BLE001
        return False


def find_edge():
    for p in (
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    ):
        if os.path.exists(p):
            return p
    return None


def ensure_edge():
    """Make sure an Edge with the debug port is up. Returns True if reachable."""
    if cdp_up():
        return True
    edge = find_edge()
    if not edge:
        log("Microsoft Edge not found.")
        return False
    log("Launching Edge business session (debug profile)…")
    subprocess.Popen([edge, f"--remote-debugging-port={CDP_PORT}",
                      f"--user-data-dir={PROFILE}", "https://web.whatsapp.com/"])
    for _ in range(40):                 # wait up to ~40s for the port
        if cdp_up():
            return True
        time.sleep(1)
    return cdp_up()


def get_whatsapp_page(browser):
    for c in browser.contexts:
        for pg in c.pages:
            if "web.whatsapp.com" in (pg.url or ""):
                return pg
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    pg = ctx.new_page()
    pg.goto(ww.WA["url"], wait_until="domcontentloaded")
    return pg


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    ap = argparse.ArgumentParser(description="Daily 'closing tomorrow' digest.")
    ap.add_argument("--date", metavar="YYYY-MM-DD",
                    help="Override the target date (default: tomorrow).")
    ap.add_argument("--dry-run", action="store_true",
                    help="Do everything except send; report what would post.")
    args = ap.parse_args(argv)

    target = args.date or feed.tomorrow_iso()

    # Idempotency: never post the same day's digest twice.
    ledger = feed.load_ledger()
    digests = ledger.setdefault("digests", {})
    if not args.dry_run and target in digests and digests[target].get("count", 0) > 0:
        log(f"Already posted the digest for {target}; nothing to do.")
        return 0

    rows, used = feed.load_normalized(SOURCE)
    closing = feed.closing_on(rows, target)
    log(f"source={used} target={target} closing={len(closing)}")
    if not closing:
        log("Nothing closing — skipping (no empty-day post).")
        return 0

    if not ensure_edge():
        log("Could not reach/launch the Edge CDP session.")
        return 2

    pw = sync_playwright().start()
    try:
        browser = pw.chromium.connect_over_cdp(CDP_URL)
        page = get_whatsapp_page(browser)
        if not ww.wait_logged_in(page, timeout_ms=60000):
            log("Edge session is not logged into WhatsApp — open it and scan the QR.")
            return 1
        # Wait for the left rail (Channels nav) to actually render, then settle,
        # so a cold launch has its chat/channel lists synced before we navigate.
        for _ in range(30):
            try:
                if page.locator('button[aria-label="Channels"]').first.is_visible():
                    break
            except Exception:  # noqa: BLE001
                pass
            page.wait_for_timeout(1000)
        page.wait_for_timeout(4000)
        if not ww.open_channel(page):
            log("Could not open the channel.")
            return 1
        msg = feed.format_closing_digest(closing, target)
        if args.dry_run:
            log(f"[dry-run] channel opened OK — WOULD post {len(closing)} post(s) "
                f"for {target}:\n{msg}")
            return 0
        if ww.send_message(page, msg, "Closing Tomorrow"):
            digests[target] = {"posted_at": feed._now_iso(), "count": len(closing)}
            feed.save_ledger(ledger)
            log(f"Posted digest: {len(closing)} post(s) closing {target}.")
            return 0
        log("Send failed; not recording.")
        return 1
    finally:
        pw.stop()   # disconnect CDP only; never closes the user's Edge


if __name__ == "__main__":
    raise SystemExit(main())
