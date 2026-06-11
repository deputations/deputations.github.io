"""Second verification pass: remaining pages + sort / load-more / light-mobile."""
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8769"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_verify")
os.makedirs(OUT, exist_ok=True)
errors = []


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))

        for nm, path in [("20-defex", "/defex.html"), ("21-report-vacancy", "/report-vacancy.html"), ("22-faq", "/Rules/faq.html")]:
            page.goto(BASE + path, wait_until="networkidle")
            page.wait_for_timeout(900)
            page.screenshot(path=os.path.join(OUT, nm + ".png"))
            print("shot:", nm)

        # index: card view → sort change → load more
        page.goto(BASE + "/", wait_until="networkidle")
        page.wait_for_selector(".kpi-value", timeout=15000)
        page.click("#btnCardView")
        page.wait_for_timeout(500)
        first_before = page.locator(".vx-title").first.inner_text()
        page.click("#cardSortBtn")
        page.wait_for_timeout(300)
        page.locator("#cardSortList button", has_text="Post name").click()
        page.wait_for_timeout(700)
        first_after = page.locator(".vx-title").first.inner_text()
        print("sort: first card before:", first_before, "| after A-Z:", first_after)
        page.screenshot(path=os.path.join(OUT, "23-sorted-az.png"))

        cards_before = page.locator(".vx-card").count()
        page.locator("[data-load-more]").scroll_into_view_if_needed()
        page.click("[data-load-more]")
        page.wait_for_timeout(700)
        cards_after = page.locator(".vx-card").count()
        print(f"load more: {cards_before} -> {cards_after} cards")
        page.screenshot(path=os.path.join(OUT, "24-load-more.png"))

        # share button exists on cards; WhatsApp + copy in dialog
        page.locator(".vx-card").first.click()
        page.wait_for_timeout(600)
        has_wa = page.locator('[data-modal-action="share-wa"]').count()
        has_copy = page.locator('[data-modal-action="copy-link"]').count()
        print("dialog share buttons — wa:", has_wa, "copy:", has_copy)
        page.keyboard.press("Escape")

        # light mobile
        mob = browser.new_context(viewport={"width": 390, "height": 844})
        mp = mob.new_page()
        mp.goto(BASE + "/", wait_until="domcontentloaded")
        mp.evaluate("localStorage.setItem('deputation_theme_v1','light')")
        mp.goto(BASE + "/", wait_until="networkidle")
        mp.wait_for_selector(".kpi-value", timeout=15000)
        mp.wait_for_timeout(1000)
        mp.screenshot(path=os.path.join(OUT, "25-light-mobile.png"))
        print("shot: 25-light-mobile")
        mp.mouse.wheel(0, 800)
        mp.wait_for_timeout(400)
        mp.screenshot(path=os.path.join(OUT, "26-light-mobile-cards.png"))
        print("shot: 26-light-mobile-cards")

        browser.close()

    print("\n--- console errors ---")
    print("\n".join(errors) if errors else "(none)")


if __name__ == "__main__":
    main()
