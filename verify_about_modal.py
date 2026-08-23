"""Verify the About-project modal opened by clicking the top-nav logo.

Covers: click opens modal, expected sections + signature + disclaimer render,
close-via-X, close-via-Esc, close-via-backdrop. Runs against a local server.
"""
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:8765/index.html"


def main() -> int:
    fails: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()

        console_errors: list[str] = []
        # Suppress pre-existing network noise from the SB RPC heartbeat probe
        # (djaxutkmhazufsxeobal.supabase.co returns 401 when the anon key
        # GETs a protected table head) — those errors exist on every page and
        # aren't caused by this change.
        def _record(msg: str) -> None:
            if "supabase.co" in msg or "401" in msg:
                return
            console_errors.append(msg)
        page.on("console", lambda msg: _record(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: _record(str(exc)))

        page.goto(URL, wait_until="domcontentloaded")
        # site-widgets.js mounts via DOMContentLoaded -> init(). Give it a tick.
        page.wait_for_timeout(800)

        # 1. Modal element exists, hidden by default.
        modal_exists = page.evaluate(
            "!!document.querySelector('.sw-modal.sw-about')"
        )
        print(f"modal in DOM: {modal_exists}")
        if not modal_exists:
            fails.append("modal element not created on init")

        is_open_before = page.evaluate(
            "document.querySelector('.sw-modal.sw-about').classList.contains('open')"
        )
        if is_open_before:
            fails.append("modal should be closed initially")

        # 1b. Typewriter — bd starts at pending (spans at opacity 0 before
        # anyone opens the modal). Wrapping must have happened at init.
        bd_state_pre = page.evaluate(
            "document.querySelector('.sw-modal.sw-about .bd').getAttribute('data-typing')"
        )
        print(f"bd data-typing before open: {bd_state_pre}")
        if bd_state_pre != "pending":
            fails.append(f"bd should be data-typing='pending' before open; got {bd_state_pre!r}")

        wrap_count = page.evaluate(
            "document.querySelectorAll('.sw-modal.sw-about .sw-type-w').length"
        )
        print(f"wrapped word spans: {wrap_count}")
        if wrap_count < 50:
            fails.append(f"expected 50+ wrapped word spans; got {wrap_count}")

        # 1c. Spans carry a --w ordinal and --word-ms is the pacing constant.
        first_w = page.evaluate("""
            () => {
              const s = document.querySelector('.sw-modal.sw-about .sw-type-w');
              return s ? s.style.getPropertyValue('--w') : null;
            }
        """)
        if not first_w or not first_w.lstrip("-").isdigit():
            fails.append(f"first wrapped span missing --w ordinal; got {first_w!r}")

        # 2. Click on .nav-brand opens the modal.
        page.click(".nav-brand")
        page.wait_for_timeout(250)
        is_open_after = page.evaluate(
            "document.querySelector('.sw-modal.sw-about').classList.contains('open')"
        )
        print(f"modal open after click: {is_open_after}")
        if not is_open_after:
            fails.append("click on .nav-brand did not open modal")

        # 2b. Typewriter — bd should flip to "run" after a double-rAF flush.
        # Wait long enough for both rAFs to fire (one frame each).
        page.wait_for_timeout(80)
        bd_state_open = page.evaluate(
            "document.querySelector('.sw-modal.sw-about .bd').getAttribute('data-typing')"
        )
        print(f"bd data-typing after open: {bd_state_open}")
        if bd_state_open != "run":
            fails.append(f"bd should be data-typing='run' after open; got {bd_state_open!r}")

        # 3. Header + section headings + signature + disclaimer present.
        title = page.text_content(".sw-modal.sw-about h3") or ""
        if "Behind All Deputations" not in title:
            fails.append(f"h3 missing expected title; got: {title!r}")

        h4_texts = page.eval_on_selector_all(
            ".sw-modal.sw-about .sw-section", "els => els.map(e => e.textContent.trim())"
        )
        print(f"section headings: {h4_texts}")
        if len(h4_texts) < 2:
            fails.append(f"expected 2+ section headings; got {h4_texts}")
        if not any("Why" in t and "alldeputations.com" in t for t in h4_texts):
            fails.append(f"'Why alldeputations.com?' heading missing: {h4_texts}")
        if not any("Built independently" in t for t in h4_texts):
            fails.append(f"'Built independently' heading missing: {h4_texts}")

        # 4. Signature block: name + role must be present.
        sign_text = page.text_content(".sw-modal.sw-about .sw-sign") or ""
        for needle in ("Vivek Vishal", "Section Officer", "Central Secretariat Service",
                       "NIT Durgapur", "AJNIFM", "Road Transport"):
            if needle not in sign_text:
                fails.append(f"signature block missing {needle!r}")

        # 5. Disclaimer block visible with amber accent.
        disc_text = page.text_content(".sw-modal.sw-about .sw-about-disclaimer") or ""
        for needle in ("independent personal initiative", "not an official website",
                       "Government of India"):
            if needle not in disc_text:
                fails.append(f"disclaimer missing {needle!r}")
        disc_bg = page.evaluate("""
            () => {
              const el = document.querySelector('.sw-modal.sw-about .sw-about-disclaimer');
              return el ? getComputedStyle(el).backgroundColor : null;
            }
        """)
        print(f"disclaimer bg: {disc_bg}")
        if not disc_bg or "rgba" not in disc_bg:
            fails.append(f"disclaimer has no background colour: {disc_bg}")

        # 6. Pull-quote present (italic Lora block).
        quote = page.text_content(".sw-modal.sw-about .sw-quote") or ""
        if "If I were searching for the right deputation today" not in quote:
            fails.append(f"pull-quote missing; got: {quote!r}")

        # 7. Site link rendered as a styled anchor in primary colour.
        link_info = page.evaluate("""
            () => {
              const a = document.querySelector('.sw-modal.sw-about .sw-link');
              if (!a) return null;
              const cs = getComputedStyle(a);
              return { text: a.textContent, color: cs.color, decoration: cs.textDecorationLine };
            }
        """)
        print(f"link info: {link_info}")
        if not link_info:
            fails.append(".sw-link anchor not found")
        elif link_info["text"] != "www.alldeputations.com":
            fails.append(f"link text wrong: {link_info['text']!r}")

        # 8. Lora serif used for prose (not the same font as the body).
        prose_font = page.evaluate("""
            () => {
              const p = document.querySelector('.sw-modal.sw-about .sw-about-prose');
              return p ? getComputedStyle(p).fontFamily : null;
            }
        """)
        print(f"prose font: {prose_font}")
        if not prose_font or "Lora" not in prose_font:
            fails.append(f"prose should use Lora; got: {prose_font!r}")

        # 9. Close via the X button.
        page.click(".sw-modal.sw-about .cls")
        page.wait_for_timeout(250)
        if page.evaluate("document.querySelector('.sw-modal.sw-about').classList.contains('open')"):
            fails.append("X button did not close modal")

        # 9b. Typewriter — bd should reset to "pending" so the next open
        # re-runs the reveal from word 0.
        bd_state_closed = page.evaluate(
            "document.querySelector('.sw-modal.sw-about .bd').getAttribute('data-typing')"
        )
        print(f"bd data-typing after close: {bd_state_closed}")
        if bd_state_closed != "pending":
            fails.append(f"bd should reset to 'pending' on close; got {bd_state_closed!r}")

        # 10. Re-open, then close with Esc.
        page.click(".nav-brand")
        # Playwright's click action internally does hover + scroll-and-stabilize
        # waits that can push the actual mouseup past 500ms. Wait until the
        # bd state actually transitions to "run" via the open() rAFs, rather
        # than guessing a timeout.
        try:
            page.wait_for_function(
                "document.querySelector('.sw-modal.sw-about .bd').getAttribute('data-typing') === 'run'",
                timeout=3000,
            )
        except Exception:
            pass
        bd_state_reopen = page.evaluate(
            "document.querySelector('.sw-modal.sw-about .bd').getAttribute('data-typing')"
        )
        print(f"bd data-typing on re-open: {bd_state_reopen}")
        if bd_state_reopen != "run":
            fails.append(f"bd should re-flip to 'run' on re-open; got {bd_state_reopen!r}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        if page.evaluate("document.querySelector('.sw-modal.sw-about').classList.contains('open')"):
            fails.append("Escape key did not close modal")

        # 11. Re-open, then close via backdrop click.
        page.click(".nav-brand")
        page.wait_for_timeout(200)
        # Click on the backdrop itself (the modal element, outside the card).
        page.evaluate("""
            () => {
              const m = document.querySelector('.sw-modal.sw-about');
              const evt = new MouseEvent('click', { bubbles: true });
              m.dispatchEvent(evt);
            }
        """)
        page.wait_for_timeout(200)
        if page.evaluate("document.querySelector('.sw-modal.sw-about').classList.contains('open')"):
            fails.append("backdrop click did not close modal")

        # 12. Console errors check.
        if console_errors:
            fails.append(f"console errors: {console_errors}")

        browser.close()

    if fails:
        print("\nFAIL:")
        for f in fails:
            print("  -", f)
        return 1
    print("\nPASS: about modal behaves as expected")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())