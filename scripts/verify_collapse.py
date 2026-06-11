"""Verify the collapsible desktop filters experiment."""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8769"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_verify")
errors = []

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    pg.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

    # default = collapsed: compact card beside KPIs, full-width table
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_selector(".kpi-value", timeout=15000)
    pg.wait_for_timeout(1200)
    print("collapsed body class:", pg.evaluate("document.body.className"))
    print("visible filter groups:", pg.evaluate(
        "[...document.querySelectorAll('.filter-group')].filter(g => g.offsetParent !== null).length"))
    pg.screenshot(path=os.path.join(OUT, "40-collapsed-dark.png"))
    print("shot: 40-collapsed-dark")

    # the My Pay Level dropdown still works from the compact card
    pg.click("#filterMyPayLevelBtn")
    pg.wait_for_timeout(400)
    pg.screenshot(path=os.path.join(OUT, "41-collapsed-mylevel-open.png"))
    print("shot: 41-collapsed-mylevel-open")
    pg.keyboard.press("Escape")

    # expand -> original sidebar layout, button reads Hide filters
    pg.click("#desktopFilterToggle")
    pg.wait_for_timeout(600)
    print("expanded body class:", pg.evaluate("document.body.className"))
    print("button label:", pg.locator("#desktopFilterToggle span").inner_text())
    pg.screenshot(path=os.path.join(OUT, "42-expanded-dark.png"))
    print("shot: 42-expanded-dark")

    # collapse again
    pg.click("#desktopFilterToggle")
    pg.wait_for_timeout(500)
    print("re-collapsed label:", pg.locator("#desktopFilterToggle span").inner_text())

    # persistence: expanded preference survives reload
    pg.click("#desktopFilterToggle")
    pg.wait_for_timeout(300)
    pg.reload(wait_until="networkidle")
    pg.wait_for_selector(".kpi-value", timeout=15000)
    print("after reload (was expanded):", pg.evaluate("document.body.classList.contains('filters-collapsed') ? 'collapsed' : 'expanded'"))
    pg.evaluate("localStorage.removeItem('dep_filters_expanded_v1')")

    # light theme collapsed
    pg.reload(wait_until="networkidle")
    pg.wait_for_selector(".kpi-value", timeout=15000)
    pg.click("#themeToggle")
    pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(OUT, "43-collapsed-light.png"))
    print("shot: 43-collapsed-light")

    # mobile untouched: accordion + no desktop button
    mp = b.new_context(viewport={"width": 390, "height": 844}).new_page()
    mp.goto(BASE + "/", wait_until="networkidle")
    mp.wait_for_selector(".kpi-value", timeout=15000)
    mp.wait_for_timeout(800)
    print("mobile desktop-btn visible:", mp.evaluate("getComputedStyle(document.getElementById('desktopFilterToggle')).display"))
    mp.click(".mobile-filter-toggle")
    mp.wait_for_timeout(400)
    print("mobile accordion groups visible:", mp.evaluate(
        "[...document.querySelectorAll('.filter-group')].filter(g => g.offsetParent !== null).length"))
    mp.screenshot(path=os.path.join(OUT, "44-mobile-accordion.png"))
    print("shot: 44-mobile-accordion")

    b.close()

print("--- console errors ---")
print("\n".join(errors) if errors else "(none)")
