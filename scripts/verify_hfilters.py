"""Verify the horizontal-filters experiment: layout, dropdowns, mobile accordion."""
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

    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_selector(".kpi-value", timeout=15000)
    pg.wait_for_timeout(1200)
    pg.screenshot(path=os.path.join(OUT, "30-hfilters-dark.png"))
    print("shot: 30-hfilters-dark")

    # open the Ministry dropdown from the bar — panel must overlay the table
    pg.click("#filterMinistryBtn")
    pg.wait_for_timeout(450)
    pg.screenshot(path=os.path.join(OUT, "31-hfilters-dropdown.png"))
    print("shot: 31-hfilters-dropdown")
    pg.keyboard.press("Escape")

    # location panel (right-anchored)
    pg.click("#filterLocationBtn")
    pg.wait_for_timeout(450)
    pg.screenshot(path=os.path.join(OUT, "32-hfilters-location.png"))
    print("shot: 32-hfilters-location")
    pg.keyboard.press("Escape")

    # light theme
    pg.click("#themeToggle")
    pg.wait_for_timeout(600)
    pg.screenshot(path=os.path.join(OUT, "33-hfilters-light.png"))
    print("shot: 33-hfilters-light")
    pg.click("#themeToggle")

    # a filter still filters (smoke): pick a quick filter and read the count line
    before = pg.locator("#resultsCount").inner_text()
    pg.click('[data-quick-filter="closing7"]')
    pg.wait_for_timeout(600)
    after = pg.locator("#resultsCount").inner_text()
    print("filter smoke:", before, "->", after)
    pg.click('[data-quick-filter="closing7"]')

    # mobile: accordion still stacks
    mp = b.new_context(viewport={"width": 390, "height": 844}).new_page()
    mp.goto(BASE + "/", wait_until="networkidle")
    mp.wait_for_selector(".kpi-value", timeout=15000)
    mp.wait_for_timeout(900)
    mp.screenshot(path=os.path.join(OUT, "34-hfilters-mobile.png"))
    print("shot: 34-hfilters-mobile")
    mp.click(".mobile-filter-toggle")
    mp.wait_for_timeout(500)
    mp.screenshot(path=os.path.join(OUT, "35-hfilters-mobile-open.png"))
    print("shot: 35-hfilters-mobile-open")

    b.close()

print("--- console errors ---")
print("\n".join(errors) if errors else "(none)")
