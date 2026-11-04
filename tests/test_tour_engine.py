"""Site tour engine (tour/tour-engine.js + tour/tour.css) — Playwright tests.

Uses small probe tours (two 2-second scenes, "Alpha" and "Beta") so every
behaviour of the overlay, chrome, keyboard, layout and closing is checked
independently of the real Home scenes.

Run:
    pytest tests/test_tour_engine.py -v
"""
from __future__ import annotations

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


def test_steps_mode_reduced_motion(page: Page, base_url: str):
    page.emulate_media(reduced_motion="reduce")
    open_engine(page, base_url)
    register_probe_tour(page)
    start(page)
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
