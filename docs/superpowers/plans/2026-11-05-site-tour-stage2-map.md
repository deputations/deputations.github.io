# Site Tour — Stage 2 (India Map page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A ~45 s first-visit tour on `india-map.html` showing every map feature (spec §3.2, revised 2026-11-05).

**Architecture:** Reuses the stage-1 engine, kit and loader unchanged. `tour/scenes/map.js` gains map helpers (drawing into a box, recolouring, flying back out); a new `tour/scenes/map-page.js` holds the five steps and registers the `map` tour. `india-map.html` gets the loader tag.

**Tech Stack:** as stage 1.

**Spec:** `docs/superpowers/specs/2026-11-04-site-tour-design.md` §3.2

## Global Constraints

- All stage-1 / Home v2 constraints hold (sample data labelled; feeder-grade wording; inert page; Back closes; steps view for reduced motion and small screens).
- Tour key `map`; loader tag `<script defer src="/tour/tour-loader.js?v=1" data-tour="map">` before `</body>` of `india-map.html`, in a `<!-- BEGIN site-tour -->` block.
- Loader asset order for `map`: gsap, tour.css, tour-engine.js, tour-kit.js, `scenes/map.js`, `scenes/map-page.js`.
- Intro headline exactly `Vacancies across India, on one map` (no brand).
- Step titles exactly, in order: `Every state at a glance`, `Filter the whole map`, `Dive into a state`, `Posts in every district`, `Zoom, list and go back`.
- CTA exactly `Explore the map` (standard finale: closes the tour onto the real map).
- Real-page wording mirrored: `Back to India`, `View all 96 vacancies in Karnataka`.

## Review Focus

1. A shared map link (`india-map.html?state=KA`) does not auto-play (test `test_map_deep_link_skips_autoplay`).
2. Phone (390 px): the filters panel, tooltip, posts list and buttons stay inside the stage (test `test_map_tour_fits_on_phone`).
3. Flying back to India restores the whole map: viewBox `0 0 1000 800`, districts hidden (test `test_back_to_india_restores_the_map`).
4. Filters visibly recolour states (at least 10 states change fill) (test `test_filters_recolour_the_map`).
5. The Home tour is unaffected by the map.js changes (whole tour suite stays green).

---

### Task 1: Map helpers

**Files:** Modify `tour/scenes/map.js`; Test `tests/test_tour_map_scene.py`.

**Interfaces:**
- `drawIndia(parent, data, kit, box?)` — optional `box = {x, y, w, h}` in scene units (default: the current full-stage margins, so the teaser is unchanged).
- `recolour(view, heat: Record<abbr, number>, kit) → Timeline` — tweens every state's fill/fill-opacity to the colours `heat` gives (same ramp as `drawIndia`).
- `flyOut(view, kit) → Timeline` — viewBox back to `data.viewBox`, districts fade out (opacity 0), states' fill/stroke opacities restored, pins removed at the end, plane tilt back to 28°.

- [ ] Failing tests `test_draw_into_a_box`, `test_recolour_changes_fills`, `test_fly_out_restores_the_map` → implement → GREEN (whole `test_tour_map_scene.py` green) → commit `feat(tour): map helpers for the map page tour`.

### Task 2: Map page tour (`map-page.js`) and wiring

**Files:** Create `tour/scenes/map-page.js`; Modify `tour/tour-loader.js` (SCENES.map), `india-map.html`; Test create `tests/test_tour_map_page.py`.

**Interfaces:** registers `map` with `intro {headline}`, the five scenes, `cta {label: 'Explore the map'}` after `DepTourMap.load()` (on failure: warn, register nothing — the map tour needs the map). DOM end states per step:
1. `.dt-maptip` visible with `Maharashtra` and `sample posts`; `.dt-mcount` `aria-label` `1240`.
2. `.dt-mfilter` rows show `Level 8` and `Finance`; `.dt-mcount` `aria-label` `96`.
3. 31 `path.dt-district`; `.dt-mback` visible with text `Back to India`; `.dt-mstate` text contains `Karnataka`.
4. one `.dt-pin`; 3 `.dt-mpost`; `.dt-mdetail .dt-heart.is-saved`.
5. `.dt-mlist` was shown (contains `View all 96 vacancies in Karnataka` on `.dt-mlistbtn`); at end the svg viewBox is `0 0 1000 800` and every `path.dt-district` has computed opacity 0.

- [ ] Failing tests: `test_map_tour_titles_in_order`, `test_hover_tooltip`, `test_filters_recolour_the_map`, `test_dive_into_karnataka`, `test_posts_in_bengaluru`, `test_back_to_india_restores_the_map`, `test_map_tour_fits_on_phone`, `test_map_page_loads_in_order`, `test_map_deep_link_skips_autoplay`, `test_map_cta_closes_onto_the_map` → implement → GREEN → commit `feat(tour): India Map page tour`.

### Task 3: Visual pass, regression, docs, previews, PR

- [ ] Screenshot each step at 1440×900 and 390×844; fix what looks wrong (testable fixes get tests).
- [ ] Whole tour suite green; full suite vs baseline.
- [ ] CHANGELOG `[Unreleased]` entry; HANDOVER block; TECHNICAL.md unchanged unless a key/URL is added.
- [ ] Record desktop + phone previews; send to the owner.
- [ ] Final independent review of `feature/site-tour..feature/site-tour-map`; fix Critical/Important with tests.
- [ ] Open a **draft** PR `feature/site-tour-map` → base `feature/site-tour` (stacked on PR #35).
