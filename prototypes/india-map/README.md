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
js/app.js           — Main app: rendering, navigation, filters, tooltips, zoom, events
js/app.js           — Card-grid views (Functional/Industrial) with grouping by function and qualification
js/map-provider.js  — Data provider: aggregation, dedup, filtering, district queries
js/state-geo.js     — State/abbr mappings, district aliases
css/main.css        — Layout, map styles, tooltip, drawer, card-grid views, responsive
fixtures/mock-data.js — 21 deterministic listings across 7 states with function/qualification fields
index.html          — App shell + card-view container
tests/              — 25 Playwright tests (7 files)
README.md           — This file
SCENARIO.md         — Populated/empty scenario notes
GEOGRAPHY.md        — Geometry provenance manifest
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

25 passed, 0 failed
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

## Known limitations

1. **District geometry**: Only Maharashtra (35 districts) is implemented with real GeoJSON. Other states fall back to state-level view. Full India district geometry requires adding ~680 more GeoJSON files.
2. **Functional/Industrial views**: Placeholder buttons (coming soon).
3. **Search**: Not implemented in prototype (brief deferred to P2).
4. **Real data integration**: Provider boundary defined in `map-provider.js` — replace `init()` data source to connect Supabase.
5. **Responsive mobile**: CSS breakpoints defined; touch pan via SVG events works, but results panel is desktop-first.
6. **Performance**: No virtualization for large result sets (prototype uses 17 listings).
