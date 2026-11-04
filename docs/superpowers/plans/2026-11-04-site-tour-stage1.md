# Site Tour — Stage 1 (engine + Home intro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the shared tour engine and the cinematic ~40 s Home intro (PR 1 of the spec), auto-playing once on a visitor's first visit to `index.html`.

**Architecture:** A tiny always-loaded loader decides whether to play and lazy-loads GSAP, the engine, the kit and the page's scene files. The engine owns the overlay, chrome, master timeline, layout and closing; the kit is the toolbox scenes call (cursor, tap, type, odometer, camera, burst); each scene is a `build(stage, kit) → gsap.timeline()` factory. Map geometry is pre-baked by a Python script into a small JSON file.

**Tech Stack:** vanilla JS (no build step), GSAP 3.15.1 core vendored, CSS, Python 3 for the map builder, pytest + Playwright (existing smoke-suite conventions).

**Spec:** `docs/superpowers/specs/2026-11-04-site-tour-design.md`

**Refinements to the spec made by this plan** (update the spec's §4 file list in Task 4's commit):
- The kit lives in its own file `tour/tour-kit.js` (loaded after the engine) instead of inside `tour-engine.js`, to keep the engine focused.
- Tests are split into `tests/test_tour_map.py`, `test_tour_loader.py`, `test_tour_engine.py`, `test_tour_kit.py`, `test_tour_home.py` instead of one `test_tour.py`.
- Scene-to-scene transition is an engine-level "fly-through" (outgoing camera scale 1→1.15, opacity 1→0, blur 0→8px; incoming scale 0.9→1, blur 8→0; 0.6 s each, overlapping 0.3 s).
- District geometry is stored in the national projection (same coordinate space as states) so the camera can dive into the state without a cut; `focus.viewBox` is the state's bounding box in those coordinates.

**This workspace:** run tests with `export TEST_CHROMIUM_PATH=/usr/bin/google-chrome` set.

## Global Constraints

- Vanilla HTML/CSS/JS only; no bundler, no framework, no CDN — every tour asset is same-origin.
- GSAP core only, version 3.15.1, vendored at `vendor/gsap.min.js` (license header kept).
- Page keys: `home`, `map`, `mydep`, `defex`, `report`. Stage 1 wires only `home`.
- Storage keys: `dep_tour_seen_v1` = JSON object `{ <pageKey>: 1 }`; `dep_tour_off_v1` = `"1"`. Every storage access is wrapped in try/catch.
- URL params: `?tour=play` forces play (bypasses seen/off/webdriver/reduced-motion); `&tourSpeed=N` sets master timeScale.
- Auto-play only if: key not seen, off flag unset, `navigator.webdriver === false`, not `prefers-reduced-motion: reduce`.
- Start auto-play after `window` `load` + one `requestIdleCallback` (fallback timeout 800 ms).
- Overlay always uses the dark cinematic look in both themes; colours `#22d3ee`, `#a78bfa`, `#02040b`; fonts `Unbounded`, `Sora`, `"Plus Jakarta Sans"` each with `system-ui, sans-serif` fallback (tests block Google Fonts — nothing may wait on them).
- Animate only `transform`, `opacity`, `filter`.
- Layout: `wide` canvas 1100×620; `tall` canvas 390×720 when `innerWidth < 700`; canvas scaled to fit the viewport below the chrome.
- Demo badge text exactly `Demo · sample data`.
- Console warnings use prefix `[tour]`; the tour never throws into the page.
- DOM class prefix `dt-`. Overlay `z-index: 20000` (above `.sw-modal` 10001). Replay button `z-index: 69` (below site widgets' 70), bottom-right 16 px.
- New asset URLs start at `?v=1`.
- `tour/tour-map.json` < 80 000 bytes.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01E8hh2qRCXXVGRXzSdbSPXH`

## Review Focus

1. Visitor skips mid-scene → page scroll and focus fully restored, no stray `.dt-*` nodes left (Task 3 `test_close_restores_page`).
2. Phone rotates / window resizes mid-scene → exactly one overlay, layout switches, scene restarts cleanly (Task 3 `test_resize_switches_layout`).
3. Storage blocked (private mode, enterprise policy) → tour plays and closes without throwing (Task 2 `test_storage_blocked_is_safe`, Task 3 `test_play_with_storage_blocked`).
4. A tour asset fails to load on a slow government network → no overlay, no error, page unaffected (Task 2 `test_asset_failure_leaves_page_untouched`).
5. Replay pressed while a tour is already open → still one overlay, same promise (Task 3 `test_double_play_single_overlay`).

---

### Task 1: Map geometry builder

**Files:**
- Create: `scripts/build_tour_map.py`
- Create: `tour/tour-map.json` (generated, committed)
- Test: `tests/test_tour_map.py`

**Interfaces:**
- Produces: `build(states_path: Path, districts_path: Path, focus_state: str = 'Karnataka') -> dict` and CLI `python scripts/build_tour_map.py` writing `tour/tour-map.json` with shape
  `{ "viewBox": "0 0 1000 800", "states": [{ "abbr", "name", "d", "cx", "cy" }], "focus": { "state": "Karnataka", "abbr": "KA", "viewBox": "x y w h", "districts": [{ "name": str|None, "d", "cx", "cy" }] } }`.

- [ ] **Step 1: Record the baseline suite** — run `python -m pytest tests/ -q -n 4 2>&1 | tail -5` and note pre-existing failures in the task notes, so later regressions are judged against it.
- [ ] **Step 2: Write the failing tests** in `tests/test_tour_map.py`:
  - `test_states_complete`: `len(out['states']) == 36`; every state has non-empty `abbr`, `name`, `d.startswith('M')`.
  - `test_projection_matches_site`: bounding box of all state path points is centred: `abs((minx+maxx)/2 - 500) < 1` and `abs((miny+maxy)/2 - 400) < 1`, and `maxx - minx` or `maxy - miny` equals the fitted span `min(1000/lonRange, 800/latRange) * 0.97 * range` within 1 unit.
  - `test_focus_districts`: `focus['state'] == 'Karnataka'`, `focus['abbr'] == 'KA'`, `len(focus['districts']) == 31`, exactly one district has `name is None`, one is `'Bengaluru Urban'`, every district centroid lies inside `focus['viewBox']`.
  - `test_file_size`: `tour/tour-map.json` exists and `stat().st_size < 80_000`.
- [ ] **Step 3: Run** `python -m pytest tests/test_tour_map.py -v` → FAIL (module not found).
- [ ] **Step 4: Implement `build()`** — same linear projection as `india-map-view.js` `computeProjection` with `fill = 0.97` (its `NATIONAL_FILL`), fitted to all features of `geo/india-states.geojson`; drop rings whose lon or lat extent ≤ 0.005 (the site's `hasRealExtent`); simplify each projected ring with Douglas–Peucker (states tolerance 0.8, districts 0.12 units); round coordinates to 1 decimal (states) and 2 decimals (districts); path `d` as `M x,y L ...` per ring; `cx, cy` = area-weighted centroid of the largest ring; `abbr` from the state file's `abbr` property; focus districts are features with `st_nm == focus_state`, `name` from `district` (None if absent); `focus.viewBox` = padded (4 %) bbox of the state path. CLI writes compact JSON (`separators=(',', ':')`).
- [ ] **Step 5: Generate and run** `python scripts/build_tour_map.py && python -m pytest tests/test_tour_map.py -v` → 4 PASS. If over 80 KB, raise the state tolerance in 0.2 steps.
- [ ] **Step 6: Commit** `feat(tour): pre-baked map geometry for tour scenes`.

---

### Task 2: Loader, replay button, vendored GSAP, Home wiring

**Files:**
- Create: `tour/tour-loader.js`
- Create: `vendor/gsap.min.js` (from `npm pack gsap@3.15.1` → `package/dist/gsap.min.js`)
- Modify: `index.html` — add before `</body>` after the hero-wave block: `<!-- BEGIN site-tour -->` `<script defer src="/tour/tour-loader.js?v=1" data-tour="home"></script>` `<!-- END site-tour -->`
- Test: `tests/test_tour_loader.py`

**Interfaces:**
- Produces `window.DepTourLoader`:
  - `shouldAutoplay(env: {seen: object, off: boolean, webdriver: boolean, reducedMotion: boolean, force: boolean}, key: string) → boolean`
  - `readSeen() → object` (`{}` on missing/corrupt/blocked storage), `markSeen(key: string) → void`, `setOff() → void`, `isOff() → boolean`
  - `play(key: string, opts?: {speed?: number, mode?: 'auto'|'cinematic'|'steps'}) → Promise<string>` — loads assets once (cached promise), then returns `DepTour.play(key, opts)`; resolves `'unavailable'` on any load failure.
  - Asset order: `/vendor/gsap.min.js?v=1`, `/tour/tour.css?v=1` (link, resolved on load), `/tour/tour-engine.js?v=1`, `/tour/tour-kit.js?v=1`, then per key — `home`: `/tour/scenes/map.js?v=1`, `/tour/scenes/home.js?v=1`.
- Produces DOM: `button.dt-replay` text `▶ How this works`, `aria-label="Play the how-to demo for this page"`; gets class `dt-replay--hidden` while `.sw-footer` intersects the viewport; click → `play(key, {mode: 'auto'})`.

- [ ] **Step 1: Write the failing tests** in `tests/test_tour_loader.py`:
  - `test_no_autoplay_under_webdriver`: goto `/index.html`, wait 2.5 s; `.dt-overlay` count 0 and no request URL contains `/vendor/gsap.min.js`.
  - `test_replay_button`: `.dt-replay` visible, text contains `How this works`, has the aria-label above.
  - `test_should_autoplay_rules`: evaluate the six cases — clean env → true; seen `{home:1}` → false; off → false; webdriver → false; reducedMotion → false; any of those with `force: true` → true.
  - `test_force_play_loads_in_order`: stub routes — `tour-engine.js` → `window.DepTour={play:(k,o)=>{window.__played=[k,o.speed];return Promise.resolve('end')}}`, other tour files → empty 200; goto `/index.html?tour=play&tourSpeed=20`; requested tour paths (query stripped) equal the six-path order above; `window.__played == ['home', 20]`.
  - `test_asset_failure_leaves_page_untouched`: route `**/vendor/gsap.min.js` → abort; goto `?tour=play`; no `pageerror`, `.dt-overlay` count 0, `#filterMyPayLevelBtn` is clickable.
  - `test_storage_blocked_is_safe`: init script making `Storage.prototype.getItem`/`setItem` throw; `readSeen()` returns `{}`, `markSeen('home')` and `setOff()` do not throw.
  - `test_mark_seen_and_off`: after `markSeen('home'); markSeen('map')` → `JSON.parse(localStorage.dep_tour_seen_v1)` equals `{home:1, map:1}`; `setOff()` → `localStorage.dep_tour_off_v1 == '1'`.
  - `test_replay_hides_over_footer`: scroll to bottom → `.dt-replay` has `dt-replay--hidden`.
- [ ] **Step 2: Run** `python -m pytest tests/test_tour_loader.py -v` → FAIL.
- [ ] **Step 3: Vendor GSAP** — `npm pack gsap@3.15.1`, extract, copy `dist/gsap.min.js` to `vendor/gsap.min.js`; confirm the file's first line keeps the GSAP license comment.
- [ ] **Step 4: Implement `tour/tour-loader.js`** — IIFE; reads its key from `document.currentScript.dataset.tour`; scripts appended sequentially with `async = false`; `?tour=play` triggers `play(key, {speed, mode:'cinematic'})` after the start delay; auto-play path uses `mode: 'auto'`. Replay button styles injected inline (small glass pill) so the loader needs no CSS file.
- [ ] **Step 5: Wire `index.html`** as above.
- [ ] **Step 6: Run** `python -m pytest tests/test_tour_loader.py tests/test_index.py -v` → all PASS.
- [ ] **Step 7: Commit** `feat(tour): loader, replay button and vendored GSAP`.

---

### Task 3: Engine core and overlay

**Files:**
- Create: `tour/tour-engine.js`, `tour/tour.css`
- Test: `tests/test_tour_engine.py` (helper `open_engine(page, base_url)`: goto `/index.html`, then `page.add_script_tag` for gsap, `add_style_tag(url=/tour/tour.css)`, engine, kit if present; registers test tours via `page.evaluate`)

**Interfaces:**
- Consumes: `DepTourLoader.markSeen/setOff` (fall back to direct try/catch storage if the loader is absent).
- Produces `window.DepTour`:
  - `register(key: string, tour: { intro?: {headline: string}, scenes: Scene[], cta?: {label: string, action: () => void} }) → void`
  - `Scene = { key: string, label: string, title: string, summary: string, build(stage: HTMLElement, kit: Kit) → gsap.core.Timeline }`
  - `play(key, {speed = 1, mode = 'auto'}) → Promise<'end'|'skip'|'cta'|'error'>` (`'auto'` → `'steps'` under reduced motion, else `'cinematic'`); a second call while open returns the same promise.
  - `close(reason)`, `isOpen() → boolean`, `pause()`, `resume()`, `goTo(index: number)`, `seek(seconds: number)` (within the current scene), `state() → { open, key, mode, sceneIndex, sceneDuration, progress, layout: 'wide'|'tall' }`.
  - `DepTour.kitFactory` hook: the engine calls `window.DepTourKit.create(ctx)` if present, else a minimal stub; `ctx = { overlay, stage, camera, cursorLayer, layout, scale, lowPower }`.
- DOM: `.dt-overlay[role=dialog][aria-modal=true][aria-labelledby=dt-title]` > `.dt-backdrop`, `.dt-aurora`, `.dt-stage.dt-wide|.dt-tall` > `.dt-canvas` > `.dt-camera`; `.dt-chrome` with `.dt-label`, `#dt-title.dt-title`, `.dt-dots > button` (one per scene), `.dt-progress > i`, `button.dt-skip` (`Skip →`), `button.dt-off` (`Don't show tours again`), `.dt-badge`; steps mode uses `.dt-steps` with `h3`, `p`, `button.dt-back`, `button.dt-next`.

- [ ] **Step 1: Write the failing tests** (test tour `t`: two scenes, each `build` returns a 2 s timeline animating a `.probe` box; titles `Alpha`, `Beta`):
  - `test_overlay_and_chrome`: after `play('t')` → one `.dt-overlay` with the ARIA attributes, `#dt-title` text `Alpha`, 2 dots, `.dt-badge` text `Demo · sample data`, `.dt-skip`, `.dt-off`.
  - `test_runs_to_end`: `play('t', {speed: 10})` resolves `'end'`; overlay removed; seen object contains `t: 1`.
  - `test_skip_button_and_esc`: Skip → `'skip'`; new play + `Escape` → `'skip'`; seen written both times.
  - `test_off_button`: click `.dt-off` → resolves `'skip'`, `localStorage.dep_tour_off_v1 == '1'`.
  - `test_close_restores_page`: record `documentElement.style.overflow` and focus a known button, play, skip → overflow restored to recorded value, `activeElement` is that button, `document.querySelectorAll('[class^="dt-"]:not(.dt-replay)').length == 0`.
  - `test_double_play_single_overlay`: two `play('t')` calls → one `.dt-overlay`, both promises resolve the same value.
  - `test_keyboard_and_dots`: `ArrowRight` → `state().sceneIndex == 1` and title `Beta`; clicking dot 1 → index 0; `Space` → paused (progress unchanged over 500 ms).
  - `test_scene_errors_are_skipped`: scene 1 build throws → title `Beta` shown and a `[tour]` warning logged; tour where both throw → resolves `'error'`, overlay removed, no `pageerror`.
  - `test_resize_switches_layout`: viewport 1440×900, play, `set_viewport_size(390, 844)`, wait 400 ms → one overlay, `.dt-stage.dt-tall`, `state().layout == 'tall'`, `sceneIndex` unchanged.
  - `test_tall_layout_at_390`: start at 390×844 → `.dt-tall`.
  - `test_steps_mode_reduced_motion`: `page.emulate_media(reduced_motion='reduce')`, `play('t')` (auto) → `state().mode == 'steps'`, `.dt-steps h3` `Alpha`, `p` shows the summary, Next → `Beta`, last Next closes with `'end'`.
  - `test_play_with_storage_blocked`: throwing-storage init script → play then skip resolves `'skip'`, no `pageerror`.
  - `test_intro_headline`: tour with `intro.headline: 'Hello tour'` → `.dt-headline .dt-ch` count == 9 (spaces not wrapped) during the intro.
- [ ] **Step 2: Run** `python -m pytest tests/test_tour_engine.py -v` → FAIL.
- [ ] **Step 3: Implement the engine** — master flow: intro (if any: aurora bloom 1.2 s, headline letters blur 12px→0 / opacity 0→1 / letter-spacing 0.3em→0.02em, stagger 0.035 s, hold 1 s, fly-through out), then scenes, then finale (CTA button `.dt-cta` + `kit.burst` at its centre, hold 6 s, then close `'end'`; no CTA → close `'end'` after last scene). Build each scene lazily on entry inside try/catch. Progress bar width = elapsed / total of scene durations. `speed` → `gsap` timeline `timeScale`. Scroll lock via `documentElement.style.overflow = 'hidden'`. Focus trap over the chrome's buttons. Resize listener debounced 200 ms: re-fit scale; rebuild current scene from 0 if layout changed. On close: kill timelines, remove listeners and DOM, restore overflow/focus, mark seen (unless the off button was used, which also marks seen).
- [ ] **Step 4: Implement `tour/tour.css`** — overlay layers, glass chrome (backdrop-filter blur 18px, `rgba(15,23,42,.6)` surfaces, 1px `rgba(165,243,252,.18)` borders), aurora (two blurred radial gradients cyan/violet), Unbounded headline, focus rings `2px solid #22d3ee`, `.dt-tall` chrome stacking for phones, `@media (prefers-reduced-motion: reduce)` disables aurora drift.
- [ ] **Step 5: Run** `python -m pytest tests/test_tour_engine.py -v` → all PASS.
- [ ] **Step 6: Commit** `feat(tour): engine core, overlay chrome and layouts`.

---

### Task 4: Kit — cursor, tap, type, odometer, camera, effects, sample data

**Files:**
- Create: `tour/tour-kit.js`
- Modify: `docs/superpowers/specs/2026-11-04-site-tour-design.md` §4 file list (add `tour/tour-kit.js`, split test files)
- Test: `tests/test_tour_kit.py` (reuses `open_engine` from Task 3, imported from `tests/test_tour_engine.py` or moved to `tests/tour_helpers.py`)

**Interfaces:**
- Consumes: engine `ctx` (Task 3).
- Produces `window.DepTourKit.create(ctx) → Kit` where `Kit`:
  - `layout: 'wide'|'tall'`, `lowPower: boolean` (`navigator.hardwareConcurrency <= 4`)
  - `el(tag, className?, html?, parent?) → HTMLElement`
  - `cursorTo(target: Element|{x,y}, {duration = 0.8, ease = 'power3.inOut'}) → Timeline` — cursor `.dt-cursor` is screen-space in the overlay; target centre resolved lazily at tween start (function-based values); light trail of 6 `.dt-trail` dots.
  - `tap(target) → Timeline` — cursor scale 1→0.82→1, `.dt-ripple` ring (scale 0→2.4, opacity .9→0, 0.5 s) and 8-particle spark at target centre; adds then removes class `dt-pressed` on target.
  - `type(el, text, {cps = 24}) → Timeline` — reveals characters; `.dt-caret` blinks while typing and is removed at the end.
  - `odometer(el, from: number, to: number, {duration = 1.6}) → Timeline` — rolling digit columns formatted `en-IN`; sets `aria-label` to the final number as `String(to)` and leaves visible text equal to `to.toLocaleString('en-IN')`.
  - `splitTitle(el) → HTMLElement[]` — wraps each non-space character in `span.dt-ch`.
  - `camera(pose: {x?, y?, z?, rx?, ry?}, {duration = 1.2, ease = 'power2.inOut'}) → Tween` on `.dt-camera` (`z` is scale; `rx`/`ry` clamped to ±12°).
  - `burst(x, y, {count = 28}) → Timeline` — `.dt-spark` particles, all removed on complete; count halved when `lowPower` or `tall`.
  - `sweep(el) → Timeline` — one diagonal light sweep across `el`.
  - `sample: { total: 1240, eligibleCount: 86, query: 'Level 8 posts in Delhi closing this month', vacancies: Vacancy[], heat: Record<abbr, number> }`, `Vacancy = { id, title, ministry, org, location, state, payLevel: number, minYears: number, closes: 'YYYY-MM-DD' }` — 120 generated records from fixed ministry/post lists (Ministry of Finance, Home Affairs, Railways, Education, Health and Family Welfare, External Affairs, Defence, Road Transport and Highways; posts Section Officer, Assistant Section Officer, Accounts Officer, Senior Accountant, Deputy Director, Under Secretary, Assistant Director (OL)); exactly 8 records satisfy `payLevel === 7 && minYears <= 4`; at least 3 records have `location === 'Delhi'`, `payLevel === 8` and `closes` within the current month and ≥ today (Asia/Kolkata date); all `closes` ≥ today. Deterministic (seeded) so tests are stable.
  - Depends on: the engine supplying `ctx`.

- [ ] **Step 1: Write the failing tests** — each registers a one-scene tour whose `build` uses the kit, then `pause()` + `seek(sceneDuration - 0.01)`:
  - `test_type`: element text equals `'Level 8 posts'`, no `.dt-caret` left after the scene's end.
  - `test_odometer`: from 1240 to 86 → `aria-label == '86'`, visible text `86`; at seek 0 visible text `1,240`.
  - `test_split_title`: `'Just ask'` → 7 `.dt-ch`.
  - `test_cursor_to`: cursor centre within 3 px of target's `getBoundingClientRect()` centre at end.
  - `test_tap_ripple`: during the tap a `.dt-ripple` exists; after the scene none remain and target lacks `dt-pressed`.
  - `test_burst_cleanup`: mid-burst `.dt-spark` count == 28 at 1440×900 and 14 at 390×844; zero after.
  - `test_camera_clamp`: `camera({rx: 40})` → computed transform rotateX ≤ 12°.
  - `test_sample_rules`: evaluate `DepTourKit.create(...).sample` checks — 120 vacancies, eligible count 8, ≥3 Delhi Level-8 closing this month, all closes ≥ today, two calls produce identical ids.
- [ ] **Step 2: Run** `python -m pytest tests/test_tour_kit.py -v` → FAIL.
- [ ] **Step 3: Implement `tour/tour-kit.js`** per the interface; the seeded generator is a small mulberry32 PRNG with a fixed seed; dates computed from today in Asia/Kolkata via `Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata'})`.
- [ ] **Step 4: Run** `python -m pytest tests/test_tour_kit.py tests/test_tour_engine.py -v` → all PASS.
- [ ] **Step 5: Update the spec's §4 file list** for the refinements listed at the top of this plan.
- [ ] **Step 6: Commit** `feat(tour): animation kit and sample data`.

---

### Task 5: Map helpers and the map teaser scene

**Files:**
- Create: `tour/scenes/map.js`
- Test: `tests/test_tour_map_scene.py`

**Interfaces:**
- Consumes: `tour/tour-map.json` (Task 1), `Kit` (Task 4).
- Produces `window.DepTourMap`:
  - `load() → Promise<MapData>` (fetch `/tour/tour-map.json?v=1`, cached)
  - `drawIndia(parent: Element, data: MapData, kit: Kit) → { svg: SVGSVGElement, states: Map<string, SVGPathElement>, tl: Timeline }` — `path.dt-state[data-abbr]`; draw-in via stroke-dasharray/dashoffset (staggered 0.02 s), then fill fades to a heat colour from `kit.sample.heat` (cyan→violet ramp) with a soft glow; map plane tilts to `rotateX(28deg)` "hologram table".
  - `diveTo(view, abbr: string, kit: Kit) → Timeline` — camera centres the state's bbox and scales so it fills ~70 % of the canvas.
  - `raiseDistricts(view, data: MapData, kit: Kit) → Timeline` — `path.dt-district[data-name]` fade/rise in, stagger 0.03 s.
  - `pin(view, x: number, y: number, kit: Kit) → Timeline` — `.dt-pin` drop with `.dt-beam` light beam.
  - `teaserScene: Scene` — `{ key: 'mapTeaser', label: 'STEP 3', title: "See India's vacancies on a map", summary: 'Open the India Map to see vacancies state by state and district by district.' }`; beats: draw India, tilt, glow, dive to `KA`, raise districts, pin at `Bengaluru Urban` centroid. `build` must return a timeline synchronously: `DepTourMap.load()` is awaited by `home.js` before `register`, so data is ready.

- [ ] **Step 1: Write the failing tests** (register a tour with only `teaserScene`, after `await DepTourMap.load()`):
  - `test_draws_36_states`: 36 `path.dt-state`.
  - `test_dive_centres_karnataka`: at the dive's end the `KA` path's screen bbox centre is within 40 px of the canvas centre.
  - `test_districts_and_pin`: at scene end 31 `path.dt-district`, one `.dt-pin`, a district with `data-name="Bengaluru Urban"`.
  - `test_teaser_meta`: `#dt-title` text `See India's vacancies on a map`.
- [ ] **Step 2: Run** `python -m pytest tests/test_tour_map_scene.py -v` → FAIL.
- [ ] **Step 3: Implement `tour/scenes/map.js`** per the interface.
- [ ] **Step 4: Run** the test file → all PASS.
- [ ] **Step 5: Commit** `feat(tour): India map helpers and teaser scene`.

---

### Task 6: Home scenes and registration

**Files:**
- Create: `tour/scenes/home.js`
- Test: `tests/test_tour_home.py`

**Interfaces:**
- Consumes: `DepTour.register` (Task 3), `Kit` (Task 4), `DepTourMap.load/teaserScene` (Task 5).
- Produces: registration `DepTour.register('home', { intro: { headline: 'Every Central deputation vacancy. One place.' }, scenes: [eligibility, ask, DepTourMap.teaserScene], cta: { label: 'Try it with your pay level', action: openPayLevel } })` after `await DepTourMap.load()`; the loader's `play('home')` must wait for this registration (engine `play` waits up to 3 s for a pending key registered via `DepTour.expect('home')`, called synchronously at the top of `home.js`).
  - `eligibility` — `{ label: 'STEP 1', title: 'Only the posts you can apply for', summary: 'Set your pay level and years of experience to see only the posts you can apply for.' }`. Beats: wall of `.dt-vcard` (120 wide, 72 lowPower, 48 tall) in a tilted 3D grid with counter `.dt-count` at 1,240; cursor opens a mock "Display deputations for me" control, picks `Level 7`, types `4` in years; ineligible cards flip (rotateY 90) and fall into depth with blur; survivors `.dt-vcard.is-eligible` (8 wide/lowPower, 5 tall) fly into a list with `kit.sweep`; `kit.odometer(1240 → 86)`.
  - `ask` — `{ label: 'STEP 2', title: 'Just ask', summary: 'Type what you want in plain words — AI turns it into filters and ranks the matches.' }`. Beats: glass search box `.dt-ask` with ✨ AI-powered hint; `kit.type(sample.query)`; the phrases `Level 8`, `Delhi`, `this month` glow, split into particles and land as chips `.dt-chip` with text `Level 8`, `Delhi`, `Closes ≤ 30 days`; `AI-ranked matches` shimmer; three `.dt-match` cards (from the Delhi Level-8 records) slide in with `.dt-ring` score rings filling to 96 %, 91 %, 87 %.
  - `openPayLevel()` — `document.getElementById('filterMyPayLevelBtn')` → `scrollIntoView({block: 'center'})` then `.click()` after the overlay has closed.

- [ ] **Step 1: Write the failing tests** (goto `/index.html?tour=play&tourSpeed=1`, wait for `DepTour.isOpen()`, then drive with `pause/goTo/seek`):
  - `test_scene_order`: titles after `goTo(0..2)` are the three titles above in order; intro headline text equals the intro string.
  - `test_eligibility_end_state`: at scene 0 end → `.dt-count` `aria-label == '86'`, 8 `.dt-vcard.is-eligible`; at 390×844 → 48 cards initially, 5 eligible.
  - `test_low_power_wall`: init script `Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 4})` → 72 cards.
  - `test_ask_end_state`: typed text equals `Level 8 posts in Delhi closing this month`; chip texts in order `['Level 8', 'Delhi', 'Closes ≤ 30 days']`; 3 `.dt-match`.
  - `test_cta_opens_pay_level`: at finale click `.dt-cta` text `Try it with your pay level` → promise resolves `'cta'`, overlay gone, `#filterMyPayLevelPanel` not hidden, seen has `home: 1`.
  - `test_full_run_fast`: fresh page `?tour=play&tourSpeed=20` → resolves `'end'` within 15 s; no `pageerror`; no console `error` whose text or location includes `/tour/`.
  - `test_plays_once_then_not_again`: context with webdriver override `navigator.webdriver = false` via init script → first goto auto-plays (overlay appears within 5 s), skip; reload → no overlay after 3 s.
- [ ] **Step 2: Run** `python -m pytest tests/test_tour_home.py -v` → FAIL.
- [ ] **Step 3: Implement `tour/scenes/home.js`** and add `DepTour.expect(key)` to the engine (pending registration with a 3 s timeout → `'error'`).
- [ ] **Step 4: Run** `python -m pytest tests/test_tour_*.py -v` → all PASS.
- [ ] **Step 5: Visual pass** — scratch script (not committed) screenshots each scene at 25/50/90 % of its duration at 1440×900 and 390×844 into the scratchpad; review by eye for clipping, overlap, legibility and the wow moments; fix and re-run tests.
- [ ] **Step 6: Commit** `feat(tour): cinematic Home intro`.

---

### Task 7: Release docs, regression, preview and PR

**Files:**
- Modify: `VERSION` (`7.4.6` → `7.5.0`), `CHANGELOG.md` (new `7.5.0 — 2026-11-04` release section: site tour engine + Home intro; asset counters `tour-loader.js v1` etc.), `TECHNICAL.md` §4 (two `dep_tour_*` rows, owner page `every`) and §2.1 (one line: `tour/` lazy-loaded demo system, GSAP vendored), `HANDOVER.md` (append a session block per its schema, focus `v7.5.0 — site tour stage 1`)

- [ ] **Step 1: Update the four docs** as above.
- [ ] **Step 2: Full regression** — `python -m pytest tests/ -q -n 4` → same pass/fail set as the Task 1 baseline plus all new tour tests passing.
- [ ] **Step 3: Record preview videos** — scratch Playwright script with `record_video_dir`, `?tour=play`, viewports 1440×900 and 390×844; convert to `.mp4` with ffmpeg (H.264, `-preset veryfast`); send both to the owner with a one-line note that fonts fall back in the recording environment.
- [ ] **Step 4: Commit** `docs: v7.5.0 release notes for site tour stage 1`, push `feature/site-tour`, open a **draft** PR titled `Site tour stage 1: engine + cinematic Home intro`, body summarising what plays, how to preview (`?tour=play`), test results, and ending with the PR attribution lines. Mark it ready only after the owner's feedback on the previews is addressed.
