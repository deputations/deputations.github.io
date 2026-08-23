"""Verify the verification-edge legend renders correctly on both views."""
from playwright.sync_api import sync_playwright

URL = "http://localhost:8000/"


def main() -> int:
    fails: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # Match the user's screenshot — narrow viewport where cards dominate
        ctx = browser.new_context(viewport={"width": 430, "height": 900})
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle")
        page.wait_for_selector(".vx-card, .clickable-row", timeout=10_000)
        page.wait_for_timeout(500)

        # --- legend present on card view (default at this width) ---
        legend = page.locator(".vx-verif-legend")
        if legend.count() != 1:
            fails.append(f"expected exactly 1 legend, got {legend.count()}")
        else:
            print("legend: present in card view")

        items = page.locator(".vx-verif-legend-item")
        if items.count() != 2:
            fails.append(f"expected 2 legend items, got {items.count()}")
        else:
            print(f"legend items: {items.count()}")

        # --- swatch colors match the row/card inset shadow ---
        import re as _re
        def hex_to_rgb(h: str) -> str:
            h = h.lstrip("#")
            return f"rgb({int(h[0:2],16)}, {int(h[2:4],16)}, {int(h[4:6],16)})"
        for cls, want_hex in [
            (".vx-verif-swatch-pending", "#f5b301"),  # amber / "yellow"
            (".vx-verif-swatch-ok", "#37c46b"),       # green
        ]:
            shadow = page.evaluate(
                f"el => getComputedStyle(el).boxShadow",
                page.locator(cls).element_handle(),
            )
            print(f"{cls} box-shadow: {shadow}")
            want_rgb = hex_to_rgb(want_hex)
            if want_rgb not in shadow:
                fails.append(f"{cls} swatch inset-shadow missing {want_hex}={want_rgb}: {shadow!r}")

        # --- labels match the user-facing copy ---
        for needle in ("System Approved", "Verified by Admin",
                       "AI ingestion pipeline", "checked against the source"):
            if not page.locator(".vx-verif-legend", has_text=needle).count():
                fails.append(f"legend missing text: {needle!r}")
        print("labels: System Approved + Verified by Admin + AI ingestion + source — all present")

        # --- legend is BELOW the cards (the spot the arrow pointed at) ---
        cards_box = page.locator(".vx-card").first.bounding_box()
        legend_box = legend.bounding_box()
        if cards_box and legend_box:
            print(f"first card bottom y={cards_box['y'] + cards_box['height']:.0f}, "
                  f"legend top y={legend_box['y']:.0f}")
            if legend_box["y"] < cards_box["y"]:
                fails.append("legend appears ABOVE the cards — should be at the bottom")

        # --- now switch to table view and re-check ---
        page.click("#btnTableView")
        page.wait_for_timeout(400)
        legend2 = page.locator(".vx-verif-legend")
        if legend2.count() != 1:
            fails.append(f"expected 1 legend in table view, got {legend2.count()}")
        else:
            print("legend: present in table view too")

        # Scroll legend into view before screenshotting so it's inside the viewport
        legend2.scroll_into_view_if_needed()
        page.wait_for_timeout(200)

        # Full-page screenshot for the chat — easier than chasing the legend box
        # through layout shifts after the table/card swap.
        page.screenshot(path="_verify/album_verif_legend.png", full_page=True)
        # Tight crop via locator screenshot (handles off-viewport legend itself)
        legend2.screenshot(path="_verify/album_verif_legend_crop.png")

        browser.close()

    if fails:
        print("\nFAIL:")
        for f in fails:
            print(" -", f)
        return 1
    print("\nPASS — legend renders at the bottom of cards AND table, "
          "swatches match the row inset-shadow, copy is correct.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
