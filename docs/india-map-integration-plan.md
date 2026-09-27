# India Map Integration Plan — alldeputations.com

**Branch:** `prototype/india-map` → merge into `main`
**Date:** 2026-09-27
**Status:** Planning

---

## 1. Goal

Integrate the India map prototype as the **second page** of alldeputations.com, reached from the Home page. The result must be:

- A seamless, production-grade navigation experience (no jarring page reload)
- Visually stunning — modern 2026 design language, glassmorphism, fluid animations
- Performant — 60fps on mid-range devices, graceful degradation
- Data-driven — live Supabase vacancy counts rendered choropleth-style on each state
- Accessible — keyboard navigation, screen-reader labels, reduced-motion respect

---

## 2. Current State

### What exists
- **Prototype branch** (`prototype/india-map`): Full standalone `india-map.html` with:
  - SVG India map rendered from GeoJSON (`india-states.geojson`)
  - District drill-down via `india-districts-all.geojson`
  - Cinematic viewBox zoom transitions (600ms easeOutCubic)
  - Particle canvas burst effects on state click
  - Aurora background canvas
  - HUD bar (Map / Functional / Education view toggles, Filter button, Zoom controls)
  - Back button, summary card (top-right glass panel)
  - Filter drawer (left slide-in)
  - Bottom results sheet with vacancy cards
  - Liquid Glass CSS integration (`lg-surface` classes)
  - Supabase data provider (`map-provider.js`) with `getData()`, `getListingsForDistrict()`

- **Production site** (`main`): Full deputation dashboard at alldeputations.com with:
  - Shared top navigation (`.top-nav`) in `navbar.css`
  - Liquid Glass engine (`liquid-glass.css` + `liquid-glass.js`)
  - Supabase auth, vacancy listings, semantic search, bookmarks
  - Responsive layout with sidebar filters, KPI cards

### Known Issues Found
1. **Stage height = 0**: Overlay elements (`.ad-summary`, `.ad-hud`, etc.) are `position: fixed` in CSS but `liquid-glass.css` overrides to `position: relative` via `.lg-on .lg-surface` (specificity 0,2,0 > 0,1,0). This makes them participate in flex flow, consuming all `.ad-page` height and leaving `.ad-map-stage` at 0px.
2. **28 of 36 state paths have `null` d attribute**: The GeoJSON → SVG projection is producing empty paths for most states. The national view only renders ~8 valid state shapes.
3. **`lg-on` class not on `<html>` in production**: The prototype sets `<html class="lg-on lg-fx lg-refract">` but production pages may not. Need to verify.
4. **Filter drawer height in flex**: When `position: relative` wins, the drawer takes 1009px in flex layout.

---

## 3. Architecture

### Navigation Flow
```
Home (index.html)
  └─ Click "India Map" nav link
      └─ SPA transition → Map page enters
          ├─ Aurora canvas fades in (1.2s)
          ├─ Map SVG scales up from 0.95 → 1 (0.8s)
          └─ HUD + summary slide in (0.5s stagger)
```

### File Structure
```
/
├── index.html                    # Home page (unchanged)
├── india-map.html                # NEW: Map page (replaces prototype)
├── navbar.css                    # Shared nav (add India Map link)
├── liquid-glass.css              # Shared glass engine
├── liquid-glass.js               # Shared glass engine
├── css/
│   └── india-map/
│       ├── main.css              # All map page styles
│       └── animations.css        # Page transitions, micro-interactions
├── js/
│   ├── india-map/
│   │   ├── app.js               # Entry point (init, routing, resize)
│   │   ├── map-view.js          # SVG rendering, zoom, drill-down
│   │   ├── map-provider.js      # Data layer (Supabase)
│   │   ├── particles.js         # Particle system
│   │   ├── state-geo.js         # State code mappings
│   │   └── views/               # Future: card views, etc.
│   └── main.js                  # Shared utilities
├── geo/
│   ├── india-states.geojson     # State boundaries
│   └── india-districts-all.geojson # District boundaries
└── assets/
    └── brand/
        └── v2-logo.png          # Already exists
```

### Layout Model
```
┌─────────────────────────────────────────────────┐
│ .top-nav (66px, sticky, glass)                   │
│ [V² logo] [Home] [India Map★] [Rules] ...       │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌──────┐                          ┌─────────┐ │
│  │Back  │                          │Summary  │ │
│  │Btn   │     FULL-VIEWPORT       │Card     │ │
│  │(fix) │     MAP STAGE           │(fix)    │ │
│  │      │     (flex: 1)           │(fix)    │ │
│  │      │                          │         │ │
│  │      │    [India Map SVG]      │  135    │ │
│  │      │    with particles       │ active  │ │
│  │      │    and aurora bg        │ vacs    │ │
│  └──────┘                          └─────────┘ │
│                                                 │
├─────────────────────────────────────────────────┤
│ .ad-hud (52px, fixed bottom, glass)             │
│ [Map|Functional|Education] | Filter | [−][+][⟲] │
└─────────────────────────────────────────────────┘
```

Key principle: **All overlays are `position: fixed` and live as direct children of `<body>`**, never inside `.ad-page`. This is the only way to prevent `liquid-glass.css` from overriding their positioning.

---

## 4. Data Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Supabase     │     │ vacancies    │     │ map-view.js  │
│ Database     │────▶│ .json        │────▶│              │
│              │     │ (cron daily) │     │ renderNationalMap()  │
│ - vacancies  │     │              │     │   stateCounts[abbr]  │
│ - districts  │     │ Bundled with │     │   → choropleth color  │
│ - states     │     │ page as      │     │                      │
│              │     │ fallback     │     │ onStateClick(abbr):  │
└──────────────┘     └──────────────┘     │   → particle burst    │
                                           │   → cinematic zoom   │
┌──────────────┐     ┌──────────────┐     │   → render districts │
│ districts-   │     │ districts-   │     │   → bottom sheet     │
│ all.geojson  │────▶│ all.geojson  │────▶│   → card results     │
│ (lazy load)  │     │ (fetch on    │     └──────────────────────┘
│              │     │  drill-down) │
└──────────────┘     └──────────────┘
```

### Data Loading Strategy
1. **Initial load**: `vacancies.json` is bundled with the HTML (generated by daily cron). No network needed for first paint.
2. **State counts**: Derived from `vacancies.json` → `stateCounts[abbr]` → SVG fill color.
3. **District drill-down**: `districts-all.geojson` fetched on first state click (~200KB, cached by browser).
4. **Listings for district**: `getListingsForDistrict(districtName)` queries Supabase RPC → rendered in bottom sheet.

---

## 5. Visual Design System

### Color Palette
```css
--bg-deep:      #050a14;     /* Near-black with blue tint */
--bg-surface:   #0a1628;     /* Card/panel backgrounds */
--primary:      #22d3ee;     /* Cyan — primary actions, hover */
--accent:       #a78bfa;     /* Purple — secondary, active states */
--warm:         #f5a721;     /* Gold — highlights, data viz */
--text-primary: #f1f5f9;     /* Near-white */
--text-secondary: #94a3b8;  /* Muted labels */
--border:       rgba(255,255,255,0.08);
--border-hi:    rgba(255,255,255,0.18);
```

### Choropleth Scale (vacancy intensity)
```
0 vacancies  → fill: rgba(15,23,42,0.4) stroke: rgba(255,255,255,0.06)
1-10         → fill: rgba(34,211,238,0.15) stroke: rgba(34,211,238,0.3)
11-50        → fill: rgba(34,211,238,0.35) stroke: rgba(34,211,238,0.5)
51-200       → fill: rgba(167,139,250,0.4) stroke: rgba(167,139,250,0.6)
200+         → fill: rgba(245,167,35,0.5) stroke: rgba(245,167,35,0.8)
```

### Typography
- **Headings**: Sora (600/700/800) — modern geometric sans
- **Body**: Plus Jakarta Sans (400/500/600) — highly legible
- **Data/Numbers**: Tabular figures, tight tracking

---

## 6. Animation System

### Page Entrance (never seen before)
```
Phase 0 (0ms):        Body darkens, aurora begins flowing
Phase 1 (200ms):      Map SVG fades in + scales from 0.92 → 1.0 (800ms, spring easing)
Phase 2 (400ms):      State paths draw in sequentially (stroke-dashoffset, 30ms stagger per state)
Phase 3 (600ms):      Particles emerge from state centroids (burst outward, 600ms)
Phase 4 (800ms):      HUD slides up from bottom (400ms, easeOutBack)
Phase 5 (1000ms):     Summary card fades in + slides from right (500ms)
Phase 6 (1200ms):      Back button appears (300ms)
```

### State Hover
```
- Fill brightens 20%
- Stroke glow increases (filter: drop-shadow)
- Neighbor states dim 15%
- Tooltip follows cursor (glass pill with state name + count)
- Particle count subtly rises around hovered state
```

### State Click / Drill-Down
```
1. Click point: particle burst (70 particles, 600ms)
2. Unselected states: fade to 30% opacity (300ms)
3. Selected state: pulse glow ring (800ms, 3 pulses)
4. Camera: viewBox zooms to state centroid (600ms, easeOutCubic)
5. Districts fade in sequentially (50ms stagger, 400ms total)
6. HUD: view-toggle updates to show "Districts"
7. Bottom sheet: slides up with district listings
```

### Micro-interactions
- **Filter drawer**: Spring-eased slide from left (cubic-bezier(0.34, 1.56, 0.64, 1))
- **Zoom buttons**: Scale bounce on click (1 → 0.85 → 1.1 → 1, 300ms)
- **View toggle**: Active pill slides between buttons (transform: translateX, 300ms)
- **Cards in sheet**: Staggered entrance (translateY(20px) → 0, 50ms stagger)
- **Empty state**: Gentle float animation (translateY(-8px) oscillation, 3s loop)

### Performance Budget
| Element | Target | Budget |
|---------|--------|--------|
| Map SVG render | < 50ms | 100ms |
| Particle burst | 60fps | 30 particles max |
| Aurora canvas | 30fps (requestIdleCallback) | 50% CPU |
| GeoJSON parse | < 200ms | 500ms |
| Total page load | < 1.5s | 3s |
| ViewBox animation | 60fps | rAF driven |

---

## 7. Technical Implementation

### Phase 1: Fix Foundation (Day 1)

**Fix 1: Overlay positioning**
- Move all fixed-position overlays outside `.ad-page` in HTML
- OR: Add `!important` to `position: fixed` rules in india-map CSS
- Preferred: restructure HTML so overlays are `<body>` children

**Fix 2: GeoJSON projection**
- Debug why 28/36 states have null paths
- Verify `computeProjection()` receives valid features
- Check `createPath()` geometry handling
- Add fallback: if projection fails, use hardcoded census bounds

**Fix 3: Verify lg-on class**
- Check production pages for `<html class="lg-on">`
- If missing, add via JS on load or via server-side template

### Phase 2: SPA Integration (Day 2-3)

**A. Navigation**
1. Add `india-map.html` route in server config
2. Add "India Map" link to `.nav-links` in navbar (already exists in prototype)
3. Set `aria-current="page"` when on map page
4. Add page-transition CSS class to `<html>` on route change

**B. Shared Components**
1. Extract `top-nav` into server-side include (if not already)
2. Ensure navbar JS (mobile menu, data-updated badge) initializes on map page
3. Liquid Glass engine must re-init after map page enters (overlays have different z-stacking)

**C. Data Pipeline**
1. Create `data/vacancies.json` generator (Python script, run daily via cron)
2. Each vacancy gets: `id`, `title`, `ministry`, `location`, `state_abbr`, `district`, `status`, `closing_date`, `grade`, `url`
3. Supabase RPC: `get_state_counts()` → `{ MH: 42, DL: 28, ... }`
4. Supabase RPC: `get_listings_for_district(district)` → vacancy rows

**D. Responsive Behavior**
- Desktop (>1024px): Full experience, HUD visible, summary card top-right
- Tablet (768-1024px): HUD compressed (icon-only), summary below HUD
- Mobile (<768px): HUD becomes bottom tab bar, summary hidden (tap state for count), filter drawer full-width

### Phase 3: Polish & Launch (Day 4-5)

**A. Animations**
- Implement page entrance choreography (Phase 6 in Section 6)
- Add spring easing to all transitions
- Implement `prefers-reduced-motion` media query → disable animations

**B. Accessibility**
- All SVG states: `role="button"`, `tabindex="0"`, `aria-label="Maharashtra, 42 active vacancies"`
- Focus ring: 2px cyan outline offset 2px
- Keyboard: Tab through states, Enter to drill down, Escape to go back
- Screen reader: Live region for count updates

**C. Error States**
- GeoJSON load failure → show error text in map center
- Supabase connection failure → use bundled vacancies.json, show "Offline mode" badge
- Empty state → animated illustration + "Check back soon" message

**D. Performance**
- Lazy-load districts GeoJSON (only on first drill-down)
- Use `will-change: transform` on animated elements
- Throttle particle system to 30fps on mobile
- Compress GeoJSON with `geojson-precision` (5 decimal places → ~40% smaller)

---

## 8. Rollout Sequence

```
Commit 1: Fix overlay layout + GeoJSON projection
  └─ Push → smoke test → verify map renders 36 states

Commit 2: Add india-map.html as standalone page
  └─ Push → verify at /india-map.html
  └─ Nav link works from home page

Commit 3: Wire Supabase data → choropleth colors
  └─ Push → verify state counts match dashboard

Commit 4: Enable drill-down + bottom sheet
  └─ Push → click state → districts render → sheet opens

Commit 5: Add page entrance animations
  └─ Push → verify entrance sequence, reduced-motion

Commit 6: Responsive polish + a11y audit
  └─ Push → test on mobile, keyboard nav, screen reader

Commit 7: Production deploy
  └─ Merge to main → deploy to alldeputations.com
  └─ Verify analytics, error monitoring
```

---

## 9. What Makes This World-Class

1. **Cinematic entrance**: Not a static page load — a choreographed sequence that tells a story
2. **Particle physics**: Real burst effects on interaction, not CSS-only hacks
3. **Fluid zoom**: Smooth viewBox transitions with spring physics, not linear interpolation
4. **Glass morphism**: Every panel is a real optical glass surface with refraction, not a blur hack
5. **Data storytelling**: The map breathes — vacancy density visualized as living color
6. **Micro-interactions**: Every button, toggle, and card has personality
7. **Progressive disclosure**: National → state → district → listing, each layer reveals naturally
8. **Performance-first**: 60fps animations, lazy loading, graceful degradation

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| GeoJSON too large (>500KB) | High | High | Simplify to 5 decimal places, consider TopoJSON |
| Liquid Glass conflicts | Medium | High | Test all `lg-surface` elements on map page |
| Mobile performance | Medium | Medium | Throttle particles, simplify aurora on mobile |
| Supabase latency from India | Low | Medium | Bundle vacancies.json, show stale-data badge |
| District drill-down memory | Low | Low | Release GeoJSON after drill-up |
| z-index wars with navbar | Medium | Low | Document z-index scale in CSS |

---

## 11. Open Questions

1. **Should the map page replace the current vacancy list entirely, or coexist?**
   → Recommendation: Replace. The map IS the vacancy list — drill down to see cards.

2. **Should "Functional" and "Education" views be built now or later?**
   → Recommendation: Later (P2). Map view is the hero; card views are P2.

3. **How often does vacancies.json refresh?**
   → Recommendation: Daily at 4:30 AM IST (same as CI schedule).

4. **Should we use WebGL (Deck.gl) instead of SVG for the map?**
   → Recommendation: SVG is correct for this use case. 36 states is small enough for SVG, and SVG gives us crisp text labels, CSS transitions, and accessibility for free. WebGL adds complexity without visible benefit at this data density.

---

*Next step: Get user approval on this plan, then begin Phase 1 implementation.*
