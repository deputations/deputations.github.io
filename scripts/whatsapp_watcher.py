#!/usr/bin/env python3
r"""whatsapp_watcher.py — the posting engine for the deputation WhatsApp Channel.

It drives a real (headed) Chromium logged into WhatsApp Web, because WhatsApp
**Channels have no API** — a post can only be created from a logged-in browser.
A persistent profile keeps you logged in after a one-time QR scan.

What it does each run: ask whatsapp_feed.py for approved+active rows not yet in
the ledger, open your channel, type each message, send it, confirm it appears,
then mark that row posted. The ledger is written ONLY after a confirmed send, so
killing it mid-run never double-posts — rerun and it resumes cleanly.

Setup (once)
  pip install -r scripts/requirements.txt
  python -m playwright install chromium
  python scripts/whatsapp_watcher.py --login      # scan the QR in the window
  python scripts/whatsapp_watcher.py --dry-run     # opens channel, finds the
                                                   # compose box, prints what it
                                                   # WOULD send — never sends.

Run
  python scripts/whatsapp_watcher.py --once                 # post pending, exit
  python scripts/whatsapp_watcher.py --watch --interval 300 # loop every 5 min

Config (override via environment, or edit the WA dict below)
  WA_PROFILE_DIR    browser profile dir (default ~/.deputations-wa/wa-profile;
                    kept OUT of the Google-Drive repo so it isn't synced)
  WA_CHANNEL_NAME   your channel's display name as shown in WhatsApp (used to
                    find/open it). Verify with --dry-run.
  WA_CHANNEL_URL    the channel invite link (fallback way to open it)
  WA_HEADLESS=1     run headless (NOT recommended — WhatsApp Web flags it)
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

# Reuse the engine-agnostic core (same folder).
sys.path.insert(0, str(Path(__file__).resolve().parent))
import whatsapp_feed as feed  # noqa: E402

try:
    from playwright.sync_api import TimeoutError as PWTimeout
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright is not installed. Run:\n"
          "  pip install -r scripts/requirements.txt\n"
          "  python -m playwright install chromium", file=sys.stderr)
    raise SystemExit(2)


# ---------------------------------------------------------------------------
# WhatsApp Web wiring. The DOM is obfuscated and changes occasionally; keep
# everything UI-specific here so a future breakage is a one-spot fix. Selectors
# are ordered lists of fallbacks — the first that matches wins. Validate the
# whole open→find path safely with --dry-run.
# ---------------------------------------------------------------------------
WA = {
    "url": "https://web.whatsapp.com/",
    "channel_name": os.environ.get("WA_CHANNEL_NAME", "Deputation Opportunities"),
    "channel_url": os.environ.get(
        "WA_CHANNEL_URL",
        "https://whatsapp.com/channel/0029Vb7VCoq2ZjCnZq0tfz3W",
    ),
    # logged-in once this appears (the chat/updates list pane)
    "logged_in": ["#pane-side", 'div[aria-label="Chat list"]'],
    # still showing the QR / intro = logged out
    "logged_out": ['canvas[aria-label*="Scan"]', 'div[data-ref]', 'div[aria-label*="Scan"]'],
    # the global search box (to find the channel by name)
    "search_box": [
        'div[aria-label="Search input textbox"]',
        'div[contenteditable="true"][data-tab="3"]',
        'div[role="textbox"][contenteditable="true"]',
    ],
    # the left-rail "Channels" nav button (switches to the Channels list)
    "channels_nav": [
        'button[aria-label="Channels"]',
        'header [aria-label="Channels"]',
        '[aria-label="Channels"]',
    ],
    # the message compose box at the bottom of an open chat/channel.
    # Scoped to <footer> so it never matches the search box (also contenteditable).
    "compose_box": [
        'footer div[contenteditable="true"][data-tab="10"]',
        'footer div[contenteditable="true"][data-lexical-editor="true"]',
        'footer div[contenteditable="true"]',
        'div[aria-label^="Type a message"]',
    ],
    # optional explicit send button (we try Enter first)
    "send_button": ['button[aria-label="Send"]', 'span[data-icon="send"]'],
}


def log(msg: str) -> None:
    print(f"[whatsapp_watcher] {msg}", file=sys.stderr, flush=True)


def profile_dir() -> Path:
    env = os.environ.get("WA_PROFILE_DIR")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".deputations-wa" / "wa-profile"


def _first(page, selectors, timeout=4000):
    """Return the first selector (as a Locator) that becomes visible, or None."""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=timeout)
            return loc
        except PWTimeout:
            continue
        except Exception:  # noqa: BLE001
            continue
    return None


def is_logged_in(page) -> bool:
    return _first(page, WA["logged_in"], timeout=3000) is not None


def wait_logged_in(page, timeout_ms: int = 40000) -> bool:
    """Patiently wait for WhatsApp Web to finish booting. Returns True as soon as
    the chat/updates pane appears, False as soon as the QR (logged-out) shows, or
    False after the timeout. A cold launch takes ~10-15s, so the quick
    is_logged_in() check false-negatives right after startup — gating paths
    (the bridge, --once, --watch) use this instead."""
    waited = 0
    step = 1000
    while waited < timeout_ms:
        for sel in WA["logged_in"]:
            try:
                if page.locator(sel).first.is_visible():
                    return True
            except Exception:  # noqa: BLE001
                pass
        for sel in WA["logged_out"]:
            try:
                if page.locator(sel).first.is_visible():
                    return False
            except Exception:  # noqa: BLE001
                pass
        page.wait_for_timeout(step)
        waited += step
    return False


# ---------------------------------------------------------------------------
# Open the channel
# ---------------------------------------------------------------------------
def _on_target_channel(page, name) -> bool:
    """Is the open conversation header showing our channel name?"""
    try:
        return page.locator(f'header :text("{name}")').first.is_visible()
    except Exception:  # noqa: BLE001
        return False


def open_channel(page) -> bool:
    """Open the target channel inside web.whatsapp.com. Returns True on success."""
    name = WA["channel_name"]

    # Already open? (common when attached to the real Chrome via CDP, where the
    # user keeps the channel open). Only accept it if the header is OUR channel.
    if _first(page, WA["compose_box"], timeout=2500) and _on_target_channel(page, name):
        log(f"Channel '{name}' already open.")
        return True

    # Strategy 0: click the left-rail Channels nav, then the channel by name.
    # Retry a few times — on a COLD browser launch the channel list takes several
    # seconds to sync, so the channel item isn't there on the first attempt.
    if not name:
        name = ""
    for attempt in range(6):
        nav = _first(page, WA["channels_nav"], timeout=5000)
        if not name:
            break
        if not nav:                       # left rail not ready yet on a cold load
            page.wait_for_timeout(3000)
            continue
        try:
            nav.click()
            page.wait_for_timeout(2500)
            item = page.locator(
                f'span[title="{name}"], span[title="{name} Channel"], '
                f'[aria-label="{name}"], [aria-label="{name} Channel"]'
            ).first
            item.wait_for(state="visible", timeout=8000)
            item.click()
            page.wait_for_timeout(1800)
            if _first(page, WA["compose_box"], timeout=8000):
                log(f"Opened channel '{name}' via Channels nav.")
                return True
        except Exception as exc:  # noqa: BLE001
            log(f"Channels-nav attempt {attempt + 1}/6 failed ({exc}); "
                "waiting for the list to sync…")
        page.wait_for_timeout(4000)

    # Strategy A: search by name and click the first matching result.
    search = _first(page, WA["search_box"], timeout=6000)
    if search and name:
        try:
            search.click()
            page.keyboard.type(name)
            page.wait_for_timeout(1500)
            # A result row whose title contains the channel name.
            result = page.locator(
                f'span[title="{name}"], div[role="listitem"] span[title*="{name}"]'
            ).first
            result.wait_for(state="visible", timeout=5000)
            result.click()
            page.wait_for_timeout(1200)
            # Clear the search so the next run starts clean.
            try:
                page.keyboard.press("Escape")
            except Exception:  # noqa: BLE001
                pass
            if _first(page, WA["compose_box"], timeout=6000):
                log(f"Opened channel '{name}' via search.")
                return True
        except Exception as exc:  # noqa: BLE001
            log(f"Search-open failed ({exc}); trying the invite link.")

    # Strategy B: the channel invite link (web.whatsapp.com resolves it in-app).
    try:
        page.goto(WA["channel_url"], wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        # Some flows show a "View in WhatsApp" / continue button.
        for label in ("View in WhatsApp", "Continue", "Open"):
            btn = page.locator(f'text="{label}"').first
            try:
                if btn.is_visible(timeout=1000):
                    btn.click()
                    page.wait_for_timeout(2000)
            except Exception:  # noqa: BLE001
                pass
        if _first(page, WA["compose_box"], timeout=6000):
            log("Opened channel via invite link.")
            return True
    except Exception as exc:  # noqa: BLE001
        log(f"Invite-link open failed ({exc}).")

    log("Could not open the channel or find a compose box. "
        "Check WA_CHANNEL_NAME and that you can post to it as admin.")
    return False


# ---------------------------------------------------------------------------
# Send one message
# ---------------------------------------------------------------------------
def send_message(page, message: str, verify_snippet: str) -> bool:
    box = _first(page, WA["compose_box"], timeout=6000)
    if not box:
        log("No compose box — are you an admin able to post to this channel?")
        return False
    try:
        box.click()
        lines = message.split("\n")
        for i, line in enumerate(lines):
            if i:
                page.keyboard.press("Shift+Enter")  # newline, not send
            if line:
                page.keyboard.type(line)
        page.wait_for_timeout(300)
        # Send: Enter, falling back to an explicit send button.
        page.keyboard.press("Enter")
        page.wait_for_timeout(1500)
    except Exception as exc:  # noqa: BLE001
        log(f"Typing/sending failed ({exc}).")
        return False

    # Verify: success = the compose box clears after a send (most reliable for
    # channels), with the snippet appearing in the thread as a fallback.
    box2 = _first(page, WA["compose_box"], timeout=3000)
    for _ in range(10):
        try:
            if box2 is not None and not (box2.inner_text() or "").strip():
                log("Send confirmed (compose box cleared).")
                return True
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(500)
    try:
        snippet = (verify_snippet or "").strip()[:40]
        if snippet:
            page.locator(f'[data-id]:has-text("{snippet}")').last.wait_for(
                state="visible", timeout=4000)
            log("Send confirmed (snippet in thread).")
            return True
    except Exception:  # noqa: BLE001
        pass
    log("Could not confirm the message appeared; NOT marking as posted.")
    return False


# ---------------------------------------------------------------------------
# Ledger helper (reuse the core)
# ---------------------------------------------------------------------------
def mark_posted(key: str) -> None:
    ledger = feed.load_ledger()
    ledger.setdefault("posted", {})[key] = {
        "posted_at": feed._now_iso(), "seeded": False
    }
    feed.save_ledger(ledger)


def get_pending(source: str):
    rows, used = feed.load_normalized(source)
    pending = feed.compute_pending(rows, feed.load_ledger())
    log(f"source={used} pending={len(pending)}")
    return pending


# ---------------------------------------------------------------------------
# Top-level flows
# ---------------------------------------------------------------------------
def _verify_snippet(msg: str) -> str:
    """The post-name line (📌) is the most distinctive — use it to confirm a send."""
    for line in msg.split("\n"):
        if line.startswith("\U0001F4CC"):  # 📌
            return line.replace("\U0001F4CC", "").replace("*", "").strip()
    return ""


def post_pending(page, pending, dry_run: bool = False) -> dict:
    """Post a given list of {vacancy_id, message}. Opens the channel first (for
    real sends), marks the ledger ONLY after each confirmed send, and stops on
    the first failure. Returns {'posted': [...], 'failed': [...], 'dry_run': bool}.
    Shared by the CLI (--once) and the local bridge so behaviour is identical."""
    result = {"posted": [], "failed": [], "dry_run": dry_run}
    if not pending:
        return result
    if dry_run:
        for item in pending:
            log(f"[dry-run] WOULD post {item['vacancy_id']}:\n{item['message']}\n" + "-" * 40)
        return result
    if not open_channel(page):
        result["error"] = "could not open the channel"
        result["failed"] = [it["vacancy_id"] for it in pending]
        return result
    for item in pending:
        vid, msg = item["vacancy_id"], item["message"]
        key = item.get("key") or vid
        if send_message(page, msg, _verify_snippet(msg)):
            mark_posted(key)
            result["posted"].append(vid)
            log(f"Posted {vid} ({len(result['posted'])}/{len(pending)}).")
            page.wait_for_timeout(2500)  # be gentle between messages
        else:
            result["failed"].append(vid)
            log(f"Stopping after a failed send on {vid}; will retry next run.")
            break
    return result


def post_once(page, source: str, dry_run: bool = False) -> int:
    pending = get_pending(source)
    if not pending:
        log("Nothing new to post.")
        return 0
    return len(post_pending(page, pending, dry_run=dry_run)["posted"])


def run(args) -> int:
    pdir = profile_dir()
    pdir.mkdir(parents=True, exist_ok=True)
    headless = os.environ.get("WA_HEADLESS") == "1" or args.headless

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(pdir),
            headless=headless,
            viewport={"width": 1280, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        try:
            page.goto(WA["url"], wait_until="domcontentloaded")
        except Exception as exc:  # noqa: BLE001
            log(f"Could not load WhatsApp Web ({exc}).")
            ctx.close()
            return 2

        # --login: wait for the QR to be scanned, then persist and exit.
        if args.login:
            log("Opened WhatsApp Web. If prompted, scan the QR with your phone "
                "(Settings → Linked devices). Waiting up to 180s…")
            deadline = time.time() + 180
            while time.time() < deadline:
                if is_logged_in(page):
                    log("Logged in. Profile saved — future runs reuse it.")
                    ctx.close()
                    return 0
                page.wait_for_timeout(2000)
            log("Did not detect login within 180s. Try again.")
            ctx.close()
            return 1

        # Every other flow needs an authenticated session. Wait patiently —
        # a cold browser takes ~10-15s before the chat pane appears.
        if not wait_logged_in(page):
            log("Not logged in. Run:  python scripts/whatsapp_watcher.py --login")
            ctx.close()
            return 1

        try:
            if args.watch:
                interval = max(30, args.interval)
                log(f"Watching: posting new rows every {interval}s. Ctrl-C to stop.")
                while True:
                    try:
                        post_once(page, args.source, dry_run=False)
                    except Exception as exc:  # noqa: BLE001 — survive transient errors
                        log(f"Run errored ({exc}); will retry next interval.")
                    # Return to the main list so the next search starts clean.
                    try:
                        page.goto(WA["url"], wait_until="domcontentloaded")
                    except Exception:  # noqa: BLE001
                        pass
                    page.wait_for_timeout(interval * 1000)
            else:
                return 1 if post_once(page, args.source, dry_run=args.dry_run) < 0 else 0
        except KeyboardInterrupt:
            log("Stopped by user.")
        finally:
            ctx.close()
    return 0


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    parser = argparse.ArgumentParser(description="WhatsApp Channel poster (engine).")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--login", action="store_true",
                      help="Open WhatsApp Web and wait for a one-time QR scan.")
    mode.add_argument("--dry-run", action="store_true",
                      help="Open the channel and print what WOULD be posted; never sends.")
    mode.add_argument("--once", action="store_true",
                      help="Post all pending rows once, then exit (default).")
    mode.add_argument("--watch", action="store_true",
                      help="Loop forever, posting new rows every --interval seconds.")
    parser.add_argument("--interval", type=int, default=300,
                        help="Seconds between checks in --watch mode (default 300).")
    parser.add_argument("--source", choices=["auto", "supabase", "json"], default="auto",
                        help="Where whatsapp_feed reads vacancies (default auto).")
    parser.add_argument("--headless", action="store_true",
                        help="Run headless (not recommended).")
    args = parser.parse_args(argv)
    return run(args)


if __name__ == "__main__":
    raise SystemExit(main())
