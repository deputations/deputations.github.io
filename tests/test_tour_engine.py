"""Site tour engine (tour/tour-engine.js + tour/tour.css) — Playwright tests.

Uses small probe tours (two 2-second scenes, "Alpha" and "Beta") so every
behaviour of the overlay, chrome, keyboard, layout and closing is checked
independently of the real Home scenes.

Run:
    pytest tests/test_tour_engine.py -v
"""
from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

from tests.tour_helpers import (
    BLOCK_STORAGE, no_hero_wave, open_engine, register_probe_tour, result, seen, start,
)


def test_overlay_and_chrome(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    ov = page.locator(".dt-overlay")
    expect(ov).to_have_count(1)
    expect(ov).to_have_attribute("role", "dialog")
    expect(ov).to_have_attribute("aria-modal", "true")
    expect(ov).to_have_attribute("aria-labelledby", "dt-title")
    expect(page.locator("#dt-title")).to_have_text("Alpha")
    expect(page.locator(".dt-dots > button")).to_have_count(2)
    expect(page.locator(".dt-badge")).to_have_text("Demo · sample data")
    expect(page.locator(".dt-skip")).to_have_text("Skip →")
    expect(page.locator(".dt-off")).to_have_text("Don't show tours again")
    expect(page.locator(".dt-stage .dt-canvas .dt-camera")).to_have_count(1)


def test_runs_to_end(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page, speed=10)
    assert result(page) == "end"
    expect(page.locator(".dt-overlay")).to_have_count(0)
    assert seen(page).get("t") == 1


def test_skip_button_and_esc(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    page.locator(".dt-skip").click()
    assert result(page) == "skip"
    page.evaluate("localStorage.removeItem('dep_tour_seen_v1')")
    start(page)
    page.keyboard.press("Escape")
    assert result(page) == "skip"
    assert seen(page).get("t") == 1
    expect(page.locator(".dt-overlay")).to_have_count(0)


def test_off_button(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    page.locator(".dt-off").click()
    assert result(page) == "skip"
    assert page.evaluate("localStorage.getItem('dep_tour_off_v1')") == "1"
    assert seen(page).get("t") == 1


def test_close_restores_page(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    page.evaluate(
        """() => {
          document.documentElement.style.overflow = 'auto';
          document.body.insertAdjacentHTML('beforeend', '<button id="probe-btn">probe</button>');
          document.getElementById('probe-btn').focus();
        }"""
    )
    start(page)
    assert page.evaluate("document.documentElement.style.overflow") == "hidden"
    page.locator(".dt-skip").click()
    assert result(page) == "skip"
    assert page.evaluate("document.documentElement.style.overflow") == "auto"
    assert page.evaluate("document.activeElement && document.activeElement.id") == "probe-btn"
    assert page.evaluate(
        """() => document.querySelectorAll('[class^="dt-"]:not(.dt-replay):not(.dt-replay *), [class*=" dt-"]:not(.dt-replay):not(.dt-replay *)').length"""
    ) == 0
    assert page.evaluate("document.documentElement.classList.contains('dt-open')") is False


def test_double_play_single_overlay(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    page.evaluate(
        """() => {
          window.__a = null; window.__b = null;
          DepTour.play('t').then(r => { window.__a = r; });
          DepTour.play('t').then(r => { window.__b = r; });
        }"""
    )
    page.wait_for_selector(".dt-overlay", state="attached")
    page.wait_for_timeout(300)
    expect(page.locator(".dt-overlay")).to_have_count(1)
    page.locator(".dt-skip").click()
    page.wait_for_function("() => window.__a !== null && window.__b !== null", polling=100)
    assert page.evaluate("[window.__a, window.__b]") == ["skip", "skip"]


def test_keyboard_and_dots(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page, scenes=[{"key": "a", "title": "Alpha", "duration": 6},
                                      {"key": "b", "title": "Beta", "duration": 6}])
    start(page)
    page.wait_for_timeout(200)
    page.keyboard.press("ArrowRight")
    page.wait_for_function("() => DepTour.state().sceneIndex === 1", polling=100)
    expect(page.locator("#dt-title")).to_have_text("Beta")
    page.locator(".dt-dots > button").nth(0).click()
    page.wait_for_function("() => DepTour.state().sceneIndex === 0", polling=100)
    expect(page.locator("#dt-title")).to_have_text("Alpha")
    page.locator(".dt-overlay").focus()
    page.keyboard.press("Space")
    page.wait_for_function("() => DepTour.state().paused === true", polling=100)
    before = page.evaluate("DepTour.state().progress")
    page.wait_for_timeout(500)
    assert page.evaluate("DepTour.state().progress") == before
    page.keyboard.press("Space")
    page.wait_for_function("() => DepTour.state().paused === false", polling=100)


def test_scene_errors_are_skipped(page: Page, base_url: str):
    errors, warnings = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "warning" and warnings.append(m.text))
    open_engine(page, base_url)
    register_probe_tour(page, scenes=[{"key": "a", "title": "Alpha", "throws": True},
                                      {"key": "b", "title": "Beta"}])
    start(page)
    expect(page.locator("#dt-title")).to_have_text("Beta")
    assert any(w.startswith("[tour]") for w in warnings), warnings
    page.locator(".dt-skip").click()
    assert result(page) == "skip"

    register_probe_tour(page, key="broken", scenes=[{"key": "a", "title": "Alpha", "throws": True},
                                                    {"key": "b", "title": "Beta", "throws": True}])
    page.evaluate("window.__res = null; DepTour.play('broken').then(r => { window.__res = r; })")
    assert result(page) == "error"
    expect(page.locator(".dt-overlay")).to_have_count(0)
    assert errors == []


def test_resize_switches_layout(page: Page, base_url: str):
    page.set_viewport_size({"width": 1440, "height": 900})
    open_engine(page, base_url)
    register_probe_tour(page, scenes=[{"key": "a", "title": "Alpha", "duration": 8},
                                      {"key": "b", "title": "Beta", "duration": 8}])
    start(page)
    expect(page.locator(".dt-stage.dt-wide")).to_have_count(1)
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(400)
    expect(page.locator(".dt-overlay")).to_have_count(1)
    expect(page.locator(".dt-stage.dt-tall")).to_have_count(1)
    st = page.evaluate("DepTour.state()")
    assert st["layout"] == "tall"
    assert st["sceneIndex"] == 0
    expect(page.locator(".probe")).to_have_count(1)


def test_tall_layout_at_390(page: Page, base_url: str):
    page.set_viewport_size({"width": 390, "height": 844})
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    expect(page.locator(".dt-stage.dt-tall")).to_have_count(1)
    assert page.evaluate("DepTour.state().layout") == "tall"


def test_reduced_motion_still_plays_the_animation(page: Page, base_url: str):
    """Owner, 2026-11-06: office PCs often have Windows animation effects off
    (the browser then reports reduced motion); the tour animates anyway."""
    page.emulate_media(reduced_motion="reduce")
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    assert page.evaluate("DepTour.state().mode") == "cinematic"
    expect(page.locator(".dt-stage")).to_have_count(1)
    assert page.locator(".dt-steps").count() == 0


def test_steps_mode(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page, mode="steps")
    assert page.evaluate("DepTour.state().mode") == "steps"
    expect(page.locator(".dt-steps h3")).to_have_text("Alpha")
    expect(page.locator(".dt-steps p")).to_have_text("Summary of Alpha")
    page.locator(".dt-next").click()
    expect(page.locator(".dt-steps h3")).to_have_text("Beta")
    page.locator(".dt-back").click()
    expect(page.locator(".dt-steps h3")).to_have_text("Alpha")
    page.locator(".dt-next").click()
    page.locator(".dt-next").click()
    assert result(page) == "end"


def test_play_with_storage_blocked(page: Page, base_url: str):
    # The site's own scripts may throw when storage is blocked; only errors
    # raised from tour code count here.
    errors = []
    page.on("pageerror", lambda e: "/tour/" in (e.stack or "") and errors.append(str(e)))
    page.add_init_script(BLOCK_STORAGE)
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    page.locator(".dt-skip").click()
    assert result(page) == "skip"
    assert errors == []


def test_intro_headline(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page, intro="Hello tour")
    start(page)
    expect(page.locator(".dt-headline .dt-ch")).to_have_count(9)


def test_unknown_key_resolves_error(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate("window.__res = null; DepTour.play('nope').then(r => { window.__res = r; })")
    assert result(page) == "error"
    expect(page.locator(".dt-overlay")).to_have_count(0)


def test_pause_during_opening_still_shows_overlay(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    page.evaluate("window.__res = null; DepTour.play('t').then(r => { window.__res = r; }); DepTour.pause();")
    page.wait_for_timeout(900)
    opacity = page.evaluate("""() => [getComputedStyle(document.querySelector('.dt-backdrop')).opacity,
                                      getComputedStyle(document.querySelector('.dt-chrome')).opacity].map(Number)""")
    assert opacity == [1, 1], opacity


def test_expect_waits_for_registration(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate("""() => {
      window.__res = null;
      DepTour.expect('late');
      DepTour.play('late').then(r => { window.__res = r; });
      setTimeout(() => DepTour.register('late', { scenes: [__probeScene('a', 'Late', {duration: 0.3})] }), 600);
    }""")
    page.wait_for_selector(".dt-overlay", state="attached", timeout=10000)
    assert result(page) == "end"


def test_expect_times_out_without_registration(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate("""() => {
      window.__res = null; window.__t0 = performance.now();
      DepTour.expect('never');
      DepTour.play('never').then(r => { window.__res = r; window.__dt = performance.now() - window.__t0; });
    }""")
    assert result(page, timeout=10000) == "error"
    assert 2500 <= page.evaluate("window.__dt") <= 6000
    expect(page.locator(".dt-overlay")).to_have_count(0)


def test_open_and_close_events(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    page.evaluate("""() => {
      window.__events = [];
      document.addEventListener('deptour:open', e => __events.push(['open', e.detail.key]));
      document.addEventListener('deptour:close', e => __events.push(['close', e.detail.key, e.detail.reason]));
    }""")
    start(page)
    page.locator(".dt-skip").click()
    assert result(page) == "skip"
    assert page.evaluate("window.__events") == [["open", "t"], ["close", "t", "skip"]]


def test_skipping_ahead_reaches_the_cta(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page, intro="Hello tour", cta="Go")
    start(page)
    for _ in range(3):
        page.keyboard.press("ArrowRight")
    cta = page.locator(".dt-cta")
    expect(cta).to_contain_text("Go", timeout=5000)
    cta.click()
    assert result(page) == "cta"
    assert page.evaluate("window.__ctaRan") is True


# ---- review fixes: keyboard, focus, screen readers, Back, small screens, cost ----

def test_keys_inside_a_page_dialog_are_left_alone(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page, scenes=[{"key": "a", "title": "Alpha", "duration": 20}])
    start(page)
    page.evaluate("""() => {
      const d = document.createElement('dialog');
      d.id = 'page-dialog';
      d.innerHTML = '<input id="page-input">';
      document.body.appendChild(d);
      d.showModal();
      document.getElementById('page-input').focus();
    }""")
    page.keyboard.type("a b")
    page.keyboard.press("ArrowLeft")
    page.keyboard.type("c")
    assert page.evaluate("document.getElementById('page-input').value") == "a cb"
    page.keyboard.press("Escape")
    assert page.evaluate("document.getElementById('page-dialog').open") is False
    assert page.evaluate("DepTour.isOpen()") is True


def test_shift_tab_stays_inside_the_tour(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    page.wait_for_timeout(200)
    for key in ["Shift+Tab", "Tab", "Shift+Tab", "Shift+Tab"]:
        page.keyboard.press(key)
        inside = page.evaluate("""() => { const o = document.querySelector('.dt-overlay'), a = document.activeElement;
                                          return o.contains(a) && a !== o; }""")
        assert inside, key


def test_page_is_inert_while_the_tour_is_open(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    page.evaluate("document.body.insertAdjacentHTML('beforeend', '<div id=\"already-inert\" inert></div>')")
    start(page)
    assert page.evaluate("""() => [...document.body.children]
        .filter(el => !el.classList.contains('dt-overlay')).every(el => el.inert)""")
    page.locator(".dt-skip").click()
    assert result(page) == "skip"
    assert page.evaluate("""() => [...document.body.children]
        .filter(el => el.id !== 'already-inert').every(el => !el.inert)""")
    assert page.evaluate("document.getElementById('already-inert').inert") is True


def test_screen_reader_semantics(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    expect(page.locator(".dt-stage")).to_have_attribute("aria-hidden", "true")
    expect(page.locator(".dt-head")).to_have_attribute("aria-live", "polite")
    expect(page.locator(".dt-skip")).to_have_attribute("aria-label", "Skip the demo")


def test_back_button_closes_the_tour(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    url = page.url
    start(page)
    page.go_back()
    assert result(page) == "skip"
    expect(page.locator(".dt-overlay")).to_have_count(0)
    assert page.url == url


def test_closing_removes_the_history_entry(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page)
    url = page.url
    length = page.evaluate("history.length")
    start(page)
    page.locator(".dt-skip").click()
    assert result(page) == "skip"
    page.wait_for_function("() => !(history.state && history.state.dtTour)", polling=100, timeout=5000)
    assert page.url == url
    assert page.evaluate("history.length") <= length + 1


def test_small_landscape_phone_gets_the_steps_view(page: Page, base_url: str):
    page.set_viewport_size({"width": 844, "height": 390})
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    assert page.evaluate("DepTour.state().mode") == "steps"


def test_layout_is_chosen_by_readable_scale(page: Page, base_url: str):
    for vp, layout in [((1440, 900), "wide"), ((1024, 768), "wide"), ((390, 844), "tall"), ((820, 1180), "tall")]:
        page.set_viewport_size({"width": vp[0], "height": vp[1]})
        open_engine(page, base_url)
        register_probe_tour(page)
        start(page)
        st = page.evaluate("DepTour.state()")
        assert st["layout"] == layout, (vp, st)
        scale = page.evaluate("""() => document.querySelector('.dt-canvas').getBoundingClientRect().width /
                                       document.querySelector('.dt-canvas').offsetWidth""")
        assert scale >= 0.6, (vp, scale)
        page.locator(".dt-skip").click()
        assert result(page) == "skip"


def test_steps_view_ends_on_the_cta(page: Page, base_url: str):
    open_engine(page, base_url)
    register_probe_tour(page, cta="Go")
    start(page, mode="steps")
    page.locator(".dt-next").click()
    expect(page.locator(".dt-next")).to_have_text("Go")
    page.locator(".dt-next").click()
    assert result(page) == "cta"
    assert page.evaluate("window.__ctaRan") is True


def test_heavy_effects_are_lighter_on_low_power_devices(page: Page, base_url: str):
    page.add_init_script("Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });"
                         "Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 });")
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    expect(page.locator(".dt-overlay.dt-low")).to_have_count(1)
    assert page.evaluate("getComputedStyle(document.querySelector('.dt-backdrop')).backdropFilter") == "none"
    assert page.evaluate("getComputedStyle(document.querySelector('.dt-aurora')).filter") == "none"


@pytest.mark.real_hero
def test_the_3d_hero_pauses_while_the_tour_is_open(page: Page, base_url: str):
    """The page's WebGL wave keeps drawing every frame; under the tour it must not."""
    page.add_init_script("""
      window.__draws = 0;
      for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!C) continue;
        for (const m of ['drawArrays', 'drawElements']) {
          const orig = C.prototype[m];
          C.prototype[m] = function () { window.__draws++; return orig.apply(this, arguments); };
        }
      }
    """)
    open_engine(page, base_url)
    page.wait_for_function("() => window.__draws > 0", polling=200, timeout=30000)
    register_probe_tour(page, scenes=[{"key": "a", "title": "Alpha", "duration": 30}])
    start(page)
    page.wait_for_timeout(1000)
    before = page.evaluate("window.__draws")
    page.wait_for_timeout(2500)
    assert page.evaluate("window.__draws") == before
    page.locator(".dt-skip").click()
    assert result(page) == "skip"
    after = page.evaluate("window.__draws")
    page.wait_for_function(f"() => window.__draws > {after}", polling=200, timeout=15000)


def test_aurora_blending_stays_inside_the_aurora(page: Page, base_url: str):
    """Blending that leaks into the overlay silently disables the backdrop blur of
    the page behind in Chrome (found by eye in the review fix pass)."""
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
    assert page.evaluate("getComputedStyle(document.querySelector('.dt-aurora')).isolation") == "isolate"


# ---- Home v2: brand intro, finale that keeps the scene with page links ----

def _register_brand(page: Page) -> None:
    page.evaluate("""() => DepTour.register('t', {
      intro: { headline: 'Hello tour', brand: 'ALL Deputations.com' },
      scenes: [__probeScene('a', 'Alpha', { duration: 0.4 })] })""")


def test_brand_follows_the_headline(page: Page, base_url: str):
    open_engine(page, base_url)
    _register_brand(page)
    start(page)
    expect(page.locator(".dt-headline .dt-ch")).to_have_count(9)
    page.wait_for_function("() => !!document.querySelector('.dt-brand')", polling=100, timeout=15000)
    assert page.evaluate("document.querySelector('.dt-brand').textContent") == "ALL Deputations.com"
    assert page.evaluate("document.querySelector('.dt-brand-a').textContent") == "ALL"
    assert page.evaluate("document.querySelector('.dt-brand-tld').textContent") == ".com"


def test_brand_fits_the_screen(page: Page, base_url: str):
    for w, h in [(1440, 900), (390, 844)]:
        page.set_viewport_size({"width": w, "height": h})
        open_engine(page, base_url)
        _register_brand(page)
        start(page, speed=0.25)     # a starved test browser paints ~1 fps; widen the hold to sample it
        page.wait_for_function("""() => {
          const b = document.querySelector('.dt-brand');
          if (!b) return false;
          const r = b.getBoundingClientRect(), k = r.width / innerWidth;
          return +getComputedStyle(b).opacity > 0.98 && k >= 0.8 && k <= 0.95 &&
                 r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
        }""", polling=50, timeout=20000)
        page.locator(".dt-skip").click()
        assert result(page) == "skip"


LINK_SCENE = """(key) => DepTour.register(key, {
  scenes: [{ key: 'p', label: 'L', title: 'Pages', summary: 'S', build(stage) {
    const a = document.createElement('a');
    a.className = 'dt-page-link probe-link'; a.href = '/x.html'; a.textContent = 'X page';
    Object.assign(a.style, { position: 'absolute', left: '100px', top: '100px', padding: '20px' });
    stage.appendChild(a);
    return gsap.timeline().to({}, { duration: 0.3 });
  } }],
  cta: { label: 'Go', keepScene: true, action() { window.__ctaRan = true; } } })"""


def test_keep_scene_finale_shows_links(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate(LINK_SCENE, "t")
    start(page)
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    expect(page.locator(".dt-overlay.dt-finale-on")).to_have_count(1)
    expect(page.locator(".dt-finale.is-bottom")).to_have_count(1)
    assert page.evaluate("document.querySelector('.dt-stage').hasAttribute('aria-hidden')") is False
    assert page.evaluate("getComputedStyle(document.querySelector('.dt-camera')).opacity") == "1"
    expect(page.locator(".probe-link")).to_be_visible()


def test_page_card_opens_its_page(page: Page, base_url: str):
    page.route("**/x.html", lambda r: r.fulfill(body="<!doctype html><title>x</title><p>x</p>", content_type="text/html"))
    open_engine(page, base_url)
    page.evaluate(LINK_SCENE, "t")
    start(page)
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    page.locator(".probe-link").click()
    page.wait_for_url("**/x.html", timeout=10000)
    assert seen(page).get("t") == 1


def test_links_do_nothing_before_the_finale(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate(LINK_SCENE.replace("duration: 0.3", "duration: 30"), "t")
    start(page)
    page.wait_for_timeout(800)
    page.locator(".probe-link").click(force=True)
    page.wait_for_timeout(500)
    assert page.evaluate("DepTour.isOpen()") is True
    assert page.url.endswith("/index.html")


def test_finale_links_are_keyboard_reachable(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate(LINK_SCENE, "t")
    start(page)
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    seen_classes = set()
    for _ in range(8):
        page.keyboard.press("Tab")
        seen_classes.add(page.evaluate("document.activeElement.className"))
    assert any("probe-link" in c for c in seen_classes), seen_classes
    assert any("dt-cta" in c for c in seen_classes), seen_classes


def test_arrow_keys_at_the_finale_keep_the_scene(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate(LINK_SCENE, "t")
    start(page)
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    page.locator(".dt-overlay").focus()
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(300)
    expect(page.locator(".probe-link")).to_have_count(1)
    expect(page.locator(".dt-cta")).to_have_count(1)


def test_replay_right_after_closing_stays_open(page: Page, base_url: str):
    """Closing pops the tour's history entry asynchronously; a replay started at
    once must not be closed by that late pop — and Back must still close it."""
    open_engine(page, base_url)
    register_probe_tour(page, scenes=[{"key": "a", "title": "Alpha", "duration": 30}])
    url = page.url
    start(page)
    page.evaluate("""() => {
      window.__res2 = null;
      DepTour.close('skip');
      const t = setInterval(() => {            // replay the moment the first tour is gone
        if (DepTour.isOpen()) return;
        clearInterval(t);
        DepTour.play('t').then(r => { window.__res2 = r; });
      }, 5);
    }""")
    page.wait_for_timeout(1500)
    assert page.evaluate("DepTour.isOpen()") is True
    page.go_back()
    page.wait_for_function("() => window.__res2 === 'skip'", polling=100, timeout=10000)
    assert page.url == url


# ---- Home v2 review fixes ----

def test_skipping_during_the_brand_removes_it(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate("""() => DepTour.register('t', {
      intro: { headline: 'Hello tour', brand: 'ALL Deputations.com' },
      scenes: [__probeScene('a', 'Alpha', { duration: 20 })] })""")
    start(page, speed=0.25)
    page.wait_for_function("""() => { const b = document.querySelector('.dt-brand');
                                     return b && +getComputedStyle(b).opacity > 0.5; }""", polling=50, timeout=30000)
    page.locator(".dt-overlay").focus()
    page.keyboard.press("ArrowRight")
    page.wait_for_function("() => DepTour.state().sceneIndex === 0", polling=100, timeout=5000)
    expect(page.locator(".dt-brand")).to_have_count(0)


def test_going_back_from_the_finale_leaves_finale_mode(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate("""() => DepTour.register('t', {
      scenes: [__probeScene('a', 'Alpha', { duration: 0.3 }),
               { key: 'p', label: 'L', title: 'Pages', summary: 'S', build(stage) {
                   const a = document.createElement('a'); a.className = 'dt-page-link probe-link'; a.href = '/x.html';
                   a.textContent = 'X'; stage.appendChild(a); return gsap.timeline().to({}, { duration: 0.3 }); } }],
      cta: { label: 'Go', keepScene: true } })""")
    start(page)
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    page.locator(".dt-overlay").focus()
    page.keyboard.press("ArrowLeft")
    page.wait_for_function("() => DepTour.state().phase === 'scene'", polling=100, timeout=5000)
    expect(page.locator(".dt-overlay.dt-finale-on")).to_have_count(0)
    expect(page.locator(".dt-stage")).to_have_attribute("aria-hidden", "true")


# ---- owner, 2026-11-06: the last screen vanishes slowly (3 s) by itself ----

def test_finale_fades_away_by_itself(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate(LINK_SCENE, "t")
    start(page)
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    page.wait_for_function("() => { const o = document.querySelector('.dt-overlay');"
                           " return o && +getComputedStyle(o).opacity < 0.8 && +getComputedStyle(o).opacity > 0.05; }",
                           polling=100, timeout=10000)          # fading slowly, not cut
    assert result(page, timeout=15000) == "end"
    expect(page.locator(".dt-overlay")).to_have_count(0)


def test_finale_stays_while_the_visitor_points_at_it(page: Page, base_url: str):
    open_engine(page, base_url)
    page.evaluate(LINK_SCENE, "t")
    start(page)
    expect(page.locator(".dt-cta")).to_be_visible(timeout=10000)
    page.locator(".probe-link").hover()
    page.wait_for_timeout(6000)
    assert page.evaluate("DepTour.isOpen()") is True
    assert page.evaluate("+getComputedStyle(document.querySelector('.dt-overlay')).opacity") > 0.95
