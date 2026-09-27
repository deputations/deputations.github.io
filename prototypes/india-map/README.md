# India Map Prototype — Deliverable

## Local URL

**`http://127.0.0.1:8092/`**

Restart instructions:
```bash
cd D:\claude\Deputation\prototypes\india-map
npx playwright install chromium   # first time only
node tests/run-all.js            # starts server, runs tests, stops server
# Or for interactive viewing:
node -e "import { startServer } from './tests/harness.js'; startServer().then(() => console.log('Server at http://127.0.0.1:8092'))"
```

## Branch

`prototype/india-map` — isolated from main. Production files untouched.

## Changed files

```
js/app.js                        — Main app: rendering, navigation, filters, tooltips, zoom, events
js/india-map/app.js              — SVG map rendering, drill-down, district geometry loading
js/india-map/views/map-view.js   — National + state map rendering
js/india-map/views/functional-view.js — Functional category card grid
js/india-map/views/industrial-view.js  — Qualification group card grid
js/india-map/views/shared/card-grid.js  — Shared card grid component
js/india-map/views/shared/listing-table.js — Listing table component
js/india-map/particles.js        — Particle burst animation system
js/india-map/hud.js              — Heads-up display controls
js/map-provider.js               — Data provider: aggregation, dedup, filtering, district queries
js/state-geo.js                  — State/abbr mappings, district aliases
css/main.css                     — Layout, map styles, tooltip, drawer, card-grid views, responsive
fixtures/mock-data.js            — 132 listings across states with function/qualification fields
index.html                       — App shell + card-view container
tests/                           — 32 Playwright tests (8 files)
README.md                        — This file
SCENARIO.md                      — Populated/empty scenario notes
GEOGRAPHY.md                     — Geometry provenance manifest
```

## Test results

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

## Map-data sources and licenses

| Asset | Source | License |
|-------|--------|---------|
| `geo/india-states.geojson` | Natural Earth (1:50m) | Public Domain |
| `districts/*.geojson` | Derived from GADM v4 / DataMeet | CC-BY (check GADM license for redistribution) |

All geometry is stored locally under `geo/` and `districts/`. No external API calls at runtime.

## Confirmation: production and real data untouched

- No database connection (Supabase URL/key not referenced).
- Production homepage (`index.html` at repo root) unchanged.
- No `git push` or deploy executed.
- All work isolated under `prototypes/india-map/`.
- Mock data in `fixtures/mock-data.js` is synthetic, labeled "Sample data only".

## Verification checklist

| Check | Result |
|-------|--------|
| Filter + zoom — results update without rerender | ✓ (test 01-rerender-cleanup + 05-zoom) |
| popstate/Back/Forward — district restored | ✓ (test 03-history) |
| Stale district geometry does not overwrite newer nav | ✓ (test 04-async-geometry) |
| Empty scenario navigable | ✓ (test 06-distinct-ids) |
| Distinct IDs — nationwide/unknown not double-counted | ✓ (test 06-distinct-ids) |
| Delhi image-map with district hotspots | ✓ (test 07-geography) |
| DL district drill shows individual image | ✓ (test 07-geography) |
| Functional view card grid | ✓ (manual + committed) |
| Industrial view card grid | ✓ (manual + committed) |

## Known limitations

1. **District geometry**: Maharashtra (35 districts), Delhi (11 via image-map) implemented. Full India district geometry requires adding ~670 more GeoJSON files.
2. **Wheel/scroll zoom**: Not implemented (button controls only).
3. **Accessible state list fallback**: Not implemented — keyboard tab navigation works via SVG elements.
