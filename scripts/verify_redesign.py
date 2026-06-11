"""Walk the redesigned home page with Playwright and capture screenshots.

Saves PNGs to _verify/ (gitignored junk folder) and prints console errors.
Run with the static server already up:  python scripts/verify_redesign.py
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8769"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_verify")
os.makedirs(OUT, exist_ok=True)

errors: list[str] = []


def shot(page, name: str, full: bool = False) -> None:
    page.screenshot(path=os.path.join(OUT, name + ".png"), full_page=full)
    print("shot:", name)


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        # ---------- dark / desktop ----------
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".kpi-value", timeout=15000)
        page.wait_for_timeout(1200)
        shot(page, "01-dark-desktop-table")

        # card view
        page.click("#btnCardView")
        page.wait_for_timeout(700)
        shot(page, "02-dark-desktop-cards")

        # expand a group card if present
        if page.locator(".vx-expand").count():
            page.locator(".vx-expand").first.click()
            page.wait_for_timeout(400)
            shot(page, "03-dark-group-expanded")

        # open detail dialog
        page.locator(".vx-card").first.click()
        page.wait_for_timeout(800)
        shot(page, "04-dark-dialog")
        url_with_v = page.url
        print("dialog url:", url_with_v)

        # esc closes + url restored
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)
        print("after esc url:", page.url, "| dialog open:", page.evaluate("document.getElementById('modal').open"))

        # ---------- light theme ----------
        page.click("#themeToggle")
        page.wait_for_timeout(600)
        shot(page, "05-light-desktop-cards")
        page.click("#btnTableView")
        page.wait_for_timeout(600)
        shot(page, "06-light-desktop-table")
        page.click("#themeToggle")  # back to dark
        page.wait_for_timeout(400)

        # ---------- permalink cold load ----------
        vid = page.evaluate("(window.__probe = document.querySelector('[data-open-details]')?.getAttribute('data-open-details'))")
        if vid:
            page.goto(f"{BASE}/?v={vid}", wait_until="networkidle")
            page.wait_for_timeout(1200)
            is_open = page.evaluate("document.getElementById('modal').open")
            print("cold ?v= open:", is_open, "for", vid)
            shot(page, "07-dark-cold-permalink")
            page.keyboard.press("Escape")
            page.wait_for_timeout(400)
            print("cold close url:", page.url)

        # bad permalink → toast, no crash
        page.goto(f"{BASE}/?v=NOPE-123", wait_until="networkidle")
        page.wait_for_timeout(1000)
        print("bad ?v= url now:", page.url)

        # ---------- mobile 390 ----------
        mob = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
        mpage = mob.new_page()
        mpage.on("console", lambda m: errors.append(f"[m:{m.type}] {m.text}") if m.type == "error" else None)
        mpage.on("pageerror", lambda e: errors.append(f"[m:pageerror] {e}"))
        mpage.goto(BASE + "/", wait_until="networkidle")
        mpage.wait_for_selector(".kpi-value", timeout=15000)
        mpage.wait_for_timeout(1200)
        shot(mpage, "08-dark-mobile-top")
        mpage.mouse.wheel(0, 900)
        mpage.wait_for_timeout(500)
        shot(mpage, "09-dark-mobile-cards")
        # mobile dialog (full-height sheet)
        mpage.locator(".vx-card").first.click()
        mpage.wait_for_timeout(700)
        shot(mpage, "10-dark-mobile-dialog")

        # ---------- other pages keep working ----------
        page.set_viewport_size({"width": 1440, "height": 900})
        for nm, path in [("11-rules", "/rules.html"), ("12-my-deputation", "/my-deputation.html"), ("13-contact", "/contact.html")]:
            page.goto(BASE + path, wait_until="networkidle")
            page.wait_for_timeout(900)
            shot(page, nm)

        browser.close()

    print("\n--- console errors/warnings ---")
    print("\n".join(errors) if errors else "(none)")


if __name__ == "__main__":
    main()
