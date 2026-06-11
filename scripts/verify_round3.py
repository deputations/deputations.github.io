"""Verify the four follow-up fixes: location panel unclipped, Hide-filters on
top, animated toggle (smoke), days-date sub-line + hover readability."""
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
    pg.wait_for_timeout(1000)

    # expand filters → Hide button should be directly below the header
    pg.click("#desktopFilterToggle")
    pg.wait_for_timeout(900)
    order = pg.evaluate("""(() => {
        const sb = document.querySelector('.filters-sidebar');
        const items = [...sb.children].map(el => ({
            cls: el.className.split(' ')[0] || el.id,
            top: el.getBoundingClientRect().top
        })).sort((a, b) => a.top - b.top);
        return items.slice(0, 3).map(i => i.cls).join(' > ');
    })()""")
    print("visual order (top 3):", order)

    # location panel must NOT be clipped: panel right edge > sidebar right edge
    pg.click("#filterLocationBtn")
    pg.wait_for_timeout(500)
    geom = pg.evaluate("""(() => {
        const sb = document.querySelector('.filters-sidebar').getBoundingClientRect();
        const panel = document.getElementById('filterLocationPanel').getBoundingClientRect();
        const style = getComputedStyle(document.querySelector('.filters-sidebar'));
        return { sidebarRight: Math.round(sb.right), panelRight: Math.round(panel.right),
                 panelWidth: Math.round(panel.width), overflowY: style.overflowY };
    })()""")
    print("location panel geometry:", geom)
    pg.screenshot(path=os.path.join(OUT, "50-location-unclipped.png"))
    print("shot: 50-location-unclipped")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(OUT, "51-expanded-hide-on-top.png"))
    print("shot: 51-expanded-hide-on-top")

    # collapse again for the days-date check; hover a row mid-cell
    pg.click("#desktopFilterToggle")
    pg.wait_for_timeout(900)
    has_date = pg.evaluate("!!document.querySelector('.days-date-sub')")
    print("days-date-sub present:", has_date)
    row = pg.locator(".data-table tbody tr").nth(1)
    row.locator("td").nth(2).hover()
    pg.wait_for_timeout(700)
    color = row.locator(".days-date-sub").evaluate("el => getComputedStyle(el).color")
    print("days-date color on hover:", color)
    pg.screenshot(path=os.path.join(OUT, "52-days-date-hover.png"))
    print("shot: 52-days-date-hover")

    # light theme: same hover readability
    pg.evaluate("localStorage.setItem('deputation_theme_v1','light')")
    pg.reload(wait_until="networkidle")
    pg.wait_for_selector(".days-date-sub", timeout=15000)
    pg.wait_for_timeout(800)
    row = pg.locator(".data-table tbody tr").nth(1)
    row.locator("td").nth(2).hover()
    pg.wait_for_timeout(700)
    color_l = row.locator(".days-date-sub").evaluate("el => getComputedStyle(el).color")
    print("light days-date color on hover:", color_l)
    pg.screenshot(path=os.path.join(OUT, "53-light-days-date-hover.png"))
    print("shot: 53-light-days-date-hover")
    pg.evaluate("localStorage.setItem('deputation_theme_v1','dark')")

    b.close()

print("--- console errors ---")
print("\n".join(errors) if errors else "(none)")
