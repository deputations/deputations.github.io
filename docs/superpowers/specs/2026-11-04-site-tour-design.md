# Site tour — cinematic "how to use" demos

```
status:   approved design (2026-11-04), awaiting spec review
owner:    Vivek Vishal
scope:    index.html, india-map.html, my-deputation.html, defex.html, report-vacancy.html
stack:    vanilla JS + GSAP 3.15 (vendored), no build step, no framework
```

## 1. Goal

A first-time visitor understands what the site does for them in under a minute,
and comes away saying "wow". Each main page plays a short, auto-playing,
scripted demo the first time it is visited: a fake cursor uses the page with
sample data while the "camera" moves through a 3D glass stage. It ends by
handing the visitor into the real feature.

Success looks like:
- Plays smoothly (no visible stutter) on a mid-range Android phone and on desktop.
- Never shows an empty or "Loading…" state: all demo content is scripted sample data.
- Never gets in the way: always skippable, plays once per page, can be turned off.
- Costs repeat visitors nothing: GSAP and scene code load only when a demo plays.
- Existing smoke tests keep passing untouched.

Non-goals: sound, voice-over, video export (a later, separate task), demos on
Rules / FAQ / Contact / Upcoming Projects, translating the demo text.

## 2. Visual language (the "wow" layer)

The tour always uses the dark cinematic look, in both site themes, built from
the existing tokens (`--primary-color #22d3ee`, `--accent-color #a78bfa`,
`--bg-main #02040b`, glass surfaces) and fonts (Unbounded for headlines,
Sora / Plus Jakarta Sans for UI text).

| element | behaviour |
|---|---|
| Opening | page behind blurs (backdrop-filter) and darkens; a cyan→violet aurora blooms; headline assembles letter by letter, blur→sharp, with slight letter-spacing collapse; then an optional full-screen brand wordmark |
| Stage | glass panels in a `perspective` container; a "camera" (one transform on the stage root) pushes in, tilts (rotateX/Y ≤ 12°) and glides between panels; 2–3 depth layers move at different rates for parallax |
| Cursor | glowing orb with a short light trail; each tap emits a ripple ring and a spark |
| Numbers | odometer-style rolling digits |
| Cards | light sweep across on arrival; spring pop-ins (`back.out`) |
| Transitions | scene-to-scene morph: the last focal element of a scene scales/moves into the first element of the next (no hard cuts) |
| Finale | particle burst + CTA that hands into the real feature |
| Demo badge | small "Demo · sample data" tag fixed in a corner for the whole tour |

Motion uses only `transform`, `opacity` and `filter` (blur on short reveals only),
so the browser can run it on the GPU.

## 3. Demos per page

Timings are targets; each scene is its own GSAP timeline so they can be tuned
independently. "Tall" = portrait phone layout, designed separately (not scaled).

### 3.1 Home (`index.html`) — key `home`, ~75 s (revised 2026-11-05 with the owner)

Every Home feature gets its own short step; the other pages get only a
"small mention" montage at the end (their full demos live on their own pages).
Sample data follows the site's feeder-grade eligibility rule and every number
is labelled as sample.

0. **Intro** (~6 s): *"Your one stop solution to Deputation"* assembles letter
   by letter, then the brand **ALL Deputations.com** crashes in full-screen
   (fitted to ~90 % of the viewport width; on phones "ALL" over
   "Deputations.com"), a light sweep crosses it and it holds long enough to be
   remembered before flying into step 1.
1. **"Only the posts you can apply for"** (~11 s): card wall; Display
   deputations for me → Level 7 → 4 years; ineligible cards fall away;
   survivors ("Open to L-7 · 3 yrs") fly into a list; 1,240 → 86.
2. **"Narrow it down"** (~8 s): Ministry / Organisation / Location dropdown
   pills and the quick chips (New, Closing in 7 days, Delhi/NCR, Closing today).
   The cursor ticks two ministries, then Delhi/NCR, then Closing in 7 days;
   result rows collapse away and the count rolls down at each pick.
3. **"Just ask"** (~10 s): as before ("Understood" tags, AI-ranked matches).
4. **"Sort and switch views"** (~9 s): a results table; the cursor clicks the
   "Days left" header, its arrow flips and the rows glide into the new order;
   then the view toggle morphs the rows into cards (each row flies and
   reshapes into its card).
5. **"Save posts you like"** (~6 s): tapping a row's heart fills it with a
   burst; a heart arcs up to the header bookmark icon and its badge ticks 0 → 1.
6. **"Never miss a vacancy"** (~7 s): the header bell switches alerts on; a
   phone slides in and a push alert drops down on it ("New · Level 8 · Delhi").
7. **"Light or dark — your choice"** (~6 s): a mini page flips to the light
   theme with a circular wipe from the theme toggle, then wipes back.
8. **"Explore more pages"** (~16 s): each page appears large for ~2 s with a
   mini animation, then shrinks into a grid slot (wide 3 × 2; phone 2 × 3):
   India Map (map draws itself) → top-left; DeFeX (gauge needle sweeps) →
   top-centre; My Deputation (tracker steps) → top-right; Report Vacancy (PDF
   drops in) → bottom-left; Rules (pages flip) → bottom-centre; FAQs (a
   question expands) → bottom-right.
9. **Finale**: the grid stays; each card is a real link to its page; CTA
   **"Try it with your pay level"** sits below it and opens `#filterMyPayLevelBtn`.

The India map journey (former Home step 3) moves to the India Map page tour (§3.2).

### 3.2 India Map (`india-map.html`) — key `map`, ~45 s (revised 2026-11-05: all map features, owner's choice)

0. **Intro** (~3 s): *"Vacancies across India, on one map"*.
1. **"Every state at a glance"** (~8 s): the map draws itself, tilts into the
   hologram table and glows as a heat map; the sample counter rolls up; the
   cursor hovers a state and its tooltip card appears (name and sample
   count, as the real tooltip shows; review 2026-11-05).
   Auto-play on this page waits for the page's own draw-in
   (`map:drawInComplete`, at most 12 s after load) so it never covers the
   page's intro or races its history.replaceState.
2. **"Filter the whole map"** (~8 s): a filters panel (mirroring the page's:
   For me, Pay Level, Ministry …); picking Pay Level 8 and then Finance
   recolours every state and rolls the counter down at each pick.
3. **"Dive into a state"** (~9 s): tapping Karnataka dives in, its districts
   rise one by one, "Back to India" and the state title appear.
4. **"Posts in every district"** (~9 s): tapping Bengaluru Urban drops a pin;
   its sample posts slide up as the real district cards (Level-N badge,
   "Closes <date>", Notification); one opens — on Home, as on the real page —
   into a detail card labelled "Opens on Home →" whose heart saves it (the map
   itself has no save button; review 2026-11-05).
5. **"Zoom, list and go back"** (~8 s): "View all 96 vacancies in Karnataka" opens the
   state's list; the zoom buttons zoom in and reset; "Back to India" flies
   back out to the whole map.
6. **Finale**: CTA **"Explore the map"** closes the tour onto the real map.

### 3.3 My Deputation (`my-deputation.html`) — key `mydep`, ~12 s

- The bookmarked post drops into the Tracker; status chip steps
  Saved → Applied → NOC → Interview with a moving glow rail.
- Calendar flips to the month; the last date gets a ring.
- Phone-style notification slides in: "Closes in 3 days".
- CTA **"Set up my profile"** → closes tour, focuses the Profile tab.

### 3.4 DeFeX (`defex.html`) — key `defex`, ~10 s

- Cursor types a ministry name in the search; result card expands.
- Gauge needle sweeps to a score; signal-strength bars fill beside it.
- "What to do next" card unfolds.
- CTA **"Check my readiness"** → closes tour.

### 3.5 Report Vacancy (`report-vacancy.html`) — key `report`, ~8 s

- A PDF icon arcs in and drops onto the drop zone; fields fill themselves.
- Report card moves along a rail: Under review → Published, with a burst.
- CTA **"Report a vacancy"** → closes tour.

## 4. Architecture

```
vendor/gsap.min.js            GSAP 3.15.1 core (UMD), vendored like three.module.js
tour/tour-loader.js           ~2 KB, deferred on each page; decides + lazy-loads
tour/tour.css                 overlay, chrome, cursor, glass, tall layout
tour/tour-engine.js           player: overlay DOM, scene timelines, chrome, layout, closing
tour/tour-kit.js              toolbox scenes draw with: cursor, tap, type, odometer, camera, burst, sweep, sample data
tour/scenes/home.js           Home steps 1–3 + registration of the Home tour
tour/scenes/home-more.js      Home steps 4–7 (sort/views, bookmark, alerts, theme)
tour/scenes/pages.js          Home step 8: the page montage (mini map uses map.js data)
tour/scenes/map.js            map helpers (draw, dive, districts, pin, recolour, fly out)
tour/scenes/map-page.js       the India Map page tour (steps 1–5)
tour/scenes/mydep.js
tour/scenes/defex.js
tour/scenes/report.js
tour/tour-map.json            pre-baked map geometry (~50 KB target, < 80 KB hard cap)
scripts/build_tour_map.py     builds tour-map.json from geo/*.geojson
tests/test_tour_*.py          Playwright smoke tests (existing suite conventions):
                              test_tour_map, _loader, _engine, _kit, _map_scene, _home; shared helpers in tests/tour_helpers.py
```

### 4.1 Units and interfaces

**tour-loader.js** — the only always-loaded piece.
- Read by `<script defer src="/tour/tour-loader.js?v=1" data-tour="home"></script>`.
- Injects a small floating "▶ How this works" button (bottom-right — bottom-left
  is the site's visitor counter); it fades out while the footer trust line is on
  screen, so it never covers it.
- Auto-play rule, all must hold: page key not in `dep_tour_seen_v1`;
  `dep_tour_off_v1` not set; `navigator.webdriver` is false; not
  `prefers-reduced-motion: reduce`. `?tour=play` forces play and bypasses all four.
- Starts after `window.load` plus one idle callback (fallback 800 ms), so the
  page's own load and the WebGL hero finish first.
- On play: loads, in order, `vendor/gsap.min.js`, `tour/tour.css`,
  `tour/tour-engine.js`, `tour/tour-kit.js`, `tour/scenes/<key>.js` (and `map.js`
  before `home.js` for home), then
  calls `DepTour.play(key)`. A load failure aborts silently and leaves the page untouched.

**tour-engine.js** — exposes `window.DepTour`:
- `DepTour.register(key, { scenes: [Scene...], cta })`
- `DepTour.play(key, { speed })` → builds overlay, runs scenes, resolves on close.
- Overlay chrome: scene label + title, scene dots (click to jump), progress bar,
  Skip, "Don't show tours again", Demo badge.
- Keyboard: Esc = skip, ←/→ = previous/next scene, Space = pause; focus is
  trapped in the overlay; `role="dialog"`, `aria-modal="true"`, labelled by the title.
- Closing (Skip, Esc, CTA, end): marks the page key seen, fades the overlay out,
  restores focus and scroll, kills all timelines, removes DOM.
- Layout: `wide` (design canvas 1100×620) or `tall` (390×720) chosen from the
  viewport (< 700 px wide → tall); canvas scaled to fit; re-chosen on resize/rotate
  by rebuilding the current scene from its start.

**Scene contract** (each `tour/scenes/*.js` file registers its scenes):
```js
{ key: 'eligibility', label: 'STEP 1', title: 'Only the posts you can apply for',
  build(stage, kit) { /* create DOM in stage, return a gsap.timeline() */ } }
```
`kit` is the engine toolbox every scene uses, so scenes stay small:
`kit.layout` ('wide' | 'tall'), `kit.cursorTo(target, opts)`, `kit.tap(target)`,
`kit.type(el, text, opts)`, `kit.odometer(el, from, to, opts)`,
`kit.splitTitle(el)`, `kit.camera(tl, pose, opts)`, `kit.burst(x, y)`,
`kit.sweep(el)`, `kit.el(tag, className, html)`, `kit.sample` (shared sample data).

### 4.2 Data

- **Sample vacancies**: a fixed list inside `tour-engine.js` (`kit.sample`) using
  real ministry names and realistic posts, pay levels and dates, always shown
  with the Demo badge. Dates are generated relative to today so "closing this
  month" stays true.
- **Map geometry**: `scripts/build_tour_map.py` reads `geo/india-states.geojson`
  and `geo/india-districts-all.geojson`, applies the same linear fit projection as
  `india-map-view.js` (`project()`), simplifies rings (Douglas–Peucker), drops
  slivers, and writes `tour/tour-map.json`:
  `{ viewBox, states: [{ abbr, name, d, cx, cy }], focus: { state: 'Karnataka',
  viewBox, districts: [{ name, d, cx, cy }] } }`. District features with no
  `district` property (one exists in Karnataka) are drawn but get `name: null`
  and are never targeted by the cursor. Committed to the repo;
  re-run only if the geojson changes.

### 4.3 Storage and URL

| key | shape | purpose |
|---|---|---|
| `dep_tour_seen_v1` | `{ home: 1, map: 1, mydep: 1, defex: 1, report: 1 }` | per-page "already played" |
| `dep_tour_off_v1` | `"1"` | "Don't show tours again" |

Both are added to TECHNICAL.md §4. All storage access wrapped in try/catch;
if storage is unavailable the tour still works but may replay.
URL: `?tour=play` (force play), `&tourSpeed=N` (timeScale, tests only).

## 5. Accessibility, motion and performance

- Reduced motion: no auto-play. The button opens a **steps view** instead: the
  same overlay with each scene's title and a one-line description, advanced with
  Next / Back, fades only.
- Everything is reachable by keyboard; buttons have visible focus rings.
- Text inside the stage is real DOM text (not canvas), so it stays crisp at any zoom.
- Particle counts and card-wall size are reduced in `tall` layout and when
  `navigator.hardwareConcurrency <= 4`.
- While the tour is open, the page's WebGL hero is left running but sits under a
  dimmed backdrop; no other page state is touched.
- The tour never edits the page's real filters or storage, except the CTA, which
  only scrolls to and opens a control.

## 6. Error handling

- Any script/JSON load failure → no tour, no error shown, page unaffected.
- An exception while building a scene → that scene is skipped; if all fail the
  overlay closes. Errors go to `console.warn` with a `[tour]` prefix.
- If the user resizes mid-scene, the current scene restarts in the new layout.

## 7. Testing

`tests/test_tour.py`, following the existing pytest + Playwright smoke-test setup:
1. Normal test run (webdriver) → no overlay on any of the five pages.
2. `?tour=play&tourSpeed=20` on each page → overlay appears, progress advances,
   reaches the CTA, closes cleanly, no console errors, seen flag written.
3. Skip button and Esc close the tour and write the seen flag.
4. "Don't show tours again" writes `dep_tour_off_v1`.
5. "▶ How this works" button replays after the tour was seen.
6. Emulated reduced motion → steps view, no timeline.
7. 390 px viewport → tall layout class on the stage.
Plus: `scripts/build_tour_map.py` output check — 36 states, Karnataka districts
present, file < 80 KB.
Visual review: screenshots at 1440×900 and 390×844 for each scene, checked by
eye before each PR.

## 8. Delivery

Branch `feature/site-tour` on `deputations/deputations.github.io`, delivered as
pull requests so nothing goes live until merged:

1. **PR 1** — engine, loader, vendored GSAP, map builder + `tour-map.json`,
   Home demo, tests. A preview is shared for feedback before the PR is final.
2. **PR 2** — India Map demo.
3. **PR 3** — My Deputation, DeFeX, Report Vacancy demos.

Each PR follows the project protocol: VERSION bump (7.4.6 → 7.5.0 for PR 1,
then patch bumps), CHANGELOG entry, TECHNICAL.md §4 table update, HANDOVER entry.
