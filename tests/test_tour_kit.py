"""Site tour kit (tour/tour-kit.js) — Playwright tests.

Each test registers a one-scene tour whose build() uses the kit, then either
pauses and seeks inside the scene or lets it play, and checks the DOM.

Run:
    pytest tests/test_tour_kit.py -v
"""
from __future__ import annotations

from playwright.sync_api import Page, expect

from tests.tour_helpers import no_hero_wave, open_engine, result, start  # noqa: F401

FAST_CPU = ("Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });"
            "Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });")
SLOW_CPU = "Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 4 });"


def _register(page: Page, body: str, key: str = "t") -> None:
    """Register a one-scene tour; `body` is JS run inside build(stage, kit) that
    must return a timeline. A 'hold' tween is appended so the scene lasts."""
    page.evaluate(
        """([key, body]) => {
          const build = new Function('stage', 'kit', body);
          DepTour.register(key, { scenes: [{ key: 's', label: 'L', title: 'T', summary: 'S',
            build(stage, kit) { window.__kit = kit; return build(stage, kit); } }] });
        }""",
        [key, body],
    )


def _seek_end(page: Page) -> None:
    page.evaluate("DepTour.pause(); DepTour.seek(DepTour.state().sceneDuration - 0.01)")


def test_type(page: Page, base_url: str):
    open_engine(page, base_url)
    _register(page, """
      const el = kit.el('div', 'typed', null, stage);
      return gsap.timeline().add(kit.type(el, 'Level 8 posts')).to({}, { duration: 0.5 });
    """)
    start(page)
    page.evaluate("DepTour.pause(); DepTour.seek(0.2)")
    assert page.locator(".typed .dt-caret").count() == 1
    _seek_end(page)
    assert page.evaluate("document.querySelector('.typed').textContent") == "Level 8 posts"
    assert page.locator(".dt-caret").count() == 0


def test_odometer(page: Page, base_url: str):
    open_engine(page, base_url)
    _register(page, """
      const el = kit.el('div', 'odo', null, stage);
      return gsap.timeline().add(kit.odometer(el, 1240, 86), 0).to({}, { duration: 0.5 });
    """)
    start(page)
    page.evaluate("DepTour.pause(); DepTour.seek(0)")
    assert page.evaluate("document.querySelector('.odo').textContent") == "1,240"
    page.evaluate("DepTour.seek(0.8)")
    assert page.locator(".odo .dt-odo-slot").count() >= 2          # digits are rolling
    _seek_end(page)
    assert page.evaluate("document.querySelector('.odo').getAttribute('aria-label')") == "86"
    assert page.evaluate("document.querySelector('.odo').textContent") == "86"


def test_split_title(page: Page, base_url: str):
    open_engine(page, base_url)
    _register(page, """
      const el = kit.el('h3', 'probe-ttl', null, stage);
      el.textContent = 'Just ask';
      window.__chars = kit.splitTitle(el).length;
      return gsap.timeline().to({}, { duration: 1 });
    """)
    start(page)
    expect(page.locator(".probe-ttl .dt-ch")).to_have_count(7)
    assert page.evaluate("window.__chars") == 7
    assert page.evaluate("document.querySelector('.probe-ttl').textContent") == "Just ask"


def test_cursor_to(page: Page, base_url: str):
    page.set_viewport_size({"width": 1440, "height": 900})
    open_engine(page, base_url)
    _register(page, """
      const t = kit.el('div', 'target', null, stage);
      Object.assign(t.style, { position: 'absolute', left: '700px', top: '380px', width: '120px', height: '40px' });
      return gsap.timeline().add(kit.cursorTo(t), 0.2).to({}, { duration: 0.6 });
    """)
    start(page)
    _seek_end(page)
    d = page.evaluate("""() => {
      const c = document.querySelector('.dt-cursor').getBoundingClientRect();
      const t = document.querySelector('.target').getBoundingClientRect();
      return [Math.abs((c.left + c.width / 2) - (t.left + t.width / 2)),
              Math.abs((c.top + c.height / 2) - (t.top + t.height / 2))];
    }""")
    assert d[0] <= 3 and d[1] <= 3, d
    assert page.locator(".dt-cursor").count() == 1
    assert page.locator(".dt-trail").count() == 6


def test_tap_ripple(page: Page, base_url: str):
    open_engine(page, base_url)
    _register(page, """
      const t = kit.el('button', 'target', 'Tap me', stage);
      Object.assign(t.style, { position: 'absolute', left: '400px', top: '300px' });
      return gsap.timeline().add(kit.cursorTo(t, { duration: 0.3 }), 0).add(kit.tap(t), 0.4).to({}, { duration: 3 });
    """)
    start(page)
    page.evaluate("DepTour.pause(); DepTour.seek(0.6)")
    assert page.evaluate("""() => [...document.querySelectorAll('.dt-ripple')]
                             .some(r => parseFloat(getComputedStyle(r).opacity) > 0)""")
    page.evaluate("DepTour.resume()")
    # Cleaned up while the scene is still on screen (not just because the overlay closed).
    page.wait_for_function("() => DepTour.isOpen() && document.querySelectorAll('.dt-ripple').length === 0"
                           " && !document.querySelector('.target').classList.contains('dt-pressed')",
                           polling=100, timeout=10000)


def test_burst_cleanup(page: Page, base_url: str):
    page.add_init_script(FAST_CPU)
    page.set_viewport_size({"width": 1440, "height": 900})
    open_engine(page, base_url)
    _register(page, """
      return gsap.timeline().add(kit.burst(600, 400), 0.1).to({}, { duration: 4 });
    """)
    start(page)
    page.evaluate("DepTour.pause(); DepTour.seek(0.4)")
    assert page.locator(".dt-spark").count() == 28
    page.evaluate("DepTour.resume()")
    page.wait_for_function("() => DepTour.isOpen() && document.querySelectorAll('.dt-spark').length === 0",
                           polling=100, timeout=10000)


def test_burst_halved_on_phone_and_low_power(page: Page, base_url: str):
    page.add_init_script(FAST_CPU)
    page.set_viewport_size({"width": 390, "height": 844})
    open_engine(page, base_url)
    _register(page, "return gsap.timeline().add(kit.burst(200, 400), 0.1).to({}, { duration: 2 });")
    start(page)
    page.evaluate("DepTour.pause(); DepTour.seek(0.4)")
    assert page.locator(".dt-spark").count() == 14
    assert page.evaluate("window.__kit.lowPower") is False


def test_low_power_flag(page: Page, base_url: str):
    page.add_init_script(SLOW_CPU)
    open_engine(page, base_url)
    _register(page, "return gsap.timeline().to({}, { duration: 1 });")
    start(page)
    assert page.evaluate("window.__kit.lowPower") is True


def test_camera_clamp(page: Page, base_url: str):
    open_engine(page, base_url)
    _register(page, "return gsap.timeline().add(kit.camera({ rx: 40, ry: -30, z: 1.2 }, { duration: 0.4 })).to({}, { duration: 0.4 });")
    start(page)
    _seek_end(page)
    rx, ry, sc = page.evaluate("""() => {
      const c = document.querySelector('.dt-camera');
      return [gsap.getProperty(c, 'rotationX'), gsap.getProperty(c, 'rotationY'), gsap.getProperty(c, 'scale')];
    }""")
    assert rx == 12 and ry == -12 and abs(sc - 1.2) < 1e-6


def test_sweep_cleans_up(page: Page, base_url: str):
    open_engine(page, base_url)
    _register(page, """
      const card = kit.el('div', 'card', 'x', stage);
      return gsap.timeline().add(kit.sweep(card), 0.1).to({}, { duration: 3 });
    """)
    start(page)
    page.evaluate("DepTour.pause(); DepTour.seek(0.4)")
    assert page.locator(".card .dt-sweep").count() == 1
    page.evaluate("DepTour.resume()")
    page.wait_for_function("() => DepTour.isOpen() && !document.querySelector('.card .dt-sweep')",
                           polling=100, timeout=10000)


def test_sample_rules(page: Page, base_url: str):
    open_engine(page, base_url)
    out = page.evaluate("""() => {
      const ctx = { layout: 'wide', lowPower: false };
      const a = DepTourKit.create(ctx).sample, b = DepTourKit.create(ctx).sample;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric',
                                                        month: '2-digit', day: '2-digit' }).format(new Date());
      const month = today.slice(0, 7);
      const v = a.vacancies;
      // the site's rule (enrich.js isEligible): the officer's level must be one of the post's
      // feeder grades, with at least that grade's minimum years
      const site = (x, lvl, yrs) => x.openTo.some(t => t.level === lvl && yrs >= t.years);
      const eligible = v.filter(x => site(x, 7, 4));
      return {
        n: v.length,
        eligible: eligible.length,
        kitAgrees: v.every(x => a.isEligible(x, 7, 4) === site(x, 7, 4)),
        higher: eligible.filter(x => x.payLevel >= 8).length,
        tiers: v.every(x => Array.isArray(x.openTo) && x.openTo.length > 0 &&
                            x.openTo.every(t => Number.isInteger(t.level) && Number.isInteger(t.years) && t.level <= x.payLevel)),
        delhi8: v.filter(x => x.location === 'Delhi' && x.payLevel === 8 && x.closes.slice(0, 7) === month && x.closes >= today).length,
        allFuture: v.every(x => x.closes >= today),
        same: JSON.stringify(a.vacancies.map(x => x.id)) === JSON.stringify(b.vacancies.map(x => x.id)),
        fields: v.every(x => x.id && x.title && x.ministry && x.org && x.location && x.state && x.closes),
        meta: [a.total, a.eligibleCount, a.query],
        heatStates: Object.keys(a.heat).length,
      };
    }""")
    assert out["n"] == 120
    assert out["eligible"] == 8
    assert out["kitAgrees"] is True
    assert out["higher"] >= 5                  # deputation mostly opens higher posts
    assert out["tiers"] is True
    assert out["delhi8"] >= 3
    assert out["allFuture"] is True
    assert out["same"] is True
    assert out["fields"] is True
    assert out["meta"] == [1240, 86, "Level 8 posts in Delhi closing this month"]
    assert out["heatStates"] == 36


def test_low_power_from_device_memory(page: Page, base_url: str):
    page.add_init_script("Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });"
                         "Object.defineProperty(navigator, 'deviceMemory', { get: () => 4 });")
    open_engine(page, base_url)
    _register(page, "return gsap.timeline().to({}, { duration: 1 });")
    start(page)
    assert page.evaluate("window.__kit.lowPower") is True
