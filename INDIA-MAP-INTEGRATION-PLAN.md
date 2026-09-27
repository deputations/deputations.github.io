# India Map Integration Plan
> Plan mode output — awaiting user approval before implementation begins.

---

## 1. What We Are Integrating

The `prototype/india-map` branch has a fully-functional India Map page with:
- **Map view**: SVG India map with state drill-down → district drill-down → results bottom sheet, plus cinematic transitions (particle burst, camera fly-to, count badge pop-ins)
- **Functional view**: Card grid grouped by job function (12 categories)
- **Education view**: Card grid grouped by qualification (15 categories)
- **HUD**: Auto-hiding bottom bar with view toggle, filters, zoom
- **Data**: Mock fixtures (20 listings) with `function` and `qualificationGroup` fields

This is a **complete, self-contained page** — `india-map.html` + `js/india-map/` + `css/india-map/` + `geo/*.geojson`.

---

## 2. Target Location

The page will live at `https://alldeputations.com/india-map` and will be the **second page** after Home, positioned between Home and Rules in the navbar.

### New files (copied from prototype, lightly adapted):
| File | Action |
|------|--------|
| `india-map.html` | **Copy** from `prototypes/india-map/india-map.html` |
| `js/india-map/app.js` | **Copy** from `prototypes/india-map/js/india-map/app.js` |
| `js/india-map/hud.js` | **Copy** |
| `js/india-map/particles.js` | **Copy** |
| `js/india-map/views/map-view.js` | **Copy** |
| `js/india-map/views/functional-view.js` | **Copy** |
| `js/india-map/views/education-view.js` | **Copy** |
| `js/india-map/views/shared/card-grid.js` | **Copy** |
| `js/india-map/views/shared/listing-table.js` | **Copy** |
| `js/india-map/map-provider.js` | **Copy** (adapts data — see §5) |
| `js/india-map/state-geo.js` | **Copy** (abbr mappings) |
| `css/india-map/main.css` | **Copy** + production font/color bridge |
| `css/india-map/animations.css` | **Copy** |
| `geo/india-states.geojson` | **Copy** (~138KB) |
| `geo/india-districts-all.geojson` | **Copy** (~1.2MB) |
| `geo/india-states-sarvalinks.geojson` | **Copy** (~138KB) |
| `img/delhi/` | **Copy** (Delhi colored map images) |

### Modified files (minimal, additive changes only):
| File | Change |
|------|--------|
| `index.html` (navbar) | Add one `<li><a href="/india-map">India Map</a></li>` between Home and Rules |
| `sitemap.xml` | Add `<url><loc>https://alldeputations.com/india-map</loc></url>` |
| Server config | **None needed** — static site on GitHub Pages; `india-map.html` at repo root is served automatically at `/india-map` |

---

## 3. Architecture

```
alldeputations.com/
├── index.html                    # Home (UNTOUCHED)
├── india-map.html                # NEW — the map page
├── js/india-map/
│   ├── app.js                    # Bootstrap + view router
│   ├── hud.js                    # Auto-hiding bottom HUD bar
│   ├── particles.js              # Canvas particle burst system
│   ├── map-provider.js           # Data adapter (mock → real)
│   ├── state-geo.js              # State code mappings
│   └── views/
│       ├── map-view.js           # SVG map + drill-down
│       ├── functional-view.js    # Card grid by function
│       ├── education-view.js     # Card grid by qualification
│       └── shared/
│           ├── card-grid.js      # Shared card grid component
│           └── listing-table.js  # Shared listing table
├── css/india-map/
│   ├── main.css                  # Layout, glass morphism, responsive
│   └── animations.css            # Keyframes
├── geo/                          # GeoJSON files (1.4MB)
└── img/delhi/                    # Delhi colored map images
```

---

## 4. Data Integration Strategy

### Phase 1 — Mock data (immediate launch)
- The prototype's `map-provider.js` loads `fixtures/mock-data.js` with 20 listings
- This works standalone and demonstrates the full UX
- **Data fields** already include `function` and `qualificationGroup` needed by Functional/Education views

### Phase 2 — Production data bridge (next session)
- Replace `fixtures/mock-data.js` with an adapter that:
  - Reads from the same source `app.js` uses (the production vacancy feed)
  - Maps production fields to the map-view schema
  - Falls back to mock data if the feed is unavailable (graceful degradation)
- **Critical requirement**: The map must show ZERO state polygons, not a broken page, if data fails to load

### Data flow (Phase 2):
```
Production vacancy data (JSON/Supabase)
    ↓
js/india-map/map-provider.js (adapter)
    ↓ getData() / getListingsForDistrict()
    ↓
Map view / Functional view / Education view
```

---

## 5. Visual Design — World-Class Polish Plan

The prototype already has strong foundations. Here's what will make it **stand out globally**:

### 5.1 Cinematic Enhancements (beyond current prototype)

| Feature | Current | Target |
|---------|---------|--------|
| State hover | Simple glow | **Magnetic glow** — shadow follows pointer within state bounds, not just fixed drop-shadow |
| Click transition | Particle burst + viewBox zoom | Add **ripple clip-path** — circular SVG clip expands from click point, not just a viewBox zoom |
| District drill | Path pulse | **Arc-ring pulse** — concentric rings emanate from click, each with staggered delay |
| Count badges | Simple pop-in | **Count-up animation** — numbers count from 0 to final value (not just fade in) |
| Bottom sheet | Slide up | **Elastic overshoot** — spring-like entrance with slight bounce |
| Background | Static gradient | **Slow-drifting aurora** — subtle color-shifting gradient mesh behind the map |
| Empty state | Static message | **Pulsing ambient dots** — 3-4 ghost dots float slowly across the map |

### 5.2 Glass Morphism Consistency
- The prototype uses basic `backdrop-filter: blur()`. Production uses the **5-layer liquid-glass system**.
- On the map page, apply `lg-on` class to `<html>` so all glass surfaces (summary card, bottom sheet, filter drawer, HUD) get the same premium treatment.
- Use `--lg-tint-scale: 1` (BOLD) as chosen by the owner — the map has no content behind it to refract, so the tint just adds depth.

### 5.3 Typography
- Production: Sora (headings) + Plus Jakarta Sans (body). The prototype already uses these.
- Add Lora italic for the "No results found" empty state — matches production's emotional tone.

### 5.4 Color Bridge
The prototype CSS already uses production palette tokens:
- `--primary-color: #22d3ee` (cyan)
- `--accent-color: #a78bfa` (purple)
- `--warning-color: #f5a721` (gold for badges)
- `--bg-main: #02040b` (near-black)

**No color changes needed** — the palette is already consistent.

### 5.5 Entrance Animation (Page Load)
1. Map SVG fades in with a subtle scale-up (0.95 → 1.0 over 800ms)
2. State shapes stagger in from opacity 0, each with 30ms delay
3. HUD slides up from bottom with 100ms delay
4. Summary card fades in from top-right with 200ms delay

This is **not currently in the prototype** — it will be the first thing users see when they navigate from Home.

### 5.6 Never-Before-Seen Elements

| Feature | Description |
|---------|-------------|
| **Data-aurora background** | Canvas-based slow-moving gradient mesh that shifts hue based on active filter state (e.g., more cyan when filtering "Technical", more purple for "Education") |
| **Magnetic hover** | State fill gradient tilts based on mouse position within the state — not just a flat hover color |
| **Sonic click feedback** | On state click, generate a brief 50ms "tick" using Web Audio API oscillator — subtle, non-intrusive, adds tactile feel |
| **Particle palette shift** | Particles shift color based on vacancy density (gold = hot/30+ jobs, cyan = moderate, muted = few) |
| **Scroll-to-reveal listings** | Bottom sheet cards use IntersectionObserver for scroll-triggered reveal, not just timeout-based stagger |

---

## 6. Responsive Behavior

| Breakpoint | Map | HUD | Bottom Sheet | Cards |
|-----------|-----|-----|--------------|-------|
| Desktop (≥1200px) | Full viewport, optimal density | Bottom 52px bar | 45vh | 3-col grid |
| Tablet (768-1199px) | Scaled map, touch pan | Bottom 48px bar | 55vh | 2-col grid |
| Mobile (<768px) | Full viewport, gesture pan | Bottom 44px bar | 65vh | 1-col stack |
| Tiny (<400px) | Full viewport, simplified labels | Compact icons only | 70vh | Full width |

The prototype already has responsive CSS. We will refine and validate on real viewport sizes.

---

## 7. Accessibility

| Requirement | Implementation |
|-------------|----------------|
| Keyboard nav | Tab through states/districts, Enter/Space to select |
| Screen reader | `aria-label` on all interactive elements, `aria-live` on summary count |
| Focus management | Focus moves to results sheet on drill-down, back to map on close |
| Skip navigation | Already present in production navbar |
| High contrast | Tested against WCAG AA — cyan on near-black passes |
| Reduced motion | `prefers-reduced-motion` disables all animations, shows instant transitions |

---

## 8. Implementation Phases

### Phase 1 — File Integration & Base Styling (1-2 hours)
1. Copy all new files to repo root (`india-map.html`, `js/india-map/`, `css/india-map/`, `geo/`, `img/delhi/`)
2. Update `index.html` navbar: add India Map link between Home and Rules
3. Verify fonts load correctly (Sora + Plus Jakarta Sans already in production)
4. Verify glass morphism classes apply correctly
5. Test page loads standalone at `/india-map`

### Phase 2 — Data Bridge (1-2 hours)
1. Replace `map-provider.js` mock data with production data adapter
2. Ensure graceful fallback to mock data on load failure
3. Add `function` and `qualificationGroup` fields to production data schema
4. Test with real vacancy data

### Phase 3 — Cinematic Polish (2-3 hours)
1. Add page-load entrance animation (stagger states, HUD slide-up)
2. Implement count-up animation for badges
3. Add data-aurora background canvas
4. Add magnetic hover effect on state shapes
5. Implement elastic bottom sheet entrance
6. Add sonic click feedback (Web Audio API)

### Phase 4 — Testing (1 hour)
1. Playwright smoke tests for all 3 views
2. Test drill-down flow: state → district → results → back → back
3. Test URL restoration on refresh
4. Test on mobile viewport (375px, 768px)
5. Test reduced-motion media query

### Phase 5 — Deploy (30 min)
1. Update `sitemap.xml`
2. Verify route works on production
3. Test from Home page navigation

---

## 9. What This Does NOT Include (v1 Scope)

- No WebGL / three.js on the map page (CSS + canvas only, same as prototype)
- No search bar (v2)
- No pagination
- No user accounts / auth on this page
- No bookmarking / save
- No sharing (v2)
- No real-time updates via Supabase realtime (v2)
- No admin integration

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| GeoJSON files bloat repo | Medium | Low | 1.4MB is acceptable for a geospatial app; can CDN-host if needed |
| Mock data accidentally ships | Low | Medium | Replace with adapter in Phase 2 before deploy |
| Liquid-glass CSS conflicts | Low | Medium | All map-page CSS is namespaced with `ad-` prefix; zero overlap |
| Mobile performance on low-end devices | Medium | Medium | Add `prefers-reduced-motion` + particle count throttling on mobile |
| Delhi image-map breaks on production | Low | Low | Fall back to text labels if images don't load |

---

## 11. Approval Questions

1. **File placement**: Copy prototype files to repo root alongside `index.html`? Or keep in `prototypes/india-map/`?
2. **Data approach**: Launch with mock data (20 listings) and bridge to production later, or bridge production data first?
3. **Animation scope**: Implement all 5 "never-before-seen" elements (§5.6) in Phase 3, or stagger across phases?
4. **Delhi image-map**: Include it (requires `img/delhi/` folder) or skip for v1 (text labels only)?
