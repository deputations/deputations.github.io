"""Capture the initial loading state by delaying the Supabase request."""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8769"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_verify")
errors = []


def delayed(route):
    route.continue_()


with sync_playwright() as p:
    b = p.chromium.launch()

    # desktop dark — delay the data request 4s, screenshot the skeleton at ~0.8s
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    ctx.route("**/rest/v1/vacancies*", lambda r: (ctx.set_default_timeout(30000), r.continue_(), None)[-1])
    pg = ctx.new_page()
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errors.append(str(e)))

    # intercept and hold the response
    def hold(route):
        pg.wait_for_timeout(4000)
        route.continue_()
    pg.route("**/rest/v1/vacancies*", hold)

    pg.goto(BASE + "/", wait_until="domcontentloaded")
    pg.wait_for_timeout(900)
    n_kpi = pg.evaluate("document.querySelectorAll('.kpi-skeleton').length")
    n_rows = pg.evaluate("document.querySelectorAll('.loading-row').length")
    print("skeleton kpis:", n_kpi, "| shimmer rows:", n_rows)
    pg.screenshot(path=os.path.join(OUT, "60-loading-dark-desktop.png"))
    print("shot: 60-loading-dark-desktop")

    # after data lands, the real content replaces it
    pg.wait_for_selector(".kpi-value[data-count]", timeout=20000)
    pg.wait_for_timeout(900)
    pg.screenshot(path=os.path.join(OUT, "61-loaded-dark-desktop.png"))
    print("shot: 61-loaded-dark-desktop")
    ctx.close()

    # light desktop loading
    ctx2 = b.new_context(viewport={"width": 1440, "height": 900})
    pg2 = ctx2.new_page()
    pg2.goto(BASE + "/", wait_until="domcontentloaded")
    pg2.evaluate("localStorage.setItem('deputation_theme_v1','light')")

    def hold2(route):
        pg2.wait_for_timeout(4000)
        route.continue_()
    pg2.route("**/rest/v1/vacancies*", hold2)
    pg2.goto(BASE + "/", wait_until="domcontentloaded")
    pg2.wait_for_timeout(900)
    pg2.screenshot(path=os.path.join(OUT, "62-loading-light-desktop.png"))
    print("shot: 62-loading-light-desktop")
    ctx2.close()

    # mobile dark loading (card skeletons)
    ctx3 = b.new_context(viewport={"width": 390, "height": 844})
    pg3 = ctx3.new_page()

    def hold3(route):
        pg3.wait_for_timeout(4000)
        route.continue_()
    pg3.route("**/rest/v1/vacancies*", hold3)
    pg3.goto(BASE + "/", wait_until="domcontentloaded")
    pg3.wait_for_timeout(900)
    print("mobile sk-cards:", pg3.evaluate("document.querySelectorAll('.sk-card').length"))
    pg3.screenshot(path=os.path.join(OUT, "63-loading-mobile.png"))
    print("shot: 63-loading-mobile")
    ctx3.close()

    b.close()

print("errors:", errors if errors else "none")
