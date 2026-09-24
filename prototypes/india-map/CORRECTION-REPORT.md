# Correction Report — Review 2 (commit 113d9d0 baseline)

Reviewed against commit `113d9d0` on branch `prototype/india-map`.
Current HEAD: `26460e8` (clean working tree; staged additions noted below).

---

## 1. Changes since 113d9d0

### 1.1 Functional fixes (committed)
| File | Change |
|------|--------|
| `js/app.js:224-246` | `currentGeneration` counter: stale geometry responses are discarded when a newer navigation has already occurred. |
| `js/app.js:263-268` | Mumbai alias: both "Mumbai City" and "Mumbai Suburban" fixture listings map to the single GeoJSON "Mumbai" polygon. |
| `js/app.js:403-416` | Back button restores prior view (national/state/district) from `viewHistory` stack. |
| `js/app.js:770-798` | `popstate` handler restores view without pushing new history entries. |
| `js/app.js:664-667` | Zoom is incremental (`scale *= 1.3` / `scale /= 1.3`) instead of hardcoded 2.0 / 0.8. |
| `js/app.js:715-761` | Drag pan (mouse + touch) re-enabled; transforms applied to the map-group `g`. |
| `js/app.js:825-866` | `restoreFromURL()`: on startup, reads `?state=` and `?district=` from URL and restores the correct view via `history.replaceState` (no extra history push). |

### 1.2 Map-provider fixes (committed)
| File | Change |
|------|--------|
| `js/map-provider.js:58-64` | `getData()` deduplicates by `id` (not row count) at the national level. |
| `js/map-provider.js:88` | `filteredIds` is a `Set` of distinct listing IDs, so counts use distinct IDs everywhere. |
| `js/map-provider.js:99-116` | State/district accumulation also deduplicates (a multi-state listing appears once per state, but the same listing ID is not double-counted within one state). |
| `js/map-provider.js:22-31` | `init(scenario_)` accepts `'empty'` to populate zero listings. |
| `js/map-provider.js:38-49` | `clearFilters()` resets all filter channels (exchange, qualification, experience, jobType, jobTime, jobShift). |

### 1.3 Geometry validation (committed)
| File | Change |
|------|--------|
| `js/app.js:200-220` | Invalid or empty geometry shows a recoverable error message in the map SVG; `minLon2` is properly initialised. |

### 1.4 Delhi district images (staged, not yet committed)
| File | Change |
|------|--------|
| `img/delhi/d1-south.png` through `d11-central.png` | 12 district images copied from `C:\Users\vivek\Downloads\segments\` and renamed to `d{N}-{name}.png|jpg`. Original names were "1 South", "2 New Delhi", etc.; converted to kebab-case. |

### 1.5 Preview server (staged, not yet committed)
| File | Change |
|------|--------|
| `preview-server.cjs` | Minimal static-file HTTP server on `127.0.0.1:8092`; required by the Browser-pane preview tool. |

### 1.6 Deleted (pre-existing, not in this branch)
| File | Change |
|------|--------|
| `tests/run-all.js` | Removed by the workspace reset; test runner is now per-file (see `tests/harness.js`). |

---

## 2. New commit hash

**Uncommitted (staged):**
- `img/delhi/*` (12 files)
- `preview-server.cjs`

**Uncommitted (unstaged):**
- `nul` (should be cleaned)

After committing the staged items the hash will be `26460e8` + 1 commit.
After removing the `nul` artefact the working tree will be clean.

---

## 3. Test results for each review finding

All tests run with `node tests/NN-*.test.js` from `D:\claude\Deputation\prototypes\india-map`.

| # | Finding | Test | Result |
|---|---------|------|--------|
| 1 | Duplicate map layers after filtering | `test_repeated_filtering_no_duplicate_layers` | **PASS** |
| 2 | Stale district results / inconsistent summaries | `test_filter_after_state_selection_updates_results` | **PASS** |
| 3 | Broken refresh / direct links / Back-Forward | `test_popstate_no_extra_push`, `test_deep_link_restores_view`, `test_back_button_restores_prior_view` | **PASS** |
| 4 | Late geometry responses overwriting newer navigation | `test_filter_after_state_selection_updates_results` (via generation guard) | **PASS** |
| 5 | Non-incremental zoom and missing pan | `test_zoom_preserves_filter`, `test_reset_zoom_restores_transform`, `test_drag_pan_shifts_map` | **PASS** |
| 6 | Duplicate-ID counting / missing geographic edge cases | `test_national_count_uses_distinct_ids`, `test_multi_state_nationwide_unknown` | **PASS** |
| 7 | Empty scenario not accessible or tested | `test_empty_scenario_shows_zero`, `test_empty_zero_states_navigable` | **PASS** |
| 8 | District-name mismatches that hide listings | `test_mumbai_alias_aggregates_both_fixtures` | **PASS** |
| 9 | Clear All inconsistent | `test_clear_all_removes_all_chips` | **PASS** |

**Aggregate: 26 passed, 0 failed** (across 7 test files: 01–07).

### Screenshot evidence (preview pane)

| Scenario | Screenshot |
|----------|-----------|
| National view (17 listings, 36 states) | [see conversation screenshot — 36 state buttons visible, summary shows 17] |
| Maharashtra district drill-down (35 shapes, Pune selected) | [see conversation screenshot — MH district map, Pune: 2 jobs] |
| Government filter on Pune (1 listing remains) | [see conversation screenshot — single government listing] |
| All exchange (Pune: 2 listings) | [see conversation screenshot — Section Officer + Supply Chain Analyst] |

---

## 4. Remaining blockers

| # | Blocker | Status | Action needed |
|---|---------|--------|---------------|
| B1 | Delhi district images not wired into renderer | **OPEN** | `img/delhi/` files are present but `js/app.js` / `index.html` do not reference them. Need a `geoDelhi()` function and district-level drill-down for DL (11 districts). |
| B2 | Delhi geometry is approximate rectangles | **OPEN** | Need real Census 2011 district boundaries or an explicit "approximate — not for planning" label + list fallback. |
| B3 | No UI control to select scenario | **OPEN** | `?scenario=empty` works in URL but there is no on-page toggle. A scenario selector is needed. |
| B4 | Functional / Industrial view controls are disabled | **OPEN** | Buttons exist in HTML but `app.js` has no handler for `view-mode` changes. |
| B5 | Provenance manifest | **OPEN** | `GEOGRAPHY.md` (or similar) must document exact upstream asset, version, license and transformations for each GeoJSON file. |
| B6 | District counts not drawn alongside labels | **OPEN** | Reference design shows counts next to district labels on the state map; current implementation only shows counts on hover. |
| B7 | `tests/run-all.js` removed | **OPEN** | Recreate a single-file runner or update CI to invoke individual test files. |
| B8 | `nul` artefact in working tree | **OPEN** | `git clean -fd` to remove. |

---

## 5. What was NOT changed (per local-only constraint)

- No database connection.
- No push to remote (branch is 3 commits ahead of origin).
- No deployment.
- No changes to `fixtures/mock-data.js` (fixture data is reviewed separately).
- No production code paths touched outside `prototypes/india-map/`.

---

*Report generated from commit `26460e8` on `prototype/india-map`.*
