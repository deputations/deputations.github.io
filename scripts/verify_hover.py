"""Hover a table row in light theme and capture the plank state."""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8769"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_verify")

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1440, "height": 900}).new_page()
    pg.goto(BASE + "/", wait_until="domcontentloaded")
    pg.evaluate("localStorage.setItem('deputation_theme_v1','light')")
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_selector(".data-table tbody tr", timeout=15000)
    pg.wait_for_timeout(1000)

    row = pg.locator(".data-table tbody tr").nth(1)
    row.locator("td").nth(2).hover()  # hover a middle cell (not Notification/Bookmark)
    pg.wait_for_timeout(700)
    color = row.locator(".table-subtext").evaluate("el => getComputedStyle(el).color")
    print("subtext color on hover:", color)
    pg.screenshot(path=os.path.join(OUT, "27-light-hover-fixed.png"))
    print("shot: 27-light-hover-fixed")

    # dark theme sanity
    pg.evaluate("localStorage.setItem('deputation_theme_v1','dark')")
    pg.goto(BASE + "/", wait_until="networkidle")
    pg.wait_for_selector(".data-table tbody tr", timeout=15000)
    pg.wait_for_timeout(800)
    row = pg.locator(".data-table tbody tr").nth(1)
    row.locator("td").nth(2).hover()
    pg.wait_for_timeout(700)
    color_d = row.locator(".table-subtext").evaluate("el => getComputedStyle(el).color")
    print("dark subtext color on hover:", color_d)
    pg.screenshot(path=os.path.join(OUT, "28-dark-hover.png"))
    print("shot: 28-dark-hover")
    b.close()
