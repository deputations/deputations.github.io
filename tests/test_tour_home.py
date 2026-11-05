"""Site tour — the Home page intro (tour/scenes/home.js), end to end through the
real loader on index.html.

Run:
    pytest tests/test_tour_home.py -v
"""
from __future__ import annotations

from playwright.sync_api import Page, expect

from tests.tour_helpers import no_hero_wave, seen  # noqa: F401

TITLES = ["Only the posts you can apply for", "Narrow it down", "Just ask", "Sort and switch views",
          "Save posts you like", "Never miss a vacancy", "Light or dark — your choice", "Explore more pages"]
HEADLINE = "Your one stop solution to Deputation"
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
    page.wait_for_function("() => !!window.__closed", polling=100, timeout=15000)
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
