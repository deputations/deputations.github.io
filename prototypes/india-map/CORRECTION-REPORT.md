# Correction Report — Review 2 Response

**Branch:** `prototype/india-map`
**Review baseline:** commit `113d9d0`
**Latest commit:** `5bbc016`
**All test results:** 32/32 passed (8 test files)

---

## 1. Changes since `113d9d0`

| Commit | Description |
|--------|-------------|
| `c10d7cb` | Bounds-aware zoom, back button fix, particles, navigation model |
| `1f1f5e1` | Particle visibility (gold palette), zoom smoothing |
| `7126eab` | Zoom fillFraction 0.85, smooth animation |
| `9be6c30` | Nationwide/unknown buckets, particle canvas reinit |
| `5bbc016` | Keyboard tooltip positioning, card view wiring |

### Key functional changes

**Bounds-aware fly-to** (`c10d7cb`, `7126eab`):
- `flyToBounds()` computes zoom from projected district bbox + 85% fill fraction
- Zoom now adapts to actual state size instead of fixed 1.8x
- Large states (MH 35 districts) fit viewport at ~1.45x
- Smooth animation via `animatePanZoom` easing (0.12 lerp factor)
- Edge districts (Raigad, Sindhudurg) no longer clipped

**Particle timing fix** (`c10d7cb`, `1f1f5e1`):
- Particles now spawn AFTER fly-to completes (2x rAF after `renderDistrictMap`)
- Burst at viewport center instead of click point
- Gold palette (hue 38-55) matching brand accent #f5a721
- Particle canvas reinitializes after innerHTML replacement in goNational/popstate

**Back button fix** (`c10d7cb`):
- Removed duplicate `goBack()` listener (was in both initHudAutoHide + wireEvents)
- Back button now single-source: wireEvents calls goBack()
- goBack() does district→state→national correctly without skipping levels
- popstate handles null state (initial page load = national view)

**History model** (`c10d7cb`):
- Every navigation pushState() with {view, state, district}
- restoreFromURL() on startup handles deep links
- Initial history.replaceState({view:'national'}) ensures history.back() always has target

**Crash prevention** (`c10d7cb`):
- currentGeneration guard prevents stale rAF after view change
- 2x rAF ensures map-group is in DOM before fly-to
- try/catch in fly-to rAF + null guards in animatePanZoom

**Nationwide/unknown buckets** (`9be6c30`):
- National view shows Nationwide + Unknown listing buckets in results
- Buckets render with category cards showing count + listings

**Keyboard accessibility** (`5bbc016`):
- moveTooltip handles keyboard focus (clientX=0) by anchoring to element rect
- Tab navigation shows tooltip positioned next to focused element

**Card view** (`5bbc016`):
- showCardView toggles map/summary/card visibility correctly
- Functional view groups by function category
- Industrial view groups by qualification group

---

## 2. Test Results

```
══ 01-rerender-cleanup.test.js ══ ✓✓ (2/2)
══ 02-filter-sync.test.js       ══ ✓✓✓ (3/3)
══ 03-history.test.js           ══ ✓✓✓✓ (4/4)
══ 04-async-geometry.test.js    ══ ✓✓ (2/2)
══ 05-zoom.test.js              ══ ✓✓ (2/2)
══ 06-distinct-ids.test.js      ══ ✓✓✓✓ (4/4)
══ 07-geography.test.js         ══ ✓✓✓✓✓✓✓✓ (8/8)
══ 08-tooltip.test.js           ══ ✓✓✓✓ (4/4)

32 passed, 0 failed
```

---

## 3. Remaining Items

| Item | Status | Notes |
|------|--------|-------|
| Mobile layout | Done | CSS @media (max-width: 768px) positions summary at bottom |
| District count labels | Done | Counts drawn on state map with staggered animation |
| Functional/Industrial view | Done | Wired to card view with category grouping |
| Nationwide/unknown buckets | Done | Rendered in national view results |
| Keyboard tooltip | Done | Anchors to element rect on focus |
| Geometry provenance | Done | GEOGRAPHY.md documents sources + licenses |
| README updated | Done | 132 listings, 8 test files, correct file list |
| Empty scenario test | Done | test 05-zoom covers empty scenario |

---

## 4. Screenshots

- `screenshots/national-view.png` — 135 total, all 36 states visible at zoom 1.0
- `screenshots/maharashtra-zoom.png` — MH drill-down at ~1.45x, all 35 districts visible
- `screenshots/pune-results.png` — Pune district drill-down with results panel
- `screenshots/test1-drilldown.png` — Drill-down test pass
- `screenshots/test2-back.png` — Back button test pass
- `screenshots/test3-deeplink.png` — Deep link test pass

---

## 5. Next Steps

1. Capture fresh screenshots with particle burst visible
2. Add tests/09-special-buckets.test.js for nationwide/unknown buckets
3. Mobile responsive testing on actual device viewport
4. Functional/Industrial view category card click-through tests
