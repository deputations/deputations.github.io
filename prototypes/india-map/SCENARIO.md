# India Map Prototype — Scenario & Coverage Notes

## Populated scenario

The mock dataset contains **20 active listings** across 12 distinct geographic entities:

| Scope | Count | Notes |
|---|---|---|
| National (all active, distinct IDs) | 20 | Includes nationwide + unknown |
| Maharashtra (MH) | 7 | 6 single-state + 1 multi-state (MH,KA) |
| Delhi (DL) | 2 | Both in New Delhi district |
| Karnataka (KA) | 2 | 1 direct + 1 multi-state |
| Other states (one each) | 8 | AS, GJ, KL, RJ, TN, TS, UP, WB |
| Nationwide (`All India`) | 1 | Counted in national total only |
| Unknown location | 1 | Counted in national total only |
| Zero-count state | MZ | Mizoram has no listings |

### Counting rules (as implemented)

- **National count**: all active distinct listing IDs in the filtered set (20)
- **State count**: each listing counted once per state it references. Multi-state listings appear in each relevant state's count.
- **District count**: listings with a matching district in the selected state
- **Nationwide/unknown**: visible only in a dedicated bucket, not replicated into state totals

## Empty scenario

Set `SCENARIO = "empty"` in `fixtures/mock-data.js` to load zero listings.
All counts display 0; drill-down shows empty-state messaging.

## Known gaps vs reference

| Feature | Status |
|---|---|
| All India map with 35 states/UTs | Done |
| State hover tooltip | Done |
| State drill-down to districts | Done for MH (35) and DL (11 via image-map) |
| District drill-down to results | Done for MH and DL |
| Filter drawer (5 filters) | Done |
| Exchange selector (right rail) | Done (4 active, 3 disabled) |
| Zoom controls (+/−/reset) | Done (0.8–6 range, ×1.3) |
| Browser Back/Forward | Done (history.pushState) |
| Mobile responsive layout | Done |
| Keyboard navigation | Partial (Tab + Enter on states) |
| Functional view (card grid) | Done — groups by `function` field |
| Industrial view (card grid) | Done — groups by `qualificationGroup` field |
| Real district boundaries | Partial — MH and DL implemented |
| All 36 state/UT labels | 35 rendered (J&K+Ladakh merged in source data) |
| Wheel/scroll zoom | Not implemented |
| Accessible state list fallback | Not implemented |

## Fixture switching

Edit `SCENARIO` in `fixtures/mock-data.js`:
```js
export const SCENARIO = "empty";   // or "populated"
```

The provider re-reads this on each `init()` call. No restart needed for filter changes.
