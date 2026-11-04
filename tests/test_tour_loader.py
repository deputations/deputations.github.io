"""Site tour loader (tour/tour-loader.js) — Playwright smoke tests.

The loader is the only always-loaded tour file. It decides whether a page's
demo auto-plays, injects the "How this works" replay button and lazy-loads
GSAP, the engine, the kit and the page's scenes.

Run:
    pytest tests/test_tour_loader.py -v
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from playwright.sync_api import Page, expect

HOME_ORDER = [
    "/vendor/gsap.min.js",
    "/tour/tour.css",
    "/tour/tour-engine.js",
    "/tour/tour-kit.js",
    "/tour/scenes/map.js",
    "/tour/scenes/home.js",
]

ENGINE_STUB = (
    "window.DepTour={play:(k,o)=>{window.__played=[k,o.speed];"
    "return Promise.resolve('end')}};"
)

BLOCK_STORAGE = """
  (() => {
    const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.getItem = boom;
    Storage.prototype.setItem = boom;
  })();
"""


def _tour_path(url: str) -> str | None:
    path = urlparse(url).path
    if path.startswith("/vendor/gsap") or (path.startswith("/tour/") and path != "/tour/tour-loader.js"):
        return path
    return None


def _wait_for_loader(page: Page) -> None:
    page.wait_for_function("() => !!window.DepTourLoader", timeout=10000)


def test_no_autoplay_under_webdriver(page: Page, base_url: str):
    requested = []
    page.on("request", lambda r: requested.append(r.url))
    page.goto(f"{base_url}/index.html")
    _wait_for_loader(page)
    page.wait_for_timeout(2500)
    assert page.locator(".dt-overlay").count() == 0
    assert not any("/vendor/gsap.min.js" in u for u in requested)


def test_replay_button(page: Page, base_url: str):
    page.goto(f"{base_url}/index.html")
    btn = page.locator(".dt-replay")
    expect(btn).to_be_visible(timeout=10000)
    expect(btn).to_contain_text("How this works")
    expect(btn).to_have_attribute("aria-label", "Play the how-to demo for this page")


def test_should_autoplay_rules(page: Page, base_url: str):
    page.goto(f"{base_url}/index.html")
    _wait_for_loader(page)
    results = page.evaluate(
        """() => {
          const base = {seen: {}, off: false, webdriver: false, reducedMotion: false, force: false};
          const f = (over) => DepTourLoader.shouldAutoplay({...base, ...over}, 'home');
          return {
            clean: f({}),
            seen: f({seen: {home: 1}}),
            seenOther: f({seen: {map: 1}}),
            off: f({off: true}),
            webdriver: f({webdriver: true}),
            reduced: f({reducedMotion: true}),
            forced: f({seen: {home: 1}, off: true, webdriver: true, reducedMotion: true, force: true}),
          };
        }"""
    )
    assert results == {
        "clean": True,
        "seen": False,
        "seenOther": True,
        "off": False,
        "webdriver": False,
        "reduced": False,
        "forced": True,
    }


def test_force_play_loads_in_order(page: Page, base_url: str):
    page.route("**/vendor/gsap.min.js*", lambda r: r.fulfill(body="", content_type="application/javascript"))
    page.route("**/tour/tour.css*", lambda r: r.fulfill(body="", content_type="text/css"))
    page.route("**/tour/tour-engine.js*", lambda r: r.fulfill(body=ENGINE_STUB, content_type="application/javascript"))
    page.route("**/tour/tour-kit.js*", lambda r: r.fulfill(body="", content_type="application/javascript"))
    page.route("**/tour/scenes/*.js*", lambda r: r.fulfill(body="", content_type="application/javascript"))
    order = []
    page.on("request", lambda r: (p := _tour_path(r.url)) and order.append(p))
    page.goto(f"{base_url}/index.html?tour=play&tourSpeed=20")
    page.wait_for_function("() => !!window.__played", timeout=15000)
    assert order == HOME_ORDER
    assert page.evaluate("window.__played") == ["home", 20]


def test_asset_failure_leaves_page_untouched(page: Page, base_url: str):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/vendor/gsap.min.js*", lambda r: r.abort())
    with page.expect_event("requestfailed", lambda r: "/vendor/gsap.min.js" in r.url, timeout=15000):
        page.goto(f"{base_url}/index.html?tour=play")
    page.wait_for_timeout(800)
    assert errors == []
    assert page.locator(".dt-overlay").count() == 0
    assert page.evaluate("DepTourLoader.play('home')") == "unavailable"
    page.locator("#filterMyPayLevelBtn").click(timeout=5000)


def test_storage_blocked_is_safe(page: Page, base_url: str):
    page.add_init_script(BLOCK_STORAGE)
    page.goto(f"{base_url}/index.html")
    _wait_for_loader(page)
    out = page.evaluate(
        """() => {
          const seen = DepTourLoader.readSeen();
          DepTourLoader.markSeen('home');
          DepTourLoader.setOff();
          return {seen, off: DepTourLoader.isOff()};
        }"""
    )
    assert out == {"seen": {}, "off": False}


def test_mark_seen_and_off(page: Page, base_url: str):
    page.goto(f"{base_url}/index.html")
    _wait_for_loader(page)
    out = page.evaluate(
        """() => {
          localStorage.removeItem('dep_tour_seen_v1');
          localStorage.removeItem('dep_tour_off_v1');
          DepTourLoader.markSeen('home');
          DepTourLoader.markSeen('map');
          const seen = JSON.parse(localStorage.getItem('dep_tour_seen_v1'));
          const offBefore = DepTourLoader.isOff();
          DepTourLoader.setOff();
          return {seen, offBefore, off: localStorage.getItem('dep_tour_off_v1'),
                  read: DepTourLoader.readSeen(), offAfter: DepTourLoader.isOff()};
        }"""
    )
    assert out == {"seen": {"home": 1, "map": 1}, "offBefore": False, "off": "1",
                   "read": {"home": 1, "map": 1}, "offAfter": True}


def test_corrupt_seen_reads_empty(page: Page, base_url: str):
    page.add_init_script("try { localStorage.setItem('dep_tour_seen_v1', '{not json'); } catch (e) {}")
    page.goto(f"{base_url}/index.html")
    _wait_for_loader(page)
    assert page.evaluate("DepTourLoader.readSeen()") == {}


def test_replay_hides_over_footer(page: Page, base_url: str):
    page.goto(f"{base_url}/index.html")
    btn = page.locator(".dt-replay")
    expect(btn).to_be_visible(timeout=10000)
    page.wait_for_selector(".sw-footer", state="attached", timeout=10000)
    page.evaluate("document.querySelector('.sw-footer').scrollIntoView({block: 'end'})")
    expect(btn).to_have_class(re.compile(r"\bdt-replay--hidden\b"), timeout=5000)
