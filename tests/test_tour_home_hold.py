"""Site tour — Home on a first visit (owner, 2026-11-06): the tour comes first,
over an empty page; when it fades away (slowly) the page fades in and its own
animations play. Plus the "How this works" button's on-screen time.

Run:
    pytest tests/test_tour_home_hold.py -v
"""
from __future__ import annotations

import pytest
from playwright.sync_api import Page

from tests.tour_helpers import no_hero_wave  # noqa: F401

REAL_VISIT = "Object.defineProperty(navigator, 'webdriver', { get: () => false });"
SEEN_ALL = "localStorage.setItem('dep_tour_seen_v1', JSON.stringify({ home: 1, map: 1 }));"

# Timings and states recorded inside the page (Playwright-side waits run late under load).
PROBE = """(() => { const t0 = performance.now(); window.__t = {};
  const at = k => () => { if (window.__t[k] == null) window.__t[k] = Math.round(performance.now() - t0); };
  ['deptour:open', 'deptour:close', 'deptour:release'].forEach(e => document.addEventListener(e, at(e.split(':')[1])));
  document.addEventListener('deptour:release', () => setTimeout(() => { const app = document.querySelector('.app-container');
    window.__revealOpacity = app ? +getComputedStyle(app).opacity : null; }, 150));
  // 'interactive' comes after parsing and before the deferred loader boots: only
  // the early head check can have hidden the page by then.
  document.addEventListener('readystatechange', () => {
    if (document.readyState !== 'interactive') return;
    const app = document.querySelector('.app-container');
    window.__early = { pending: document.documentElement.hasAttribute('data-tour-pending'),
                       hidden: !!app && getComputedStyle(app).visibility === 'hidden' };
  });
})();"""


def _shown(page: Page, within_ms: int = 5000) -> None:
    """The page stops being held within `within_ms` (timed inside the page)."""
    ok = page.evaluate("""(ms) => new Promise(res => { const t0 = performance.now();
      (function check() { const held = document.documentElement.hasAttribute('data-tour-pending');
        if (!held || performance.now() - t0 > ms) return res(!held); setTimeout(check, 50); })(); })""", within_ms)
    assert ok, "page still held"


def _app(page: Page, prop: str):
    return page.evaluate(f"getComputedStyle(document.querySelector('.app-container')).{prop}")


def _wait_open(page: Page) -> None:
    page.wait_for_function("() => window.__t.open != null", polling=100, timeout=40000)


def _close_and_wait_release(page: Page) -> None:
    page.evaluate("DepTour.close()")
    page.wait_for_function("() => window.__t.release != null", polling=100, timeout=15000)


def test_page_is_hidden_before_the_tour_and_fades_in_after(page: Page, base_url: str):
    page.add_init_script(REAL_VISIT)
    page.add_init_script(PROBE)
    page.goto(f"{base_url}/index.html")
    assert page.evaluate("window.__early") == {"pending": True, "hidden": True}   # nothing shows first
    _wait_open(page)
    assert _app(page, "visibility") == "hidden"                                    # still hidden under the tour
    _close_and_wait_release(page)
    assert page.evaluate("window.__t.release >= window.__t.close")
    assert _app(page, "visibility") == "visible"
    page.wait_for_function("() => window.__revealOpacity != null", polling=50, timeout=3000)
    assert page.evaluate("window.__revealOpacity") < 0.9                           # fading in, not popping in
    page.wait_for_function("() => +getComputedStyle(document.querySelector('.app-container')).opacity === 1",
                           polling=100, timeout=5000)


def test_page_animations_wait_for_the_tour(page: Page, base_url: str):
    page.add_init_script(REAL_VISIT)
    page.add_init_script(PROBE)
    page.goto(f"{base_url}/index.html")
    _wait_open(page)
    page.wait_for_timeout(4000)        # the title would have typed out (3 s) and shone (1.8 s) by now
    title = "document.querySelector('.header-logo [data-tw]')"
    typed = f"{title}.textContent.replace('\\u258f', '').trim()"      # minus the caret
    assert page.evaluate(f"{title}.classList.contains('tw-flow')") is False
    assert page.evaluate(typed) == ""
    assert page.evaluate(f"{title}.classList.contains('hf-sheen')") is False
    counter = page.locator(".sw-counter [data-k='total']")
    if counter.count():
        assert counter.text_content() == "0"
    _close_and_wait_release(page)
    page.wait_for_function(f"() => {typed}.length > 0 && !{title}.classList.contains('tw-flow')",
                           polling=50, timeout=5000)                               # typing now
    page.wait_for_function(f"() => {title}.classList.contains('tw-flow')", polling=100, timeout=8000)
    assert page.evaluate(f"{title}.textContent.trim()") == "Deputation Vacancies"
    page.wait_for_function(f"() => {title}.classList.contains('hf-sheen')", polling=100, timeout=8000)


def test_repeat_and_linked_visits_are_never_hidden(page: Page, base_url: str):
    for url, init in [("/index.html", SEEN_ALL), ("/index.html?search=director", "")]:
        page.add_init_script(REAL_VISIT)
        page.add_init_script(PROBE)
        if init:
            page.add_init_script(init)
        page.goto(f"{base_url}{url}")
        assert page.evaluate("window.__early") == {"pending": False, "hidden": False}, url
        page.wait_for_load_state("load", timeout=30000)
        assert _app(page, "visibility") == "visible", url


def test_page_shows_when_the_loader_decides_against_the_tour(page: Page, base_url: str):
    """The early check knows less than the loader (here: Save-Data); the loader
    lets the page show straight away when it won't play."""
    page.add_init_script(REAL_VISIT)
    page.add_init_script("Object.defineProperty(navigator, 'connection', { get: () => ({ saveData: true }) });")
    page.add_init_script(PROBE)
    page.goto(f"{base_url}/index.html")
    page.wait_for_load_state("load", timeout=30000)
    _shown(page)
    assert _app(page, "visibility") == "visible"


def test_page_shows_if_the_tour_loader_never_arrives(page: Page, base_url: str):
    page.add_init_script(REAL_VISIT)
    page.route("**/tour/tour-loader.js*", lambda r: r.abort())
    page.goto(f"{base_url}/index.html")
    page.wait_for_load_state("load", timeout=30000)
    _shown(page)
    assert _app(page, "visibility") == "visible"


def test_crawlers_see_the_page(page: Page, base_url: str):
    page.add_init_script(REAL_VISIT)
    page.add_init_script("Object.defineProperty(navigator, 'userAgent', { get: () => "
                         "'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });")
    page.add_init_script(PROBE)
    page.goto(f"{base_url}/index.html")
    assert page.evaluate("window.__early") == {"pending": False, "hidden": False}
    page.wait_for_timeout(3000)
    assert page.locator(".dt-overlay").count() == 0


def test_closing_the_tour_fades_slowly(page: Page, base_url: str):
    page.add_init_script(REAL_VISIT)
    page.add_init_script(PROBE)
    page.goto(f"{base_url}/index.html")
    _wait_open(page)
    page.wait_for_timeout(1500)        # past the opening fade-in
    mid = page.evaluate("""() => new Promise(res => { const ov = document.querySelector('.dt-overlay');
      DepTour.close(); setTimeout(() => res(document.contains(ov) ? +getComputedStyle(ov).opacity : -1), 600); })""")
    assert 0.15 < mid < 0.9, mid       # half-way through a ~1.2 s fade (a 0.3 s fade is long over)
    page.wait_for_function("() => !document.querySelector('.dt-overlay')", polling=100, timeout=4000)


# ---- "How this works": 10 s of on-screen time (owner, 2026-11-06) ----

BUTTON_PROBE = """(() => { const t0 = performance.now(); window.__b = { on: 0 }; let last = null;
  setInterval(() => { const b = document.querySelector('.dt-replay'); const now = performance.now();
    if (!b) { if (window.__b.removed == null && window.__b.first != null) window.__b.removed = Math.round(now - t0); return; }
    const cs = getComputedStyle(b), r = b.getBoundingClientRect();
    const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.5 && r.width > 0
                && r.bottom <= innerHeight && !document.documentElement.classList.contains('dt-open');
    if (vis) { if (window.__b.first == null) window.__b.first = Math.round(now - t0);
               if (last != null) window.__b.on += now - last; last = now; } else last = null;
  }, 100); })();"""


@pytest.mark.parametrize("size", [(1440, 900), (390, 844)], ids=["desktop", "phone"])
def test_map_button_stays_10s_and_covers_neither_footer_nor_zoom(page: Page, base_url: str, size):
    page.set_viewport_size({"width": size[0], "height": size[1]})
    page.add_init_script(SEEN_ALL)
    page.add_init_script(BUTTON_PROBE)
    page.goto(f"{base_url}/india-map.html")
    page.wait_for_function("() => window.__b.first != null", polling=100, timeout=10000)
    page.wait_for_timeout(1500)
    overlap = page.evaluate("""() => { const b = document.querySelector('.dt-replay').getBoundingClientRect();
      return [...document.querySelectorAll('.sw-footer, .map-zoom-controls')].filter(el => { const r = el.getBoundingClientRect();
        return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; }).map(el => el.className); }""")
    assert overlap == []                                   # neither the footer nor the zoom buttons
    page.wait_for_function("() => window.__b.removed != null", polling=200, timeout=20000)
    assert page.evaluate("window.__b.on") > 8500, page.evaluate("window.__b")


def test_button_time_starts_after_the_tour(page: Page, base_url: str):
    """First visit: the 10 s don't run out under the tour; the visitor gets them after."""
    page.add_init_script(REAL_VISIT)
    page.add_init_script(PROBE)
    page.add_init_script(BUTTON_PROBE)
    page.goto(f"{base_url}/index.html")
    _wait_open(page)
    page.wait_for_timeout(11000)       # longer than the button's life
    _close_and_wait_release(page)
    page.wait_for_function("() => window.__b.first != null", polling=100, timeout=5000)
    page.wait_for_function("() => window.__b.removed != null", polling=200, timeout=20000)
    assert page.evaluate("window.__b.on") > 8500, page.evaluate("window.__b")
