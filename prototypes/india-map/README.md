# India Map Prototype — AllDeputations

Local-only, mock-data reproduction of the SarvaLinks India-map experience.

## Quickstart

```bash
cd D:/claude/Deputation/prototypes/india-map
python3 -m http.server 8765
# Open: http://localhost:8765
```

To stop the server, find the python process and kill it, or `Ctrl+C` if foregrounded.

## File structure

```
prototypes/india-map/
├── index.html          # Entry point
├── css/main.css        # All styles (dark/gold theme)
├── js/
│   ├── app.js          # Main application: rendering, navigation, zoom, filters
│   ├── map-provider.js # Data layer: mock listings, aggregation, filter logic
│   └── state-geo.js    # State name ↔ abbreviation mapping
├── fixtures/
│   ├── mock-data.js    # Deterministic sample listings (17 items)
│   └── states.json     # Abbreviations + names + bounds (35 states/UTs)
├── geo/
│   └── india-states.geojson  # State boundaries (geohacker/india, 35 features)
├── districts/
│   ├── MH.geojson      # 36 synthetic Maharashtra district polygons
│   ├── DL.geojson      # 11 synthetic Delhi district polygons
│   └── generate-mh.js  # Generator script for synthetic districts
├── screenshots/final/  # Desktop, tablet, mobile captures
├── README.md
└── SCENARIO.md         # Fixture scenarios and coverage notes
```

## Tested scenarios

| Scenario | Description |
|---|---|
| Populated | 17 mock listings across 11 states |
| Empty | `SCENARIO = "empty"` in mock-data.js — all counts zero |

## Map-data sources

| Data | Source | License |
|---|---|---|
| State boundaries | `geohacker/india-state-geojson` (GitHub) | Public domain |
| District polygons | Synthetic hexagonal patterns | Prototype-only |
| Mock listings | Hand-written fixture in `mock-data.js` | None (demo data) |

## Known limitations

- District geometry is **synthetic hexagons**, not real boundaries. Real data from data.gov.in should replace.
- District drill-down limited to Maharashtra (MH) and Delhi (DL) which have synthetic district data.
- Other 9 states show listing cards instead of district polygons.
- Functional/Industrial View buttons are disabled (prototype scope).
- Login, menu, Campus Recruitment, Entrance Exam exchanges are disabled.
- Scroll/wheel zoom not implemented (only +/−/reset buttons and drag pan).
- No accessibility screen-reader test performed.

## What was NOT touched

- Production homepage: `index.html`, `js/site-widgets.js`, `js/upcoming-projects.js`
- Database / Supabase config
- Worker scripts in `/workers/`
- Any non-prototype file
