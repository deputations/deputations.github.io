"""Re-check light loading rows + mobile loading cards (clean route teardown)."""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8769"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_verify")


def capture(b, name, width, height, theme):
    ctx = b.new_context(viewport={"width": width, "height": height})
    pg = ctx.new_page()
    pg.goto(BASE + "/", wait_until="domcontentloaded")
    pg.evaluate(f"localStorage.setItem('deputation_theme_v1','{theme}')")

    def hold(route):
        try:
            pg.wait_for_timeout(3500)
            route.continue_()
        except Exception:
            try:
                route.abort()
            except Exception:
                pass

    pg.route("**/rest/v1/vacancies*", hold)
    pg.goto(BASE + "/", wait_until="domcontentloaded")
    pg.wait_for_timeout(900)
    pg.screenshot(path=os.path.join(OUT, name + ".png"))
    print("shot:", name)
    pg.unroute_all(behavior="ignoreErrors")
    ctx.close()


with sync_playwright() as p:
    b = p.chromium.launch()
    capture(b, "64-loading-light-fixed", 1440, 900, "light")
    capture(b, "65-loading-mobile-dark", 390, 844, "dark")
    b.close()
print("done")
