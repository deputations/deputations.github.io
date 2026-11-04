"""Shared helpers for the site tour Playwright tests (tests/test_tour_*.py).

`open_engine` loads the real tour engine (and the kit, once it exists) onto
index.html without going through the loader's auto-play, so tests can
register small, fully-controlled test tours.
"""
from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page

REPO_ROOT = Path(__file__).resolve().parents[1]

BLOCK_STORAGE = """
  (() => {
    const boom = () => { throw new DOMException('blocked', 'SecurityError'); };
    Storage.prototype.getItem = boom;
    Storage.prototype.setItem = boom;
    Storage.prototype.removeItem = boom;
  })();
"""

# A scene whose build() appends a probe box and returns a 2 s timeline.
PROBE_SCENE_JS = """
  (key, title, opts = {}) => ({
    key, label: 'STEP', title, summary: 'Summary of ' + title,
    build(stage, kit) {
      if (opts.throws) throw new Error('boom in ' + key);
      const el = document.createElement('div');
      el.className = 'probe probe-' + key;
      el.textContent = title;
      stage.appendChild(el);
      return gsap.timeline().to(el, { x: 100, duration: opts.duration || 2, ease: 'none' });
    }
  })
"""


def open_engine(page: Page, base_url: str, path: str = "/index.html") -> None:
    page.goto(f"{base_url}{path}")
    page.wait_for_function("() => !!window.DepTourLoader", timeout=30000)
    page.add_script_tag(url=f"{base_url}/vendor/gsap.min.js")
    page.add_style_tag(url=f"{base_url}/tour/tour.css")
    page.add_script_tag(url=f"{base_url}/tour/tour-engine.js")
    if (REPO_ROOT / "tour" / "tour-kit.js").exists():
        page.add_script_tag(url=f"{base_url}/tour/tour-kit.js")
    page.wait_for_function("() => !!window.DepTour && !!window.gsap", timeout=10000)
    page.evaluate(f"window.__probeScene = {PROBE_SCENE_JS};")


def register_probe_tour(page: Page, key: str = "t", scenes: list[dict] | None = None,
                        intro: str | None = None, cta: str | None = None) -> None:
    """Register a tour of probe scenes. Each scene dict: {key, title, throws?, duration?}."""
    scenes = scenes or [{"key": "a", "title": "Alpha"}, {"key": "b", "title": "Beta"}]
    page.evaluate(
        """([key, scenes, intro, cta]) => {
          const tour = { scenes: scenes.map(s => window.__probeScene(s.key, s.title, s)) };
          if (intro) tour.intro = { headline: intro };
          if (cta) tour.cta = { label: cta, action: () => { window.__ctaRan = true; } };
          DepTour.register(key, tour);
        }""",
        [key, scenes, intro, cta],
    )


def start(page: Page, key: str = "t", **opts) -> None:
    """Start a tour and record its result in window.__res."""
    page.evaluate(
        "([key, opts]) => { window.__res = null; DepTour.play(key, opts).then(r => { window.__res = r; }); }",
        [key, opts],
    )
    page.wait_for_selector(".dt-overlay", state="attached", timeout=10000)


def result(page: Page, timeout: int = 15000) -> str:
    page.wait_for_function("() => window.__res !== null", timeout=timeout)
    return page.evaluate("window.__res")


def seen(page: Page) -> dict:
    return page.evaluate(
        "() => { try { return JSON.parse(localStorage.getItem('dep_tour_seen_v1') || '{}'); }"
        " catch (e) { return {}; } }"
    )
