"""Site tour — the India Map page tour (tour/scenes/map-page.js), end to end
through the real loader on india-map.html.

Run:
    pytest tests/test_tour_map_page.py -v
"""
from __future__ import annotations

from urllib.parse import urlparse

from playwright.sync_api import Page, expect

from tests.tour_helpers import no_hero_wave, seen  # noqa: F401

TITLES = ["Every state at a glance", "Filter the whole map", "Dive into a state",
          "Posts in every district", "Zoom, list and go back"]
HEADLINE = "Vacancies across India, on one map"
RECORD_CLOSE = "document.addEventListener('deptour:close', e => { window.__closed = e.detail; });"
REAL_VISIT = "Object.defineProperty(navigator, 'webdriver', { get: () => false });"
MAP_ORDER = ["/vendor/gsap.min.js", "/tour/tour.css", "/tour/tour-engine.js", "/tour/tour-kit.js",
             "/tour/scenes/map.js", "/tour/scenes/map-page.js"]


def _open_map(page: Page, base_url: str, speed: float = 1) -> None:
    page.add_init_script(RECORD_CLOSE)
    page.goto(f"{base_url}/india-map.html?tour=play&tourSpeed={speed}")
    page.wait_for_function("() => !!window.gsap && !!window.DepTour", polling=100, timeout=30000)
    page.evaluate("gsap.ticker.lagSmoothing(0)")
    page.wait_for_function("() => DepTour.isOpen()", polling=100, timeout=20000)


def _go(page: Page, index: int) -> None:
    page.evaluate(f"DepTour.goTo({index}); DepTour.pause();")
    page.wait_for_function(f"() => DepTour.state().sceneIndex === {index} && DepTour.state().phase === 'scene'",
                           polling=100)


def _end(page: Page, index: int) -> None:
    _go(page, index)
    page.evaluate("DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(120)


def _text(page: Page, sel: str) -> str:
    return page.evaluate(f"(document.querySelector({sel!r}) || {{}}).textContent || ''")


def test_map_tour_titles_in_order(page: Page, base_url: str):
    _open_map(page, base_url)
    page.wait_for_function("() => document.querySelectorAll('.dt-headline .dt-ch').length > 0",
                           polling=100, timeout=10000)
    assert _text(page, ".dt-headline") == HEADLINE
    for i, title in enumerate(TITLES):
        page.evaluate(f"DepTour.goTo({i})")
        expect(page.locator("#dt-title")).to_have_text(title)


def test_hover_tooltip(page: Page, base_url: str):
    _open_map(page, base_url)
    _end(page, 0)
    tip = _text(page, ".dt-maptip")
    assert "Maharashtra" in tip and "sample posts" in tip, tip
    assert page.evaluate("+getComputedStyle(document.querySelector('.dt-maptip')).opacity") > 0.9
    assert page.evaluate("document.querySelector('.dt-mcount').getAttribute('aria-label')") == "1240"


def test_filters_recolour_the_map(page: Page, base_url: str):
    _open_map(page, base_url)
    _go(page, 1)
    fills = "() => [...document.querySelectorAll('path.dt-state')].map(p => getComputedStyle(p).fill)"
    page.evaluate("DepTour.seek(0.3)")
    page.wait_for_timeout(80)
    before = page.evaluate(fills)
    page.evaluate("DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(120)
    after = page.evaluate(fills)
    assert sum(1 for a, b in zip(before, after) if a != b) >= 10
    panel = _text(page, ".dt-mfilter")
    assert "Level 8" in panel and "Finance" in panel, panel
    assert page.evaluate("document.querySelector('.dt-mcount').getAttribute('aria-label')") == "58"


def test_dive_into_karnataka(page: Page, base_url: str):
    page.set_viewport_size({"width": 1440, "height": 900})
    _open_map(page, base_url)
    _end(page, 2)
    expect(page.locator("path.dt-district")).to_have_count(31)
    assert "Back to India" in _text(page, ".dt-mback")
    assert "Karnataka" in _text(page, ".dt-mstate")
    d = page.evaluate("""() => {
      const ka = document.querySelector("path.dt-state[data-abbr='KA']").getBoundingClientRect();
      const mv = document.querySelector('.dt-map-view').getBoundingClientRect();
      return Math.abs((ka.left + ka.width / 2) - (mv.left + mv.width / 2)) / mv.width;
    }""")
    assert d < 0.12, d


def test_posts_in_bengaluru(page: Page, base_url: str):
    _open_map(page, base_url)
    _end(page, 3)
    assert page.evaluate("[...document.querySelectorAll('.dt-pin')].some(p => +getComputedStyle(p).opacity > 0.9)")
    expect(page.locator(".dt-mpost")).to_have_count(3)
    expect(page.locator(".dt-mdetail .dt-heart.is-saved")).to_have_count(1)
    assert "Bengaluru Urban" in _text(page, ".dt-mposts")
    clear = page.evaluate("""() => {
      const h = document.querySelector('.dt-mdetail .dt-heart').getBoundingClientRect();
      return [...document.querySelectorAll('.dt-mdetail > b, .dt-mdetail > span:not(.dt-heart)')].every(el => {
        const r = document.createRange(); r.selectNodeContents(el);
        return [...r.getClientRects()].every(t => t.right <= h.left + 1 || t.top >= h.bottom - 1 || t.bottom <= h.top + 1);
      });
    }""")
    assert clear, "post card text runs under the heart"


def test_back_to_india_restores_the_map(page: Page, base_url: str):
    _open_map(page, base_url)
    _go(page, 4)
    assert _text(page, ".dt-mlistbtn").strip() == "View all 96 vacancies in Karnataka"
    page.evaluate("DepTour.seek(2.2)")
    page.wait_for_timeout(80)
    assert page.evaluate("+getComputedStyle(document.querySelector('.dt-mlist')).opacity") > 0.5
    page.evaluate("DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(120)
    assert page.evaluate("document.querySelector('.dt-map-svg').getAttribute('viewBox')") == "0 0 1000 800"
    assert page.evaluate("[...document.querySelectorAll('path.dt-district')].every(p => +getComputedStyle(p).opacity === 0)")


def test_map_tour_fits_on_phone(page: Page, base_url: str):
    page.set_viewport_size({"width": 390, "height": 844})
    _open_map(page, base_url)
    for i in range(len(TITLES)):
        _end(page, i)
        out = page.evaluate("""() => {
          const cv = document.querySelector('.dt-canvas').getBoundingClientRect();
          return [...document.querySelectorAll('.dt-mcount-wrap, .dt-maptip, .dt-mfilter, .dt-mback, .dt-mstate,'
                                                + ' .dt-mposts, .dt-mdetail, .dt-mlistbtn, .dt-mzoom')]
            .filter(e => +getComputedStyle(e).opacity > 0.5)
            .map(e => [e.className, e.getBoundingClientRect()])
            .filter(([, r]) => r.left < cv.left - 2 || r.right > cv.right + 2 || r.top < cv.top - 2 || r.bottom > cv.bottom + 2)
            .map(([c]) => c);
        }""")
        assert out == [], (TITLES[i], out)


PANELS = ".dt-mcount-wrap, .dt-mfilter, .dt-mback, .dt-mstate, .dt-mposts, .dt-mdetail, .dt-mlistbtn, .dt-mlist, .dt-mzoom"
OVERLAPS = """(sel) => {
  const vis = [...document.querySelectorAll(sel)].filter(e => +getComputedStyle(e).opacity > 0.5)
    .map(e => [e.className.split(' ')[0], e.getBoundingClientRect()]);
  const hits = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i][1], b = vis[j][1];
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
      hits.push(vis[i][0] + ' x ' + vis[j][0]);
  }
  return hits;
}"""


def test_map_tour_panels_never_overlap(page: Page, base_url: str):
    for vp in ({"width": 1440, "height": 900}, {"width": 390, "height": 844}):
        page.set_viewport_size(vp)
        _open_map(page, base_url, speed=0.25)
        for i in range(len(TITLES)):
            _go(page, i)
            dur = page.evaluate("DepTour.state().sceneDuration")
            for t in (dur * 0.35, dur * 0.5, dur - 0.01):
                page.evaluate(f"DepTour.seek({t})")
                page.wait_for_timeout(100)
                assert page.evaluate(OVERLAPS, PANELS) == [], (vp["width"], TITLES[i], round(t, 2))
        page.evaluate("DepTour.close()")


def test_map_page_loads_in_order(page: Page, base_url: str):
    stub = "window.DepTour={play:(k,o)=>{window.__played=[k,o.speed];return Promise.resolve('end')}};"
    page.route("**/vendor/gsap.min.js*", lambda r: r.fulfill(body="", content_type="application/javascript"))
    page.route("**/tour/tour.css*", lambda r: r.fulfill(body="", content_type="text/css"))
    page.route("**/tour/tour-engine.js*", lambda r: r.fulfill(body=stub, content_type="application/javascript"))
    page.route("**/tour/tour-kit.js*", lambda r: r.fulfill(body="", content_type="application/javascript"))
    page.route("**/tour/scenes/*.js*", lambda r: r.fulfill(body="", content_type="application/javascript"))
    order = []

    def note(r):
        path = urlparse(r.url).path
        if path.startswith("/vendor/gsap") or (path.startswith("/tour/") and path != "/tour/tour-loader.js"):
            order.append(path)
    page.on("request", note)
    page.goto(f"{base_url}/india-map.html?tour=play&tourSpeed=3")
    page.wait_for_function("() => !!window.__played", polling=100, timeout=20000)
    assert order == MAP_ORDER
    assert page.evaluate("window.__played") == ["map", 3]


def test_map_autoplays_on_a_plain_visit_but_not_a_shared_link(page: Page, base_url: str):
    page.add_init_script(REAL_VISIT)
    page.goto(f"{base_url}/india-map.html?state=KA")
    page.wait_for_load_state("load", timeout=30000)
    page.wait_for_function("() => !!window.DepTourLoader", polling=100, timeout=30000)
    page.wait_for_timeout(3000)
    assert page.locator(".dt-overlay").count() == 0
    page.goto(f"{base_url}/india-map.html")
    page.wait_for_selector(".dt-overlay", state="attached", timeout=30000)


def test_map_cta_closes_onto_the_map(page: Page, base_url: str):
    _open_map(page, base_url)
    for _ in range(8):
        page.keyboard.press("ArrowRight")
    cta = page.locator(".dt-cta")
    expect(cta).to_contain_text("Explore the map", timeout=10000)
    cta.click()
    page.wait_for_function("() => !!window.__closed", polling=100, timeout=10000)
    assert page.evaluate("window.__closed.reason") == "cta"
    expect(page.locator(".dt-overlay")).to_have_count(0)
    assert seen(page).get("map") == 1
