# India Map Prototype — AllDeputations

Local-only, mock-data reproduction of the SarvaLinks India-map experience.

## Running

```bash
# From this directory:
python3 -m http.server 8765
# Then open: http://localhost:8765
```

Or from the project root:
```bash
cd D:/claude/Deputation/prototypes/india-map
python3 -m http.server 8765
```

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
│   └── mock-data.js    # Deterministic sample listings (17 items, mock data only)
├── geo/
│   └── india-states.geojson  # State boundaries (geohacker/india, 35 features)
├── districts/
│   ├── MH.geojson      # 36 synthetic Maharashtra district polygons
│   └── DL.geojson      # 11 synthetic Delhi district polygons
├── README.md
└── SCENARIO.md         # Fixture scenarios and coverage notes
```

## Tested scenarios

| Scenario | Description |
|---|---|
| Populated | 17 mock listings across 11 states + 1 multi-state + 1 nationwide + 1 unknown |
| Empty | `SCENARIO = "empty"` in mock-data.js — all counts zero |

## Known limitations

- District geometry is **synthetic hexagons**, not real boundaries. Real data from data.gov.in should replace.
- Some NE states (MN, ML, MZ, NL, AR, SK, TR) have no mock listings for testing.
- Functional/Industrial View buttons are disabled (prototype scope).
- Login, menu, Campus Recruitment, Entrance Exam exchanges are disabled.
- District drill-down is limited to Maharashtra (MH) and Delhi (DL) which have synthetic district data.
- Scroll/wheel zoom not yet implemented.
- No accessibility screen-reader test performed.
- Map interaction tested via Playwright screenshots at desktop/mobile viewports.
