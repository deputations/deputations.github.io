"""Site tour India map helpers + teaser scene (tour/scenes/map.js).

Registers a tour containing only DepTourMap.teaserScene and checks the map it
draws, the dive into Karnataka, the districts and the pin.

Run:
    pytest tests/test_tour_map_scene.py -v
"""
from __future__ import annotations

from playwright.sync_api import Page, expect

from tests.tour_helpers import no_hero_wave, open_engine, start  # noqa: F401


def _open_teaser(page: Page, base_url: str, speed: float = 1) -> None:
    open_engine(page, base_url)
    page.add_script_tag(url=f"{base_url}/tour/scenes/map.js")
    page.wait_for_function("() => !!window.DepTourMap", polling=100, timeout=10000)
    page.evaluate("""async () => {
      await DepTourMap.load();
      DepTour.register('t', { scenes: [DepTourMap.teaserScene] });
    }""")
    start(page, speed=speed)
    page.wait_for_function("() => DepTour.state().phase === 'scene'", polling=100, timeout=10000)


def _seek_end(page: Page) -> None:
    page.evaluate("DepTour.pause(); DepTour.seek(DepTour.state().sceneDuration - 0.01)")


def test_draws_36_states(page: Page, base_url: str):
    _open_teaser(page, base_url)
    expect(page.locator("path.dt-state")).to_have_count(36)
    assert page.locator("path.dt-state[data-abbr='KA']").count() == 1


def test_dive_centres_karnataka(page: Page, base_url: str):
    page.set_viewport_size({"width": 1440, "height": 900})
    _open_teaser(page, base_url)
    _seek_end(page)
    page.wait_for_timeout(150)
    d = page.evaluate("""() => {
      const ka = document.querySelector("path.dt-state[data-abbr='KA']").getBoundingClientRect();
      const cv = document.querySelector('.dt-canvas').getBoundingClientRect();
      return { dx: Math.abs((ka.left + ka.width / 2) - (cv.left + cv.width / 2)),
               dy: Math.abs((ka.top + ka.height / 2) - (cv.top + cv.height / 2)),
               fill: Math.max(ka.width / cv.width, ka.height / cv.height) };
    }""")
    assert d["dx"] <= 40 and d["dy"] <= 40, d
    assert 0.5 <= d["fill"] <= 0.9, d          # the state fills roughly 70 % of the stage


def test_districts_and_pin(page: Page, base_url: str):
    _open_teaser(page, base_url)
    _seek_end(page)
    expect(page.locator("path.dt-district")).to_have_count(31)
    expect(page.locator("path.dt-district[data-name='Bengaluru Urban']")).to_have_count(1)
    expect(page.locator(".dt-pin")).to_have_count(1)
    expect(page.locator(".dt-beam")).to_have_count(1)
    assert page.evaluate("""() => [...document.querySelectorAll('path.dt-district')]
                             .every(p => parseFloat(getComputedStyle(p).opacity) > 0.9)""")


def test_teaser_meta(page: Page, base_url: str):
    _open_teaser(page, base_url)
    expect(page.locator("#dt-title")).to_have_text("See India's vacancies on a map")
    assert page.evaluate("'label' in DepTourMap.teaserScene") is False   # no "STEP n" labels (owner, 2026-11-05)
    assert page.evaluate("DepTourMap.teaserScene.summary") == (
        "Open the India Map to see vacancies state by state and district by district.")


def test_teaser_on_phone(page: Page, base_url: str):
    page.set_viewport_size({"width": 390, "height": 844})
    _open_teaser(page, base_url)
    _seek_end(page)
    page.wait_for_timeout(150)
    d = page.evaluate("""() => {
      const ka = document.querySelector("path.dt-state[data-abbr='KA']").getBoundingClientRect();
      const cv = document.querySelector('.dt-canvas').getBoundingClientRect();
      return { dx: Math.abs((ka.left + ka.width / 2) - (cv.left + cv.width / 2)),
               inside: ka.left >= cv.left - 2 && ka.right <= cv.right + 2 };
    }""")
    assert d["dx"] <= 30 and d["inside"], d


def test_tapping_a_state_does_not_make_it_jump(page: Page, base_url: str):
    page.set_viewport_size({"width": 1440, "height": 900})
    _open_teaser(page, base_url, speed=0.25)
    page.evaluate("DepTour.pause(); DepTour.seek(4.1)")
    page.wait_for_timeout(100)
    rest = page.evaluate("""() => { const r = document.querySelector("path.dt-state[data-abbr='KA']").getBoundingClientRect();
                                    return [r.left, r.top, r.width]; }""")
    page.evaluate("DepTour.resume()")
    # sample the state's box while the tap is pressing it (before the dive starts at 4.5 s)
    # the tap presses at 4.25 s and lets go at 4.61 s (scene time)
    pressed = page.wait_for_function("""() => {
      const s = DepTour.state(), t = s.progress * s.sceneDuration;
      if (t < 4.32 || t > 4.48) return null;
      const r = document.querySelector("path.dt-state[data-abbr='KA']").getBoundingClientRect();
      return [r.left, r.top, r.width];
    }""", polling=40, timeout=15000).json_value()
    assert all(abs(a - b) <= 1.5 for a, b in zip(rest, pressed)), (rest, pressed)


def test_map_numbers_are_labelled_as_sample(page: Page, base_url: str):
    _open_teaser(page, base_url)
    _seek_end(page)
    count = page.evaluate("document.querySelector('.dt-map-count').textContent")
    assert "Sample" in count and "Active" not in count, count
    district = page.evaluate("document.querySelector('.dt-map-district').textContent")
    assert "near you" not in district and "in this district" in district, district


# ---- stage 2: map helpers for the India Map page tour ----

def _open_helper_scene(page: Page, base_url: str, body: str) -> None:
    """Register a one-scene tour whose build(stage, kit) runs `body` (must return a timeline)."""
    open_engine(page, base_url)
    page.add_script_tag(url=f"{base_url}/tour/scenes/map.js")
    page.wait_for_function("() => !!window.DepTourMap", polling=100, timeout=10000)
    page.evaluate("""async (body) => {
      await DepTourMap.load();
      const build = new Function('stage', 'kit', 'M', body);
      DepTour.register('t', { scenes: [{ key: 'h', label: 'L', title: 'Helpers', summary: 'S',
        build(stage, kit) { return build(stage, kit, DepTourMap); } }] });
    }""", body)
    start(page)
    page.wait_for_function("() => DepTour.state().phase === 'scene'", polling=100, timeout=10000)


def test_draw_into_a_box(page: Page, base_url: str):
    _open_helper_scene(page, base_url, """
      const v = M.drawIndia(stage, M.data, kit, { x: 400, y: 40, w: 600, h: 500 });
      return gsap.timeline().add(v.tl).to({}, { duration: 0.5 });""")
    style = page.evaluate("""() => { const s = document.querySelector('.dt-map-view').style;
                                     return [s.left, s.top, s.width, s.height]; }""")
    assert style == ["400px", "40px", "600px", "500px"]


def test_recolour_changes_fills(page: Page, base_url: str):
    _open_helper_scene(page, base_url, """
      const v = M.drawIndia(stage, M.data, kit);
      const heat = {}; M.data.states.forEach(s => { heat[s.abbr] = 1; }); heat.KA = 400; heat.RJ = 300;
      return gsap.timeline().add(v.tl, 0).add(M.recolour(v, heat, kit), 4).to({}, { duration: 0.5 });""")
    fills = "() => [...document.querySelectorAll('path.dt-state')].map(p => getComputedStyle(p).fill)"
    page.evaluate("DepTour.pause(); DepTour.seek(3.9)")
    page.wait_for_timeout(80)
    before = page.evaluate(fills)
    page.evaluate("DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(80)
    after = page.evaluate(fills)
    assert sum(1 for a, b in zip(before, after) if a != b) >= 10


def test_fly_out_restores_the_map(page: Page, base_url: str):
    _open_helper_scene(page, base_url, """
      const v = M.drawIndia(stage, M.data, kit);
      const ka = M.data.focus.districts.find(d => d.name === 'Bengaluru Urban');
      return gsap.timeline().add(v.tl, 0).add(M.diveTo(v, 'KA', kit), 3.5).add(M.raiseDistricts(v, M.data, kit), 5.5)
        .add(M.pin(v, ka.cx, ka.cy, kit), 6.5).add(M.flyOut(v, kit), 8).to({}, { duration: 0.5 });""")
    page.evaluate("DepTour.pause(); DepTour.seek(DepTour.state().sceneDuration - 0.01)")
    page.wait_for_timeout(100)
    assert page.evaluate("document.querySelector('.dt-map-svg').getAttribute('viewBox')") == "0 0 1000 800"
    assert page.evaluate("[...document.querySelectorAll('path.dt-district')].every(p => +getComputedStyle(p).opacity === 0)")
    assert page.evaluate("[...document.querySelectorAll('.dt-pin')].every(p => +getComputedStyle(p).opacity === 0)")
