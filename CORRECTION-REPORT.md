# Correction Report — India Map Deployment

**Date:** 2026-09-30
**Session:** main branch deploy to alldeputations.com

---

## Issue 1: Home Page Backgrounds Destroyed

**What happened:** Commits `df2246d` → `53bbaca` included `style.css` changes that replaced the animated background blobs (`.bg-shapes`, `.bg-wave`) with `display: none !important`.

**Impact:** Home page at `alldeputations.com` showed plain white background — no blobs, no wave animation.

**Root cause:** Feature branch `prototype/india-map` rewrote `style.css` with map CSS additions that included a "disabled for now" section killing backgrounds.

**Fix:** Restored `style.css` to commit `53bbaca` (last known good) via `git reset --hard 53bbaca` + force push.

**Prevention:** Map CSS must live in `india-map.css` (standalone file), never merged into `style.css`.

---

## Issue 2: Submodule Blocked Pages Deploy

**What happened:** `deputations.github.io` submodule was still registered in the repo, causing GitHub Pages builds to fail with `"status":"errored"` on the Checkout step.

**Impact:** Deploys to `alldeputations.com` silently failed — no new content reached production.

**Root cause:** The submodule reference was left in the repo from an earlier deployment strategy.

**Fix:** `git rm --cached deputations.github.io`, removed `.gitmodules`, committed and pushed.

**Prevention:** Verify `git ls-tree HEAD` has no submodule entries before pushing to main.

---

## Issue 3: Map Page Loaded Home Page Sections

**What happened:** `india-map.html` was built by copying `index.html` and adding map divs. The full home page layout (hero header, filters, stats, background blobs, scroll-progress, dialog) rendered above the map.

**Impact:** Map appeared as a small section in the middle of a full home page — completely wrong layout.

**Root cause:** `india-map.html` was not stripped down to a standalone page. It inherited all home page markup.

**Fix:** Rewrote `india-map.html` from scratch as a minimal standalone page:
- Top nav only (no hero, no filters, no stats)
- Map as `<main id="map-view">` taking full viewport
- Removed 119 lines of home page markup
- Added `body.map-entry` CSS in `india-map.css` to neutralize inherited styles

**Prevention:** Standalone pages must be built independently, not derived from `index.html`.

---

## Issue 4: CSS Leakage Between Pages

**What happened:** Map CSS (`.ad-state`, `#map-view`, `.map-tooltip`, etc.) was added to `style.css` on the feature branch. When deployed, these rules affected the home page.

**Impact:** Home page got unexpected styles from map CSS (potential layout shifts, invisible elements).

**Fix:** Extracted all map CSS into standalone `india-map.css`. Home page `style.css` has 0 diff with `origin/main`.

**Prevention:** All map styles go in `india-map.css` loaded only by `india-map.html`.

---

## Issue 5: Delhi Drill-Down Was Empty

**What happened:** Clicking Delhi on the national map tried to render district GeoJSON polygons, but Delhi's boundaries aren't in the GeoJSON data. Resulted in empty drill-down view.

**Impact:** Delhi (267 vacancies) showed as non-functional on drill-down.

**Fix:** Ported the prototype's image-map approach — 11 clickable hotspot buttons overlaid on `img/delhi/delhi-coloured.jpg`, each showing a district image on click.

**Status:** Fixed on `prototype/india-map` branch, not yet deployed to standalone page.

---

## Issue 6: `getData()` Tried to Access Private Variable

**What happened:** `getData()` in `india-map-view.js` accessed `window.IndiaMapData.stateCounts` directly, but `stateCounts` is private to the IIFE.

**Impact:** All states showed same color (amber) instead of gradient by vacancy count.

**Fix:** Added `getStateCounts()` public accessor in `india-map-data.js`, updated `getData()` to use it.

---

## Issue 7: Map Was Invisible (opacity: 0)

**What happened:** `#map-view` had `opacity: 0` for SPA fade-in animation. Even with `visible` class, the 0.2s transition delay kept it invisible on standalone page load.

**Fix:** Added `body.map-entry #map-view { opacity: 1; transform: none; transition: none; }` to neutralize SPA animation on standalone page.

---

## Issue 8: Map Was Never Auto-Initialized

**What happened:** `window.initIndiaMap()` was defined in `india-map-view.js` but never called on standalone page load (only triggered by SPA router on `index.html`).

**Impact:** Map page loaded completely blank.

**Fix:** Added auto-init code at bottom of `india-map-view.js` that calls `initIndiaMap()` on DOMContentLoaded.

---

## Summary

| # | Issue | Severity | Fixed? |
|---|-------|----------|--------|
| 1 | Home page backgrounds destroyed | HIGH | ✅ Restored |
| 2 | Submodule blocked deploy | HIGH | ✅ Removed |
| 3 | Map page had full home layout | HIGH | ✅ Rewrote |
| 4 | CSS leakage to home page | MEDIUM | ✅ Extracted |
| 5 | Delhi drill-down empty | MEDIUM | 🔄 In progress |
| 6 | Private variable access | MEDIUM | ✅ Fixed |
| 7 | Map invisible (opacity 0) | MEDIUM | ✅ Fixed |
| 8 | Map never initialized | HIGH | ✅ Fixed |

**Key lesson:** The standalone `india-map.html` must be built as an independent page with its own CSS file (`india-map.css`). Never inherit markup or styles from `index.html` / `style.css`.
