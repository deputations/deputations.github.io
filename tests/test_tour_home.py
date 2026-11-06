"""Site tour — the Home page intro (tour/scenes/home.js), end to end through the
real loader on index.html.

Run:
    pytest tests/test_tour_home.py -v
"""
from __future__ import annotations

import re

from playwright.sync_api import Page, expect

from tests.tour_helpers import close_and_settle, no_hero_wave, seen  # noqa: F401

TITLES = ["Find deputation opportunities matching your eligibility", "Narrow it down", "Search anything — or just ask",
          "Sort and switch views",
          "Save posts you like", "Never miss a vacancy", "Light or dark — your choice", "Explore more pages"]
HEADLINE = "Your one stop solution to Deputations"
BRAND = "ALL Deputations.com"
FULL_POWER = ("Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });"
              "Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });")
RECORD_CLOSE = """
  document.addEventListener('deptour:close', e => { window.__closed = e.detail; });
"""


def _open_home(page: Page, base_url: str, speed: float = 1) -> None:
    page.add_init_script(RECORD_CLOSE)
    page.goto(f"{base_url}/index.html?tour=play&tourSpeed={speed}")
    page.wait_for_function("() => !!window.gsap && !!window.DepTour", polling=100, timeout=30000)
    page.evaluate("gsap.ticker.lagSmoothing(0)")
    page.wait_for_function("() => DepTour.isOpen()", polling=100, timeout=20000)


def _scene_end(page: Page, index: int) -> None:  # noqa: D401
    page.evaluate(f"DepTour.goTo({index}); DepTour.pause();")
    page.wait_for_function(f"() => DepTour.state().sceneIndex === {index} && DepTour.state().phase === 'scene'",
                           polling=100)
    page.evaluate("DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(100)


def test_intro_and_first_steps(page: Page, base_url: str):
    _open_home(page, base_url)
    page.wait_for_function("() => document.querySelectorAll('.dt-headline .dt-ch').length > 0",
                           polling=100, timeout=10000)
    assert page.evaluate("document.querySelector('.dt-headline').textContent") == HEADLINE
    page.wait_for_function("() => !!document.querySelector('.dt-brand')", polling=100, timeout=10000)
    assert page.evaluate("document.querySelector('.dt-brand').textContent") == BRAND
    for i, title in enumerate(TITLES[:3]):
        page.evaluate(f"DepTour.goTo({i})")
        expect(page.locator("#dt-title")).to_have_text(title)


def test_filters_end_state(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 1)
    assert page.evaluate("[...document.querySelectorAll('.dt-fpill')].map(p => p.textContent.trim())") == \
        ["Ministry · 2", "Organisation", "Location"]
    on = page.evaluate("[...document.querySelectorAll('.dt-qchip.is-on')].map(c => c.textContent.trim())")
    assert on == ["Closing in 7 days", "Delhi/NCR"]
    assert page.evaluate("[...document.querySelectorAll('.dt-frow')].filter(r => +getComputedStyle(r).opacity > 0.5).length") == 3
    assert page.evaluate("document.querySelector('.dt-fcount').getAttribute('aria-label')") == "12"
    assert "sample" in page.evaluate("document.querySelector('.dt-fcount-wrap').textContent").lower()


def test_filters_on_phone_fit_the_stage(page: Page, base_url: str):
    page.set_viewport_size({"width": 390, "height": 844})
    _open_home(page, base_url)
    _scene_end(page, 1)
    inside = page.evaluate("""() => {
      const cv = document.querySelector('.dt-canvas').getBoundingClientRect();
      const els = [...document.querySelectorAll('.dt-fpill, .dt-qchip, .dt-fcount-wrap')];
      return els.length === 8 && els.every(e => {
        const r = e.getBoundingClientRect();
        return r.left >= cv.left - 1 && r.right <= cv.right + 1 && r.top >= cv.top - 1 && r.bottom <= cv.bottom + 1;
      });
    }""")
    assert inside is True


def test_eligibility_end_state(page: Page, base_url: str):
    page.add_init_script(FULL_POWER)
    _open_home(page, base_url)
    _scene_end(page, 0)
    assert page.locator(".dt-vcard").count() == 120
    assert page.evaluate("document.querySelector('.dt-count').getAttribute('aria-label')") == "86"
    assert page.evaluate("document.querySelector('.dt-count').textContent") == "86"
    assert page.locator(".dt-vcard.is-eligible").count() == 8


def test_eligibility_on_phone(page: Page, base_url: str):
    page.add_init_script(FULL_POWER)
    page.set_viewport_size({"width": 390, "height": 844})
    _open_home(page, base_url)
    _scene_end(page, 0)
    assert page.locator(".dt-vcard").count() == 48
    assert page.locator(".dt-vcard.is-eligible").count() == 5


def test_low_power_wall(page: Page, base_url: str):
    page.add_init_script("Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });")
    _open_home(page, base_url)
    _scene_end(page, 0)
    assert page.locator(".dt-vcard").count() == 72
    assert page.locator(".dt-vcard.is-eligible").count() == 8


def test_ask_end_state(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 2)
    assert page.evaluate("document.querySelector('.dt-ask-text').textContent") == \
        "Level 8 posts in Delhi closing this month"
    chips = page.evaluate("[...document.querySelectorAll('.dt-ask-chips .dt-chip')].map(c => c.textContent.trim())")
    assert chips == ["Level 8", "Delhi", "Closes ≤ 30 days"]
    assert page.locator(".dt-match").count() == 3
    rings = page.evaluate("[...document.querySelectorAll('.dt-match .dt-ring-v')].map(e => e.getAttribute('aria-label'))")
    assert rings == ["96", "91", "87"]
    # every match is a Delhi, Level 8 sample post
    assert page.evaluate("[...document.querySelectorAll('.dt-match')].every(m => /Delhi/.test(m.textContent) && /Level 8/.test(m.textContent))")


def test_cta_opens_pay_level(page: Page, base_url: str):
    _open_home(page, base_url)
    for _ in range(12):                            # skip ahead like a person: → past the last step
        page.keyboard.press("ArrowRight")
    cta = page.locator(".dt-cta")
    expect(cta).to_contain_text("Try it with your pay level", timeout=10000)
    cta.click()
    page.wait_for_function("() => !!window.__closed", polling=100, timeout=10000)
    assert page.evaluate("window.__closed.reason") == "cta"
    expect(page.locator(".dt-overlay")).to_have_count(0)
    expect(page.locator("#filterMyPayLevelPanel")).not_to_have_attribute("hidden", "", timeout=5000)
    assert seen(page).get("home") == 1


def test_full_run_fast(page: Page, base_url: str):
    errors, console_errors = [], []
    page.on("pageerror", lambda e: "/tour/" in (e.stack or "") and errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and (
        "/tour/" in m.text or "/tour/" in ((m.location or {}).get("url") or "")) and console_errors.append(m.text))
    _open_home(page, base_url, speed=20)
    # the whole tour plays to its finale, which then fades away by itself (owner, 2026-11-06)
    page.wait_for_selector(".dt-cta", state="attached", timeout=20000)
    page.wait_for_function("() => !!window.__closed", polling=100, timeout=20000)
    assert page.evaluate("window.__closed.reason") == "end"
    assert errors == [] and console_errors == []


def test_plays_once_then_not_again(page: Page, base_url: str):
    page.add_init_script("Object.defineProperty(navigator, 'webdriver', { get: () => false });")
    page.goto(f"{base_url}/index.html")
    page.wait_for_selector(".dt-overlay", state="attached", timeout=15000)
    page.locator(".dt-skip").click()
    expect(page.locator(".dt-overlay")).to_have_count(0, timeout=5000)
    assert seen(page).get("home") == 1
    page.reload()
    page.wait_for_function("() => !!window.DepTourLoader", polling=100, timeout=30000)
    page.wait_for_timeout(3000)
    assert page.locator(".dt-overlay").count() == 0


def test_counter_digits_visible_while_rolling(page: Page, base_url: str):
    _open_home(page, base_url)
    page.evaluate("DepTour.goTo(0); DepTour.pause();")
    page.wait_for_function("() => DepTour.state().sceneIndex === 0", polling=100)
    page.evaluate("DepTour.seek(7.2)")                # mid-roll of 1,240 -> 86
    page.wait_for_timeout(100)
    fills = page.evaluate("""() => [...document.querySelectorAll('.dt-count .dt-odo-slot b')]
                               .map(b => getComputedStyle(b).webkitTextFillColor || getComputedStyle(b).color)""")
    assert fills, "the counter should be rolling at 7.2 s"
    assert all("0)" not in f.replace(" ", "") and f != "transparent" for f in fills), fills


def test_level_options_sit_above_the_counter_on_phone(page: Page, base_url: str):
    page.set_viewport_size({"width": 390, "height": 844})
    _open_home(page, base_url)
    page.evaluate("DepTour.goTo(0); DepTour.pause();")
    page.wait_for_function("() => DepTour.state().sceneIndex === 0", polling=100)
    page.evaluate("DepTour.seek(3.95)")               # options list open
    page.wait_for_timeout(100)
    hit = page.evaluate("""() => [...document.querySelectorAll('.dt-options li')].every(li => {
      const r = li.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && li.contains(top);
    })""")
    assert hit is True


def test_ring_score_on_one_line(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 2)
    rows = page.evaluate("""() => [...document.querySelectorAll('.dt-ring-n')].map(n => {
      const b = n.querySelector('b').getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(n.lastChild);
      const pct = range.getBoundingClientRect();
      return Math.abs((b.top + b.height / 2) - (pct.top + pct.height / 2));
    })""")
    assert rows and all(d <= 4 for d in rows), rows


def test_ask_scene_is_vertically_centred_on_desktop(page: Page, base_url: str):
    page.set_viewport_size({"width": 1440, "height": 900})
    _open_home(page, base_url)
    _scene_end(page, 2)
    off = page.evaluate("""() => {
      const cv = document.querySelector('.dt-canvas').getBoundingClientRect();
      const top = document.querySelector('.dt-ask').getBoundingClientRect().top;
      const bottom = Math.max(...[...document.querySelectorAll('.dt-match')].map(m => m.getBoundingClientRect().bottom));
      return Math.abs((top + bottom) / 2 - (cv.top + cv.height / 2)) / (cv.height / 620);
    }""")
    assert off <= 60, off


def test_eligible_cards_say_who_they_are_open_to(page: Page, base_url: str):
    page.add_init_script(FULL_POWER)
    _open_home(page, base_url)
    _scene_end(page, 0)
    texts = page.evaluate("[...document.querySelectorAll('.dt-vcard.is-eligible')].map(c => c.textContent)")
    assert len(texts) == 8 and all("Open to L-7" in t for t in texts), texts
    higher = page.evaluate("[...document.querySelectorAll('.dt-vcard.is-eligible')]"
                           ".filter(c => /lvl-(8|9|1[0-9])/.test(c.className)).length")
    assert higher >= 5


def test_counter_is_labelled_as_sample(page: Page, base_url: str):
    _open_home(page, base_url)
    page.evaluate("DepTour.goTo(0); DepTour.pause();")
    page.wait_for_function("() => DepTour.state().sceneIndex === 0", polling=100)
    page.evaluate("DepTour.seek(1.0)")
    chip = page.evaluate("document.querySelector('.dt-count-chip').textContent")
    assert "sample" in chip.lower() and "across India" not in chip, chip


def test_ask_shows_what_the_ai_understood(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 2)
    assert page.evaluate("document.querySelector('.dt-ask-chips .dt-ask-understood').textContent") == "Understood"


# ---- Home v2 steps 4–7 ----

def _go(page: Page, index: int) -> None:
    page.evaluate(f"DepTour.goTo({index}); DepTour.pause();")
    page.wait_for_function(f"() => DepTour.state().sceneIndex === {index} && DepTour.state().phase === 'scene'",
                           polling=100)


def test_table_sorts_then_becomes_cards(page: Page, base_url: str):
    _open_home(page, base_url)
    _go(page, 3)
    page.evaluate("DepTour.seek(3.6)")                     # sorted, still a table
    page.wait_for_timeout(100)
    row_h = page.evaluate("document.querySelector('.dt-trow').getBoundingClientRect().height")
    page.evaluate("DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(100)
    days = page.evaluate("""() => [...document.querySelectorAll('.dt-trow')]
      .map(r => ({ r: r.getBoundingClientRect(), d: +r.dataset.days }))
      .sort((a, b) => (a.r.top - b.r.top) || (a.r.left - b.r.left)).map(x => x.d)""")
    assert len(days) == 6 and days == sorted(days), days
    assert page.locator(".dt-th.is-sorted").text_content().startswith("Days left")
    expect(page.locator(".dt-table.is-cards")).to_have_count(1)
    card_h = page.evaluate("Math.min(...[...document.querySelectorAll('.dt-trow')].map(r => r.getBoundingClientRect().height))")
    assert card_h >= 1.6 * row_h, (row_h, card_h)
    lefts = page.evaluate("new Set([...document.querySelectorAll('.dt-trow')].map(r => Math.round(r.getBoundingClientRect().left))).size")
    assert lefts >= 2


def test_bookmark_counts_one(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 4)
    expect(page.locator(".dt-heart.is-saved")).to_have_count(1)
    assert page.evaluate("document.querySelector('.dt-badge-count').getAttribute('aria-label')") == "1"
    assert page.evaluate("document.querySelector('.dt-badge-count').textContent") == "1"


def test_alert_arrives_on_the_phone(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 5)
    expect(page.locator(".dt-bell.is-on")).to_have_count(1)
    push = page.locator(".dt-phone .dt-push")
    expect(push).to_be_visible()
    text = push.inner_text()
    assert "Level 8" in text and "Delhi" in text, text


def _wipe_radius(page: Page) -> float:
    clip = page.evaluate("getComputedStyle(document.querySelector('.dt-theme-light')).clipPath")
    assert clip.startswith("circle("), clip
    return float(clip[len("circle("):].split("px")[0])


def test_theme_wipes_to_light_and_back(page: Page, base_url: str):
    _open_home(page, base_url)
    _go(page, 6)
    page.evaluate("DepTour.seek(0.5)")
    page.wait_for_timeout(80)
    assert _wipe_radius(page) == 0
    page.evaluate("DepTour.seek(3.0)")
    page.wait_for_timeout(80)
    assert _wipe_radius(page) > 200
    page.evaluate("DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(80)
    assert _wipe_radius(page) == 0


def test_bookmark_badge_hidden_until_saved(page: Page, base_url: str):
    _open_home(page, base_url)
    _go(page, 4)
    page.evaluate("DepTour.seek(1.0)")
    page.wait_for_timeout(80)
    assert page.evaluate("getComputedStyle(document.querySelector('.dt-badge-count')).opacity") == "0"
    page.evaluate("DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(80)
    assert page.evaluate("getComputedStyle(document.querySelector('.dt-badge-count')).opacity") == "1"


# ---- Home v2: the page montage and the full order ----

PAGES = [("India Map", "/india-map.html"), ("DeFeX", "/defex.html"), ("My Deputation", "/my-deputation.html"),
         ("Report Vacancy", "/report-vacancy.html"), ("Rules", "/rules.html"), ("FAQs", "/faq.html")]


def test_every_step_in_order(page: Page, base_url: str):
    _open_home(page, base_url)
    for i, title in enumerate(TITLES):
        page.evaluate(f"DepTour.goTo({i})")
        expect(page.locator("#dt-title")).to_have_text(title)


def test_steps_view_lists_every_step(page: Page, base_url: str):
    _open_home(page, base_url)
    page.locator(".dt-skip").click()
    page.wait_for_function("() => !DepTour.isOpen()", polling=100)
    page.evaluate("() => { window.__res = null; DepTour.play('home', { mode: 'steps' }).then(r => { window.__res = r; }); }")
    titles = []
    for _ in TITLES:
        titles.append(page.locator(".dt-steps h3").text_content())
        page.locator(".dt-next").click()
    assert titles == TITLES


def test_montage_cards_and_links(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 7)
    cards = page.evaluate("""() => [...document.querySelectorAll('a.dt-page-card.dt-page-link')]
      .map(a => [a.querySelector('.dt-page-meta b').textContent, a.getAttribute('href')])""")
    assert cards == [list(p) for p in PAGES]


def _grid(page: Page):
    return page.evaluate("""() => [...document.querySelectorAll('a.dt-page-card')].map(a => {
      const r = a.getBoundingClientRect();
      return { t: a.querySelector('.dt-page-meta b').textContent, x: r.left, y: r.top, w: r.width, h: r.height };
    })""")


def _rows(cards):
    rows = []
    for c in sorted(cards, key=lambda c: (round(c["y"] / 20), c["x"])):
        if rows and abs(rows[-1][0]["y"] - c["y"]) < 20:
            rows[-1].append(c)
        else:
            rows.append([c])
    return rows


def _no_overlap(cards):
    for i, a in enumerate(cards):
        for b in cards[i + 1:]:
            if a["x"] < b["x"] + b["w"] - 1 and b["x"] < a["x"] + a["w"] - 1 and \
               a["y"] < b["y"] + b["h"] - 1 and b["y"] < a["y"] + a["h"] - 1:
                return False
    return True


def test_montage_grid_layout(page: Page, base_url: str):
    for (w, h), per_row in [((1440, 900), 3), ((390, 844), 2)]:
        page.set_viewport_size({"width": w, "height": h})
        _open_home(page, base_url)
        _scene_end(page, 7)
        cards = _grid(page)
        rows = _rows(cards)
        assert [len(r) for r in rows] == [per_row] * (6 // per_row), (w, rows)
        order = [c["t"] for r in rows for c in sorted(r, key=lambda c: c["x"])]
        assert order == [p[0] for p in PAGES], (w, order)
        assert _no_overlap(cards), (w, cards)
        assert all(0 <= c["x"] and c["x"] + c["w"] <= w and c["y"] >= 0 and c["y"] + c["h"] <= h for c in cards), (w, cards)
        close_and_settle(page)


def test_finale_card_opens_the_map_page(page: Page, base_url: str):
    _open_home(page, base_url)
    for _ in range(12):
        page.keyboard.press("ArrowRight")
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    page.locator("a.dt-page-card", has_text="India Map").click()
    page.wait_for_url("**/india-map.html", timeout=15000)


# ---- Home v2 review fixes ----

def test_off_button_fits_on_small_phones(page: Page, base_url: str):
    for w, h in [(390, 844), (360, 740)]:
        page.set_viewport_size({"width": w, "height": h})
        _open_home(page, base_url)
        box = page.locator(".dt-off").bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= w, (w, box)
        close_and_settle(page)


def test_theme_step_uses_sample_numbers(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 6)
    text = page.evaluate("document.querySelector('.dt-theme-dark .dt-tm-kpis').textContent")
    assert "Sample" in text and "405" not in text, text


def test_alerts_match_how_the_site_sends_them(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 5)
    chips = page.evaluate("[...document.querySelectorAll('.dt-apop .dt-trow-chips i')].map(i => i.textContent)")
    assert chips == ["Level 8"], chips
    assert "daily" in page.evaluate("document.querySelector('.dt-apop').textContent").lower()


def test_phone_lock_screen_shows_today(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 5)
    expected = page.evaluate("""new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long',
                                  day: 'numeric', month: 'long' }).format(new Date()).replace(',', '')""")
    assert page.evaluate("document.querySelector('.dt-phone-date').textContent") == expected


def test_rules_card_describes_the_rules_page(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 7)
    text = page.evaluate("document.querySelector('a.dt-page-card[href=\"/rules.html\"] .dt-page-meta span').textContent")
    assert text == "All rules at one place, easy to search", text


def test_home_tour_plays_even_if_map_data_fails(page: Page, base_url: str):
    page.route("**/tour/tour-map.json*", lambda r: r.abort())
    _open_home(page, base_url)
    for i, title in enumerate(TITLES):
        page.evaluate(f"DepTour.goTo({i})")
        expect(page.locator("#dt-title")).to_have_text(title)
    expect(page.locator("a.dt-page-card")).to_have_count(6)


# ---- owner's changes, 2026-11-05 evening ----

STEP_N = re.compile(r"\bSTEP\s*\d", re.I)


def test_no_step_numbers_on_screen(page: Page, base_url: str):
    """Visitors can jump to any step from the dots, so no "STEP n" label is shown."""
    _open_home(page, base_url)
    for i in (0, 4, 7):
        _scene_end(page, i)
        text = page.evaluate("document.querySelector('.dt-overlay').innerText")
        assert not STEP_N.search(text), (i, text[:160])
    close_and_settle(page)
    page.evaluate("() => { DepTour.play('home', { mode: 'steps' }); }")
    page.wait_for_selector(".dt-steps h3", timeout=10000)
    text = page.evaluate("document.querySelector('.dt-steps').innerText")
    assert not STEP_N.search(text), text


def _meta(page: Page, key: str) -> str:
    return page.evaluate(f"document.querySelector('a.dt-pc-{key} .dt-page-meta > span').textContent")


def test_defex_card_says_beta(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 7)
    assert page.evaluate("(document.querySelector('a.dt-pc-defex .dt-beta') || {}).textContent") == "Beta"


def test_report_card_offers_a_link_or_a_pdf(page: Page, base_url: str):
    _open_home(page, base_url)
    _scene_end(page, 7)
    assert _meta(page, "report") == "Just paste the vacancy link, or upload the PDF"
    art = page.evaluate("document.querySelector('a.dt-pc-report .dt-page-art').textContent")
    assert "https://" in art and "PDF" in art, art


WA = "a.dt-wa-bar.dt-page-link"


def _to_finale(page: Page) -> None:
    for _ in range(12):
        page.keyboard.press("ArrowRight")
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    page.wait_for_timeout(300)


def test_whatsapp_bar_joins_channel_and_group(page: Page, base_url: str):
    for w, h in [(1440, 900), (390, 844)]:
        page.set_viewport_size({"width": w, "height": h})
        _open_home(page, base_url)
        _to_finale(page)
        bar = page.locator(WA)
        expect(bar).to_have_attribute("href", "/contact.html")
        text = bar.text_content()
        for words in ("WhatsApp", "Channel", "latest updates", "Group", "discussions"):
            assert words in text, (w, text)
        assert page.evaluate(f"+getComputedStyle(document.querySelector('{WA}')).opacity") > 0.9
        b, cta = bar.bounding_box(), page.locator(".dt-cta").bounding_box()
        cards = _grid(page)
        assert b["y"] >= max(c["y"] + c["h"] for c in cards) - 1, (w, b, cards)    # under the page grid
        assert b["y"] + b["height"] <= cta["y"] + 1, (w, b, cta)                     # above the button
        assert b["x"] >= 0 and b["x"] + b["width"] <= w, (w, b)
        close_and_settle(page)


def test_whatsapp_bar_opens_the_contact_page(page: Page, base_url: str):
    _open_home(page, base_url)
    _to_finale(page)
    page.locator(WA).click()
    page.wait_for_url("**/contact.html", timeout=15000)


# ---- owner, 2026-11-05: the normal search, then AI search as the even better option ----

def _text(page: Page, sel: str) -> str:
    return page.evaluate(f"(document.querySelector({sel!r}) || {{}}).textContent || ''")


def _at(page: Page, index: int, t: float) -> None:
    page.evaluate(f"DepTour.goTo({index}); DepTour.pause();")
    page.wait_for_function(f"() => DepTour.state().sceneIndex === {index} && DepTour.state().phase === 'scene'",
                           polling=100)
    page.evaluate(f"DepTour.seek({t})")
    page.wait_for_timeout(150)


def _op(page: Page, sel: str) -> float:
    return page.evaluate(f"+getComputedStyle(document.querySelector('{sel}')).opacity")


def test_normal_search_comes_first_then_ai_search(page: Page, base_url: str):
    _open_home(page, base_url)
    _at(page, 2, 3.9)                                   # a short form
    assert _text(page, ".dt-qs-text") == "UDC"
    rows = page.evaluate("[...document.querySelectorAll('.dt-qs-row')].map(r => r.textContent)")
    assert len(rows) == 3 and all("Upper Division Clerk" in r for r in rows), rows
    assert "Short form" in _text(page, ".dt-qs-tag")
    assert _op(page, ".dt-ask") < 0.1                   # AI search not shown yet
    _at(page, 2, 6.6)                                   # a typo
    assert _text(page, ".dt-qs-text") == "acountant"
    rows = page.evaluate("[...document.querySelectorAll('.dt-qs-row')].map(r => r.textContent)")
    assert rows and all("Accountant" in r for r in rows), rows
    assert "Typo" in _text(page, ".dt-qs-tag")
    fields = _text(page, ".dt-qs-fields")
    for f in ("Post", "Organisation", "Ministry", "Location", "Level", "Qualification", "Short form"):
        assert f in fields, fields
    _scene_end(page, 2)                                  # then AI search, as the even better option
    assert _op(page, ".dt-qs") < 0.05
    assert _text(page, ".dt-even") == "Even better: just ask" and _op(page, ".dt-even") > 0.9
    assert _op(page, ".dt-ask") > 0.9 and page.locator(".dt-match").count() == 3


def test_search_step_fits_on_phone(page: Page, base_url: str):
    page.set_viewport_size({"width": 390, "height": 844})
    _open_home(page, base_url)
    for t in (3.9, 6.6, None):
        if t is None:
            _scene_end(page, 2)
        else:
            _at(page, 2, t)
        out = page.evaluate("""() => {
          const cv = document.querySelector('.dt-canvas').getBoundingClientRect();
          return [...document.querySelectorAll('.dt-qs-box, .dt-qs-fields, .dt-qs-results, .dt-even, .dt-ask, .dt-match')]
            .filter(e => +getComputedStyle(e).opacity > 0.5)
            .map(e => [e.className, e.getBoundingClientRect()])
            .filter(([, r]) => r.left < cv.left - 2 || r.right > cv.right + 2 || r.top < cv.top - 2 || r.bottom > cv.bottom + 2)
            .map(([c]) => c);
        }""")
        assert out == [], (t, out)


# ---- owner, 2026-11-05 night: the V² logo on every step, and "A V² product" at the end ----

GEOM = """(sel) => { const e = document.querySelector(sel); if (!e) return null;
  const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height,
  o: +getComputedStyle(e).opacity }; }"""


def _g(page: Page, sel: str):
    return page.evaluate(GEOM, sel)


def test_v2_logo_on_every_step(page: Page, base_url: str):
    for w, h in [(1440, 900), (390, 844)]:
        page.set_viewport_size({"width": w, "height": h})
        _open_home(page, base_url)
        for i in range(len(TITLES)):
            _scene_end(page, i)
            m, cv = _g(page, ".dt-mark"), _g(page, ".dt-canvas")
            assert m and m["o"] > 0.9, (w, i, m)
            assert page.evaluate("document.querySelector('.dt-mark img').getAttribute('src')").startswith(
                "/assets/brand/v2-logo.png")
            if w == 1440:          # in the free band left of the stage, vertically centred
                assert m["r"] <= cv["l"] + 1 and m["l"] >= 0, (i, m, cv)
                assert abs((m["t"] + m["b"]) / 2 - (cv["t"] + cv["b"]) / 2) <= 3, (i, m, cv)
            else:                  # phones: small, bottom-left, beside the Demo tag
                bd = _g(page, ".dt-badge")
                assert m["r"] <= bd["l"] + 1 and abs((m["t"] + m["b"]) / 2 - (bd["t"] + bd["b"]) / 2) <= 4, (i, m, bd)
        close_and_settle(page)


def _finale_signoff(page: Page) -> None:
    for _ in range(12):
        page.keyboard.press("ArrowRight")
    page.wait_for_selector(".dt-signoff", state="attached", timeout=15000)


def test_a_v2_product_ends_the_home_tour(page: Page, base_url: str):
    page.set_viewport_size({"width": 1440, "height": 900})
    _open_home(page, base_url, speed=0.5)
    _finale_signoff(page)
    so = _g(page, ".dt-signoff")
    assert so["w"] > 1440 * 0.45, so                               # starts full-screen, over the last screen
    assert page.evaluate("document.querySelector('.dt-signoff').textContent.replace(/\\s+/g, ' ').trim()") == "A product"
    assert page.locator(".dt-signoff img[src^='/assets/brand/v2-logo.png']").count() == 1
    page.wait_for_selector(".dt-signoff.is-docked", state="attached", timeout=30000)
    page.wait_for_timeout(300)
    so, grid = _g(page, ".dt-signoff"), page.evaluate(
        "Math.min(...[...document.querySelectorAll('a.dt-page-card')].map(a => a.getBoundingClientRect().left))")
    cv = _g(page, ".dt-canvas")
    assert so["o"] > 0.9 and so["r"] <= grid - 4 and so["l"] >= 0, (so, grid)   # stays on the left of the grid
    assert abs((so["t"] + so["b"]) / 2 - (cv["t"] + cv["b"]) / 2) <= 40, (so, cv)
    assert _g(page, ".dt-so-dim")["o"] < 0.05
    assert _g(page, ".dt-mark")["o"] < 0.05                         # the ending takes the logo's place
    expect(page.locator(".dt-cta")).to_be_visible()


def test_a_v2_product_on_phone_stays_under_the_title(page: Page, base_url: str):
    page.set_viewport_size({"width": 390, "height": 844})
    _open_home(page, base_url, speed=0.5)
    _finale_signoff(page)
    page.wait_for_selector(".dt-signoff.is-docked", state="attached", timeout=30000)
    page.wait_for_timeout(300)
    so, title, cv = _g(page, ".dt-signoff"), _g(page, ".dt-title"), _g(page, ".dt-canvas")
    assert so["t"] >= title["b"] - 1 and so["b"] <= cv["t"] + 1 and so["l"] >= 0 and so["r"] <= 390, (so, title, cv)


def test_leaving_the_finale_removes_the_ending(page: Page, base_url: str):
    page.set_viewport_size({"width": 1440, "height": 900})
    _open_home(page, base_url, speed=0.5)
    _finale_signoff(page)
    page.keyboard.press("ArrowLeft")
    page.wait_for_function("() => DepTour.state().phase === 'scene'", polling=100, timeout=10000)
    assert page.locator(".dt-signoff").count() == 0
    page.wait_for_timeout(500)
    assert _g(page, ".dt-mark")["o"] > 0.9
