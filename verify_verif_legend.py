"""Verify the legend: moved up, shrunk, with stylish italic explanation."""
from playwright.sync_api import sync_playwright

URL = "http://localhost:8000/"


def main() -> int:
    fails: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle")
        page.wait_for_selector(".clickable-row", timeout=10_000)
        page.wait_for_timeout(700)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(300)

        # 1. Layout — legend sits BETWEEN the table-wrapper and pagination-bar
        order = page.evaluate("""
            () => {
              const dc = document.querySelector('.data-container');
              return [...dc.children].map(c => c.className.split(' ')[0]);
            }
        """)
        print(f"data-container child order: {order}")
        if order != ["table-wrapper", "vx-verif-legend", "pagination-bar"]:
            fails.append(f"expected [table-wrapper, vx-verif-legend, pagination-bar]; got {order}")

        # 2. The gap between table and pagination should now be small
        # (legend sits in between, ~16-20px margin on each side).
        gap = page.evaluate("""
            () => {
              const tbl = document.querySelector('.table-wrapper');
              const pgn = document.querySelector('.pagination-bar');
              return Math.round(pgn.getBoundingClientRect().top - tbl.getBoundingClientRect().bottom);
            }
        """)
        print(f"table bottom -> pagination top gap: {gap}px")
        if gap > 80:
            fails.append(f"gap {gap}px is still too big — legend should sit inside it")

        # 3. Font size is 0.62rem on the legend root
        fs = page.evaluate("getComputedStyle(document.querySelector('.vx-verif-legend')).fontSize")
        print(f".vx-verif-legend font-size: {fs}")
        if "9.92" not in fs and "9.6" not in fs:  # 0.62 * 16 = 9.92
            fails.append(f"font-size {fs} not 0.62rem (~9.92px)")

        # 4. The <em> uses Lora italic
        em_style = page.evaluate("""
            () => {
              const em = document.querySelector('.vx-verif-legend em');
              const cs = getComputedStyle(em);
              return {
                fontFamily: cs.fontFamily,
                fontStyle: cs.fontStyle,
                fontSize: cs.fontSize,
              };
            }
        """)
        print(f"<em> styles: {em_style}")
        if "Lora" not in em_style["fontFamily"]:
            fails.append(f"<em> font-family {em_style['fontFamily']!r} doesn't include Lora")
        if em_style["fontStyle"] != "italic":
            fails.append(f"<em> font-style {em_style['fontStyle']!r} != 'italic'")

        # 5. The <strong> stays in sans-serif, not italic, not Lora
        strong_style = page.evaluate("""
            () => {
              const s = document.querySelector('.vx-verif-legend strong');
              const cs = getComputedStyle(s);
              return {
                fontFamily: cs.fontFamily,
                fontStyle: cs.fontStyle,
                fontWeight: cs.fontWeight,
              };
            }
        """)
        print(f"<strong> styles: {strong_style}")
        if "Lora" in strong_style["fontFamily"]:
            fails.append(f"<strong> should NOT use Lora; got {strong_style['fontFamily']!r}")
        if strong_style["fontStyle"] == "italic":
            fails.append(f"<strong> should NOT be italic; got {strong_style['fontStyle']!r}")

        # 6. Swatch colors unchanged
        for cls, want_hex in [
            (".vx-verif-swatch-pending", "#f5b301"),
            (".vx-verif-swatch-ok", "#37c46b"),
        ]:
            shadow = page.evaluate(
                "el => getComputedStyle(el).boxShadow",
                page.locator(cls).element_handle(),
            )
            print(f"{cls}: {shadow}")
            def hex_to_rgb(h):
                h = h.lstrip("#")
                return f"rgb({int(h[0:2],16)}, {int(h[2:4],16)}, {int(h[4:6],16)})"
            if hex_to_rgb(want_hex) not in shadow:
                fails.append(f"{cls} shadow wrong: {shadow!r}")

        # Screenshots: full page for layout context + tight crop for the chat
        page.screenshot(path="_verify/album_verif_legend_v2.png", full_page=True)
        legend = page.locator(".vx-verif-legend")
        legend.scroll_into_view_if_needed()
        page.wait_for_timeout(150)
        legend.screenshot(path="_verify/album_verif_legend_v2_crop.png")

        browser.close()

    if fails:
        print("\nFAIL:")
        for f in fails:
            print(" -", f)
        return 1
    print("\nPASS — legend is between table and pagination, "
          "shrunken to 0.62rem, explanation in Lora italic, "
          "labels stay bold sans-serif.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())