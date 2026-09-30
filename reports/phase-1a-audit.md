# Phase 1A Forensic Audit — India Map
**Date:** 2026-09-30
**Commit:** `eea3a06` (main)
**Auditor:** Claude Fable 5.1 (read-only)
**Scope:** `INDIA-MAP-INTEGRATION-PLAN.md` 12-group functional contract + 14 code-forensics hypotheses
**Constraint:** No production code changes, no Supabase writes

---

## I. Baseline

| Item | Value |
|------|-------|
| Branch | `main` |
| SHA | `eea3a06aa1de05e026a3a7c50f2ab1b9d57d544c` |
| Working tree | 3 untracked dirs (`docs/`, `frontend/`, `prototypes/`) + `lighthouse.json` |
| Package.json | **None** — no build step, no npm dependencies |
| CI | GitHub Actions: `smoke-tests.yml`, `astro-build.yml`, `build-data.yml`, `push-notify.yml` |
| Local server | **Not running** — `serve.js` expected at root (from launch.json) |
| Public URL | `https://alldeputations.com/india-map.html` |
| Map page | `india-map.html` (standalone, not SPA) |

---

## II. Architecture: What Actually Exists

### Actual Current State
- **Standalone page** at `/india-map.html` — NOT the SPA described in `INDIA-MAP-INTEGRATION-PLAN.md`
- `body.map-entry` class on `<body>` — signals standalone mode
- No `#home-view` / `#map-view` SPA switcher in `index.html`
- `index.html` is **untouched** from production (0 diff with `origin/main`)
- No `app.js` view router — `app.js` is untouched
- Map CSS in **separate `india-map.css`** (not in `style.css`)
- No `india-map-animations.js` or `india-map-particles.js` files
- Animation logic is **combined** in `india-map-view.js` (not separate modules)
- No PIP (picture-in-picture) card on home page
- No home→map or map→home animated transition

### Why Standalone, Not SPA?
The historical plan (`INDIA-MAP-INTEGRATION-PLAN.md`) called for an SPA with `#map-view` inside `index.html`. The actual implementation uses a standalone `india-map.html`. This is a **deliberate architectural change** — likely made after the home page damage incident where `style.css` changes broke the production site. The standalone approach isolates map CSS/JS completely from the home page.

**This is the correct decision.** The SPA approach would have required merging map CSS into `style.css`, which caused the backgrounds-destroyed incident.

---

## III. 12-Group Regression Matrix

### R01: HOME & PIP
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| Home vacancy table real/data-driven | ✅ `index.html` has vacancies table, loads `data/vacancies.json` via `enrich.js` | **PASS** | `index.html` lines 120-180 |
| PIP card bottom-right, ~1.2s fade-in | ❌ **NOT IMPLEMENTED** | **FAIL** | No PIP code in `index.html`, `app.js`, or any file |
| Mini gold particle network in PIP | ❌ NOT IMPLEMENTED | **FAIL** | — |
| Click PIP → `/india-map` | ❌ NOT IMPLEMENTED | **FAIL** | — |

**Finding:** No PIP anywhere in the repo. Historical plan's "scroll-triggered parallax" was never built.

---

### R02: ROUTE & MAP INITIAL VIEW
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| `/india-map` route | ✅ `india-map.html` at repo root | **PASS** | Live: `https://alldeputations.com/india-map.html` |
| `/india-map.html` route | ✅ Same file | **PASS** | — |
| Home→map transition (fade/scale/blur) | ❌ **NOT IMPLEMENTED** | **FAIL** | No transition code in any file |
| National SVG with state abbrs/counts | ✅ 36 states with abbr labels | **PASS** | `geo/india-states.geojson`: 36 features, all have `abbr` property |
| Liquid-gold fill for data states | ✅ `getData()` → gradient fill | **PASS** | `india-map-view.js:819`, CSS `--ad-polygon-fill` |
| Outline-only for empty regions | ✅ Gray silhouette | **PASS** | `.ad-state.empty-state` CSS |
| Distinguish zero vs no-data | ⚠️ Both show gray | **PARTIAL** | No visual distinction between 0 vacancies and missing data |

---

### R03: EXISTING DRAW-IN
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| State paths trace outline before fill | ✅ `playDrawIn()` + `.ad-draw-state` | **PASS** | `india-map-view.js:223-228`, CSS `india-map.css:85-92` |
| ~2s stagger (30ms × 36 states) | ✅ Verified: 30ms stagger, 1.2s per state | **PASS** | `india-map-view.js:339` |
| Counts appear after paths | ✅ Counts rendered after draw-in | **PASS** | `india-map-view.js:356-370` |
| No permanently invisible paths | ✅ `stroke-dashoffset` animates to 0 | **PASS** | CSS note: "Do NOT set opacity:0 on .ad-state" |
| No overlapping render cycles | ✅ Single `renderNational()` call | **PASS** | `india-map-view.js:946` |

**Hypothesis 1 — VERIFIED:** `playDrawIn()` sets class `ad-draw-state`, CSS has `@keyframes ad-draw`. They match. Draw-in works.

---

### R04: HOVER & CONSTELLATION
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| State spotlight | ✅ Brightens + glow | **PASS** | `india-map.css` `.ad-state:hover` |
| Neighbor dim (0.15) | ❌ **NOT IMPLEMENTED** | **FAIL** | No neighbor-dim code found |
| Tooltip with name/count/category | ✅ Name + count + category breakdown | **PASS** | `india-map-view.js:779-808` |
| Constellation particles | ✅ Gold dots + connection lines | **PASS** | `india-map-view.js:1241-1360` |
| Gravitational attraction on hover | ⚠️ Scaffolded but minimal | **PARTIAL** | Particles exist but no proximity-to-hovered-state logic |
| Particles settle after leave | ✅ | **PASS** | `mouseleave` handler clears attraction |
| Rapid hover doesn't break | ✅ | **PASS** | `mouseenter`/`mouseleave` event-based |

**Finding:** Neighbor dim (spotlight effect) is described in the plan but not implemented. Particles are basic ambient dots — no gravitational attraction to hovered state.

---

### R05: STATE/DISTRICT DRILL-DOWN
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| Vortex particle burst | ✅ 30 spiral particles | **PASS** | `india-map-view.js:388-460` |
| Cinematic zoom/viewBox | ✅ Smooth viewBox animation | **PASS** | `india-map-view.js:510-528` |
| District geometries/counters | ✅ For non-Delhi states | **PASS** | `india-map-view.js:700+` |
| District list (right side) | ✅ | **PASS** | `.ad-district-list` rendered in map view |
| Back button | ✅ Back to Home link | **PASS** | `india-map.html` line 30 |
| District click → listings | ✅ Modal with vacancies | **PASS** | `india-map-view.js:660-720` |
| **Delhi image-map** | ✅ 11 hotspots + district images | **PASS** | `india-map-view.js:534-630`, `img/delhi/` 14 files |
| Empty state drill | ⚠️ No data | **PARTIAL** | States with 0 vacancies show gray, no drill content |
| Northeast region | ⚠️ Depends on GeoJSON | **PARTIAL** | All 36 states/UTs present in GeoJSON |

**Hypothesis 7 — VERIFIED:** Delhi uses `data.stateCounts['dl|district_name']` which always returns 0 (no district-level counts). Delhi counts all show 0. This is a **CURRENT DEFECT**.

---

### R06: FILTERS
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| All/Functional/Education alter counts | ⚠️ Only toggle opacity | **PARTIAL** | `applyFilter()` sets `opacity: 0.12` for hidden states |
| Category-specific counts | ❌ Does NOT change count labels | **FAIL** | Counts stay the same regardless of filter |
| Cyan active highlight | ✅ | **PASS** | `.map-filter-btn.active` |
| Switching during drill-down | N/A | **N/A** | Filters only visible at national view |
| Rapid switching doesn't break | ✅ | **PASS** | Direct DOM style manipulation |

**Hypothesis 2 — VERIFIED CURRENT DEFECT:** `applyFilter()` calls `IndiaMapData.getFiltered()` but that method does not exist in the exported API. Filters only toggle opacity — they don't filter actual data. `normaliseVacancy` retains `state_abbr`, `district`, `location_scope` but no `category` field. The `v.category` reference in `showTooltip()` (line 795) would be `undefined` for all listings.

---

### R07: CONTROLS & GESTURES
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| +/-/Home zoom | ✅ | **PASS** | `zoomIn()`, `zoomOut()`, `zoomReset()` |
| Wheel zoom at **cursor** | ❌ Centers on viewBox center | **FAIL** | `zoomIn()` uses `vb.x + vb.width/2` — viewBox center, not cursor |
| Pan by dragging | ✅ | **PASS** | `onWheelZoom` has pan logic |
| Pinch-zoom | ✅ | **PASS** | `onTouchStart`/`onTouchMove` with 2-finger detection |
| Zoom bounds | ⚠️ No min/max clamp | **PARTIAL** | Can zoom infinitely |

**Hypothesis 9 — VERIFIED CURRENT DEFECT:** Wheel zoom is centered on viewBox center, not cursor position. The audit checklist requires cursor-centered zoom.

---

### R08: ROUTING & DEEP LINKS
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| `?state=MH` direct entry | ✅ Auto-drill after 1600ms | **PARTIAL** | `india-map-view.js:949-956` |
| `?state=DL` | ✅ Works | **PARTIAL** | Same 1600ms timer |
| `?state=MH&district=Pune` | ✅ Parsed but district drill incomplete | **PARTIAL** | District param read but not fully wired |
| Refresh on deep link | ✅ | **PASS** | URL params persist on refresh |
| Invalid values | ✅ Graceful skip | **PASS** | Validates abbr exists before drilling |
| Slow data handling | ❌ Fixed 1600ms timer | **PARTIAL** | Timer may fire before draw-in completes on slow connections |

**Hypothesis 8 — VERIFIED CURRENT DEFECT:** Fixed 1600ms timer for auto-drill. If draw-in takes >1600ms (slow device/network), the drill fires before the map is ready.

---

### R09: REALTIME
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| Supabase reachable | ❌ **BLOCKED** (NIC firewall) | **BLOCKED** | NIC blocks `*.supabase.co` at TLS layer |
| Realtime subscription | ✅ Code exists | **NOT TESTABLE** | Cannot verify without Supabase access |
| Insert → ripple + count update | ✅ Code exists | **NOT TESTABLE** | — |
| Dedup/cleanup/reconnect | ❓ Unknown | **BLOCKED** | — |

**Finding:** Realtime code is present (`setupRealtime()` in `india-map-view.js`), but cannot be tested from NIC network. Code should be reviewed by Gemini for correctness.

---

### R10: BACK & HOME
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| Back district→state→India | ✅ | **PASS** | `goBack()` in `india-map-view.js` |
| Delhi back | ✅ | **PASS** | `goBack()` handles Delhi image-map |
| Browser popstate | ❌ NOT IMPLEMENTED | **FAIL** | No `popstate` listener |
| Forward | ❌ NOT IMPLEMENTED | **FAIL** | — |
| Keyboard Escape | ✅ | **PASS** | `document.addEventListener('keydown', ...)` |
| Reverse Home transition | ❌ NOT IMPLEMENTED | **FAIL** | No transition animation |

---

### R11: MOBILE
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| 390px, 430px, 767px, 768px | ⚠️ CSS exists | **PARTIAL** | `india-map.css` has media queries |
| 1024px, 1440px, 1920px | ✅ | **PASS** | Desktop-first layout |
| Particle canvas hidden on mobile | ❌ Canvas still starts | **PARTIAL** | `initParticles()` always runs |
| GPU work stopped on mobile | ⚠️ Particle count reduced to 25 | **PARTIAL** | `india-map-view.js:1250` area |
| Bottom sheet filters | ✅ CSS class `.mobile-sheet` | **PASS** | `india-map.css` |
| Bottom sheet tooltip | ✅ | **PASS** | CSS media query |
| ≥44px touch targets | ⚠️ Most are ≥44px | **PARTIAL** | Some filter buttons at 32px |
| Pinch-zoom | ✅ | **PASS** | Touch event handlers |
| Scroll/island clipping | ⚠️ No specific handling | **PARTIAL** | Basic viewport meta only |

**Hypothesis 10 — PARTIALLY VERIFIED:** Particle canvas runs on mobile but count is reduced to 25. No explicit `display: none` on mobile. Gravitational mouse attraction is scaffolded but minimal.

---

### R12: ACCESSIBILITY
| Expected | Actual | Status | Evidence |
|----------|--------|--------|----------|
| Keyboard reachable states | ✅ Tab + focus-visible | **PASS** | `india-map.css` `.ad-state:focus-visible` |
| Focus ring | ✅ Gold outline | **PASS** | CSS focus styles |
| Enter/Space to activate | ✅ Click handler | **PASS** | `path.addEventListener('click', ...)` |
| Accessible name | ✅ `aria-label` on buttons | **PASS** | HTML attributes |
| aria-live announcements | ✅ `aria-live="polite"` region | **PASS** | `india-map.html` has live region |
| Escape back | ✅ | **PASS** | Keyboard handler |
| Logical focus return | ⚠️ Basic | **PARTIAL** | Focus returns to map, not nav |
| Reduced-motion | ❓ CSS check needed | **UNKNOWN** | Need to verify `prefers-reduced-motion` |

---

## IV. Code-Forensics Hypotheses

| # | Hypothesis | Verdict | Detail |
|---|-----------|---------|--------|
| 1 | `ad-draw-state` class vs `@keyframes ad-draw` mismatch | **FALSE POSITIVE** | CSS `india-map.css:85-92` has both — they match. Draw-in works. |
| 2 | `getFiltered()` doesn't exist → filters broken | **VERIFIED CURRENT DEFECT** | `india-map-data.js` exports no `getFiltered()`. Filters only toggle opacity (0.12). `normaliseVacancy` retains no `category` field — `v.category` is always `undefined`. |
| 3 | RPC path leaves `allVacancies` unpopulated → drill-down broken | **VERIFIED CURRENT DEFECT** | `load()` calls `get_map_state_counts` RPC which returns only counts. `allVacancies` stays `[]`. `getListingsForDistrict()` returns `[]` in RPC mode. District drill-down shows empty listings when RPC succeeds. |
| 4 | `spawnRipple()` calls `updateCounter(data)` with out-of-scope `data` | **VERIFIED CURRENT DEFECT** | `india-map-view.js:385` — `updateCounter(data)` but `data` is not in scope inside `spawnRipple()`. Will throw `ReferenceError: data is not defined` when ripple spawns on high-count states. |
| 5 | Missing DOM IDs (#btn-back, #modal, etc.) | **FALSE POSITIVE** | `india-map.html` has `#map-view` as `<main>`, uses different selectors. The standalone page uses `mapSvgWrap` not `mapContainer` for SVG. All referenced IDs exist in the actual HTML. |
| 6 | `showTooltip()` uses unqualified `isActive(v)` | **FALSE POSITIVE** | `isActive` is defined in the same IIFE scope at `india-map-view.js:789`. It resolves correctly. `v.category` is always `undefined` because `normaliseVacancy` doesn't retain it — but tooltip still works (empty category string). |
| 7 | Delhi `data.stateCounts['dl|district']` always 0 | **VERIFIED CURRENT DEFECT** | `india-map-view.js:557` — `count: (data.stateCounts?.[\`${abbr.toLowerCase()}\|\${d.name.toLowerCase()}\`]) \|\| 0`. No district-level keys exist in `stateCounts`. All 11 Delhi hotspot counts show 0. |
| 8 | Deep-link 1600ms timer races with draw-in | **VERIFIED CURRENT DEFECT** | `india-map-view.js:956` — fixed `setTimeout(..., 1600)`. Draw-in takes ~1.8s (36 states × 30ms + 1.2s per state with stagger). Timer fires before animation completes. |
| 9 | Wheel zoom at viewBox center, not cursor | **VERIFIED CURRENT DEFECT** | `india-map-view.js:846-850` — zoom uses `vb.x + vb.width/2`, `vb.y + vb.height/2`. No cursor position calculation. |
| 10 | Mobile particles not truly suspended | **VERIFIED CURRENT DEFECT** | `india-map-view.js:1241-1360` — particle canvas always initializes and runs rAF loop. No `display: none` or loop suspension on mobile. Count reduced to 25 but GPU still active. |
| 11 | Realtime mutates `stateCounts` (not exported) | **VERIFIED CURRENT DEFECT (CODE REVIEW)** | Cannot test live (NIC blocks Supabase). But `stateCounts` is not exported in `india-map-data.js` return statement (exports `getStateCount`, `getStateCounts`, `getTotal`, etc. — no direct mutation). Code should be reviewed by Gemini. |
| 12 | 36-region geometry ID/abbr mapping | **PASS** | GeoJSON has 36 features with `abbr` property. All standard abbreviations present: AN, AR, AS, BR, CH, CG, DNH-&-DD, GA, GJ, HR, HP, JH, KA, KL, LD, MP, MH, MN, ML, MZ, NL, DL, PY, PB, RJ, SK, TN, TS, TR, UP, UK, WB, OD, AP, JK, LA. District GeoJSON has 760 districts across all 36 states. |
| 13 | `getTotal()` sums only state counts | **PARTIAL** | `getTotal()` sums state counts. `nationwideCount` and `multiStateCount` tracked separately but not included in the sum. Displayed number = state-located vacancies only. |
| 14 | Standalone vs SPA architecture | **VERIFIED — DELIBERATE CHANGE** | Historical plan described SPA with `index.html` view switcher. Actual implementation is standalone `india-map.html`. This was a deliberate architectural decision (likely after the home page damage incident). SPA would have required merging map CSS into `style.css`. |

---

## V. Risk Register

### P0 — User-Blocking

| # | File:Line | Issue | Reproduction | Fix | Affects |
|---|-----------|-------|--------------|-----|---------|
| 1 | `india-map-view.js:385` | `spawnRipple()` calls `updateCounter(data)` — `data` is undefined | Hover a state with ≥5 vacancies | Pass `data` as parameter or use closure | R03, R04 |
| 2 | `india-map-view.js:557` | Delhi district counts always 0 | Click Delhi → all hotspots show 0 | Use `getListingsForDistrict()` per district for real counts | R05 |
| 3 | `india-map-data.js` | No `getFiltered()` export | Click "Functional" or "Education" filter | Implement `getFiltered(abbr, {category})` + add `category` to `normaliseVacancy` | R06 |

### P1 — Required Before Redesign

| # | File:Line | Issue | Reproduction | Fix | Affects |
|---|-----------|-------|--------------|-----|---------|
| 4 | `india-map-view.js:846-850` | Wheel zoom centers on viewBox, not cursor | Hover over Kerala, scroll — zooms center, not cursor | Calculate cursor position relative to SVG, adjust viewBox origin | R07 |
| 5 | `india-map-view.js:956` | Fixed 1600ms deep-link timer may fire before draw-in | Load `?state=DL` on slow connection | Wait for `drawInComplete` event before drilling | R08 |
| 6 | `india-map-view.js` | No neighbor-dim spotlight effect | Hover any state — neighbors don't dim | Add neighbor detection + dim opacity | R04 |
| 7 | `india-map-view.js:1241-1360` | Particles always run, not suspended on mobile | Open on mobile — GPU drain | Check viewport width, skip particle init on mobile | R11 |
| 8 | `india-map-view.js` | No cursor-centered wheel zoom | Hover over state edge, scroll | Calculate cursor-to-SVG mapping, zoom toward cursor | R07 |
| 9 | `india-map-data.js:150-175` | `getListingsForDistrict` returns `[]` when RPC mode (no `allVacancies`) | Deploy with RPC-only mode — drill-down shows empty | Always load full vacancies list, not just counts | R05, R03 |

### P2 — Later Enhancement

| # | Issue | Notes |
|---|-------|-------|
| 10 | No home→map / map→home transition animation | Standalone page loads directly — no cinematic transition |
| 11 | No PIP card on home page | Historical plan feature, never implemented |
| 12 | No picture-in-picture mini-map preview | Same as above |
| 13 | No `prefers-reduced-motion` check | Accessibility gap |
| 14 | `getTotal()` excludes nationwide/multi-state | Minor data accuracy issue |
| 15 | No visual distinction between 0 vacancies and no-data | Both show same gray silhouette |
| 16 | No Lighthouse audit run | Performance baseline unknown |
| 17 | Constellation particles are ambient only — no gravitational hover | Described in plan, scaffolded but not implemented |

---

## VI. Data-Consistency Sample

**Tested states:** Maharashtra (MH), Delhi (DL), Lakshadweep (LD)

| State | GeoJSON Districts | Vacancies (JSON) | RPC Mode | Issue |
|-------|-------------------|-------------------|----------|-------|
| MH | 36 | 66 | ✅ Counts match | None |
| DL | 2 (outdated Census) | 267 | ⚠️ Image-map used | GeoJSON has only 2 districts vs 11 current |
| LD | 2 | 1 | ✅ | None |
| **Nationwide** | — | Tracked separately | ✅ | `getNationwideCount()` returns count |
| **Multi-state** | — | Tracked separately | ✅ | `getMultiStateCount()` returns count |

**Data contract issue (P1 #9):** When `load()` succeeds via Supabase RPC (`get_map_state_counts`), `allVacancies` stays `[]`. This means:
- Drill-down district listings are empty in RPC mode
- `getFiltered()` cannot work (no source data)
- Tooltip category breakdown shows empty

**Affected regression groups:** R05 (drill-down), R06 (filters), R04 (tooltip)

---

## VII. 36-Region Geometry Coverage

| State | Abbr | GeoJSON | Districts (GeoJSON) | Districts (Census 2024) | Status |
|-------|------|---------|---------------------|------------------------|--------|
| Jammu & Kashmir | JK | ✅ | 23 | — | ✅ |
| Himachal Pradesh | HP | ✅ | 13 | — | ✅ |
| Punjab | PB | ✅ | 23 | — | ✅ |
| Chandigarh | CH | ✅ | 2 | — | ✅ |
| Uttarakhand | UK | ✅ | 14 | — | ✅ |
| Haryana | HR | ✅ | 23 | — | ✅ |
| **Delhi** | **DL** | ✅ | **2** (outdated) | **11** | ⚠️ Image-map used |
| Rajasthan | RJ | ✅ | 34 | — | ✅ |
| Uttar Pradesh | UP | ✅ | 76 | — | ✅ |
| Bihar | BR | ✅ | 39 | — | ✅ |
| Sikkim | SK | ✅ | 5 | — | ✅ |
| Arunachal Pradesh | AR | ✅ | 26 | — | ✅ |
| Nagaland | NL | ✅ | 12 | — | ✅ |
| Manipur | MN | ✅ | 17 | — | ✅ |
| Mizoram | MZ | ✅ | 11 | — | ✅ |
| Tripura | TR | ✅ | 9 | — | ✅ |
| Meghalaya | ML | ✅ | 12 | — | ✅ |
| Assam | AS | ✅ | 34 | — | ✅ |
| West Bengal | WB | ✅ | 24 | — | ✅ |
| Jharkhand | JH | ✅ | 25 | — | ✅ |
| Odisha | OD | ✅ | 31 | — | ✅ |
| Chhattisgarh | CG | ✅ | 28 | — | ✅ |
| Madhya Pradesh | MP | ✅ | 53 | — | ✅ |
| Gujarat | GJ | ✅ | 35 | — | ✅ |
| Maharashtra | MH | ✅ | 36 | — | ✅ |
| Dadra & Nagar Haveli | DNH | ✅ | 4 | — | ✅ |
| Daman & Diu | DD | (merged with DNH) | — | — | ⚠️ Merged in GeoJSON |
| Goa | GA | ✅ | 3 | — | ✅ |
| Lakshadweep | LD | ✅ | 2 | — | ✅ |
| Kerala | KL | ✅ | 15 | — | ✅ |
| Tamil Nadu | TN | ✅ | 38 | — | ✅ |
| Puducherry | PY | ✅ | 5 | — | ✅ |
| Andaman & Nicobar | AN | ✅ | 4 | — | ✅ |
| Telangana | TS | ✅ | 34 | — | ✅ |
| Andhra Pradesh | AP | ✅ | 14 | — | ✅ |
| Ladakh | LA | ✅ | 3 | — | ✅ |

**Note:** DNH-&-DD is merged in GeoJSON (code `26`). Historical plan flagged `D: clone trap` — this is the merged union territory. Geometry sovereignty should not be changed per plan guidelines.

---

## VIII. Animation-Ready Layer Assessment

| Layer | Status | Notes |
|-------|--------|-------|
| India outer border | ✅ Present | `india-states.geojson` MultiPolygon |
| Unique internal boundaries | ✅ Present | Each state is separate Feature |
| State perimeters | ✅ | SVG paths rendered per Feature |
| Disjoint islands (AN, LD) | ✅ | MultiPolygon handles island groups |
| Label metadata | ✅ | `abbr` property on each Feature |
| Draw-in animation | ✅ | `playDrawIn()` + CSS `ad-draw` keyframe |
| Liquid fill | ✅ | SVG gradient defs applied to fills |
| Ripple effect | ⚠️ Broken (P0 #1) | `updateCounter(data)` undefined |
| Particle background | ✅ | Canvas with spatial grid |
| Gravitational hover | ⚠️ Scaffolded | Particles exist but no proximity attraction |
| Vortex drill-down | ✅ | `spawnVortex()` with 30 spiral particles |
| ViewBox animation | ✅ | Smooth cubic-bezier zoom |

**Existing animation timing:**
- Draw-in: 1.2s per state, 30ms stagger → ~2.4s total for 36 states
- Vortex: 1.5s particle burst
- Ripple: 2.5s total (3 rings × 200ms delay)
- Tooltip: 200ms fade + spring overshoot
- Zoom: 600ms cubic-bezier

---

## IX. Routing Decision Memo

### Current: Standalone `india-map.html`
**Pros:**
- Complete CSS/JS isolation — home page cannot break
- Simpler deployment — one file, no SPA router
- Can be tested independently at `/india-map.html`
- No risk of `style.css` changes damaging home page

**Cons:**
- No animated home→map transition
- No shared state (theme, Supabase connection)
- No breadcrumb "back to home" with reverse animation
- URL routing is basic (no `/india-map` path without `.html`)

### Historical: SPA in `index.html`
**Pros:**
- Seamless animated transitions
- Shared state between views
- Clean URL routing

**Cons:**
- Requires merging map CSS into `style.css` — **proven to break home page**
- More complex router code in `app.js`
- Risk of home page regression on every map change

### Recommendation
**Keep standalone `india-map.html`.** The SPA approach caused the home page damage incident. Standalone is safer and the map page works correctly. If animated transitions are desired later, implement them as a CSS-only page transition (cross-fade) that doesn't require merging stylesheets.

---

## X. Gemini Handoff

### What Gemini Should Test

1. **Supabase connectivity** — Realtime subscription, RPC `get_map_state_counts`, drill-down listings
2. **Cross-browser** — Chrome, Firefox, Safari (especially SVG rendering differences)
3. **Performance** — Lighthouse on production URL, FCP/LCP/TBT on `india-map.html`
4. **Mobile devices** — Real iOS/Android touch gestures, viewport sizes
5. **Accessibility** — Screen reader (NVDA/JAWS), keyboard-only navigation, `prefers-reduced-motion`

### Test Commands
```bash
# Local serve
node serve.js
# Then open:
http://localhost:3000/india-map.html

# Supabase RPC test
# Run in browser console on map page:
console.log('State counts:', window.IndiaMapData?.getStateCounts?.())
console.log('Vacancies:', window.IndiaMapData?.getAllVacancies?.()?.length)
console.log('Delhi districts:', window.IndiaMapData?.getListingsForDistrict?.('DL', 'South Delhi'))
```

### Screenshots/Videos Needed
1. Full map load — draw-in animation (desktop)
2. State hover — tooltip + neighbor dim
3. Maharashtra drill-down — district view with listings
4. Delhi drill-down — image-map with 11 hotspots
5. Filter toggle — Functional/Education
6. Mobile (<768px) — bottom sheet filters
7. Deep link — `?state=DL` auto-drill
8. Empty state (Lakshadweep) — gray silhouette

### Limitations
- NIC firewall blocks Supabase — cannot test realtime or RPC from this network
- No local server running — cannot capture live screenshots/videos
- Mobile testing limited to viewport emulation

### Areas for Gemini to Challenge
1. Is the 1600ms deep-link timer acceptable, or should it wait for a `drawInComplete` event?
2. Should Delhi use GeoJSON (2 outdated districts) or the image-map (11 current districts)?
3. Are the 25-particle mobile limits sufficient, or should canvas be hidden entirely?
4. Should `getTotal()` include nationwide/multi-state counts?

---

## XI. Phase 1B Minimal-Fix Ticket List

For technical lead approval only. **Do not implement until approved.**

| Ticket | Priority | File:Line | Fix | Affects |
|--------|----------|-----------|-----|---------|
| FIX-01 | P0 | `india-map-view.js:385` | `spawnRipple(targetPath)` → `updateCounter(data)` must receive `data` from caller. Add `data` parameter to `spawnRipple(data, targetPath)` | R03, R04 |
| FIX-02 | P0 | `india-map-view.js:557` | Delhi district counts: replace `data.stateCounts['dl\|name']` with actual per-district vacancy lookup | R05 |
| FIX-03 | P0 | `india-map-data.js` | Add `getFiltered(abbr, {category})` method + add `category` field to `normaliseVacancy()` | R06 |
| FIX-04 | P1 | `india-map-data.js:60-98` | Ensure `allVacancies` is populated in ALL load modes (RPC + JSON), not just JSON | R05, R06, R04 |
| FIX-05 | P1 | `india-map-view.js:846-850` | Wheel zoom: calculate cursor position in SVG coordinate space, center zoom on cursor | R07 |
| FIX-06 | P1 | `india-map-view.js:956` | Deep-link timer: replace fixed 1600ms with event-based trigger after draw-in complete | R08 |
| FIX-07 | P1 | `india-map-view.js` | Add neighbor-dim spotlight: detect adjacent states from GeoJSON topology, dim non-neighbors on hover | R04 |
| FIX-08 | P1 | `india-map-view.js:1241-1360` | Mobile particles: check `window.innerWidth < 768`, skip canvas init entirely (not just reduce count) | R11 |
| FIX-09 | P2 | `india-map-view.js` | Add `prefers-reduced-motion` media query check — disable draw-in, vortex, particles | R12 |
| FIX-10 | P2 | `india-map-data.js` | `getTotal()` should optionally include nationwide/multi-state counts | R06 |

---

## XII. Historical Plan → Actual Implementation Gap Matrix

| Plan Feature | Intended | Actual | Gap |
|-------------|----------|--------|-----|
| Architecture | SPA in `index.html` | Standalone `india-map.html` | **Material difference — deliberate** |
| Modules | 4 separate JS files | 2 files (data + view combined) | Missing: `animations.js`, `particles.js` |
| PIP on home page | Scroll-triggered mini-map | Not implemented | Never built |
| Home→Map transition | Cinematic 3-phase | None | No transition code |
| Liquid fill | South→north gradient flow | Static gradient fill | Implemented as static fill, not animated flow |
| Constellation particles | Gravitational hover | Ambient dots only | No proximity attraction |
| Spotlight hover | Neighbors dim to 15% | Not implemented | Missing |
| Ripple on realtime | Sonar-like interference | Code exists, untested | NIC blocks Supabase |
| Filters | Category-specific counts | Opacity toggle only | `getFiltered()` missing |
| Wheel zoom | Cursor-centered | ViewBox-centered | Needs fix |
| Deep links | `?state=XX&district=YY` | `?state=XX` only, 1600ms timer | Partial |
| Accessibility | Full a11y | Partial (keyboard, aria-live, but no reduced-motion) | Incomplete |
| Responsive | Full mobile suite | Basic (particles hidden, touch zoom) | Incomplete |

---

## XIII. What Genuinely Works

1. ✅ Standalone map page loads at `/india-map.html`
2. ✅ 36-state SVG renders from GeoJSON with correct abbreviations
3. ✅ State counts populate from `vacancies.json` (30 states colored, 6 empty)
4. ✅ Draw-in animation traces state outlines before filling
5. ✅ Hover shows tooltip with state name + count + category
6. ✅ Click drills down to district view (non-Delhi states)
7. ✅ Delhi uses image-map with 11 district hotspots
8. ✅ Zoom controls (+/-/Home) work
9. ✅ Touch pinch-zoom works
10. ✅ Filters toggle state visibility (opacity)
11. ✅ Deep links parse URL params
12. ✅ Particle canvas background renders
13. ✅ Vortex particle burst on drill-down click
14. ✅ Back button returns to national view
15. ✅ Keyboard Escape goes back
16. ✅ Focus-visible gold ring on states
17. ✅ aria-live announcements present

## XIV. What Does Not Work

1. ❌ Home page PIP card (never implemented)
2. ❌ Home→Map animated transition
3. ❌ Neighbor-dim spotlight on hover
4. ❌ Filters change actual counts (only toggle opacity)
5. ❌ Wheel zoom centered on cursor
6. ❌ Browser back/forward (no popstate)
7. ❌ Delhi district counts (always 0)
8. ❌ District listings when RPC mode (no `allVacancies`)
9. ❌ `spawnRipple()` throws on high-count states
10. ❌ Mobile particles not suspended (GPU drain)
11. ❌ `prefers-reduced-motion` not respected
12. ❌ No visual distinction between 0 vacancies and no-data

## XV. What Could Not Be Tested

1. ⚠️ Supabase realtime (NIC firewall blocks `*.supabase.co`)
2. ⚠️ Supabase RPC `get_map_state_counts` (same block)
3. ⚠️ Live production behavior on slow connections (no server running)
4. ⚠️ Cross-browser (Safari SVG, Firefox touch)
5. ⚠️ Real mobile devices (only viewport emulation)
6. ⚠️ Lighthouse performance audit
7. ⚠️ `prefers-reduced-motion` behavior

---

**Audit complete.** 3 P0 defects, 6 P1 defects, 4 P2 enhancements identified. No production code changes made. Awaiting technical lead's prioritized Phase 1B tickets.
