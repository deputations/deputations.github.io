# India Map Integration Plan — alldeputations.com

**Status:** Planning (prototype verified working: 798 active vacancies, 36 states, drill-down functional)
**Target branch:** `main` → deploys to `www.alldeputations.com`
**Design direction:** World-class, 2026-grade, never-seen-before animation experience

---

## 1. What We're Integrating

### Source: `prototypes/india-map/india-map.html`
- Interactive SVG India map with all 36 states/UTs
- Real Supabase data pipeline (1000 vacancies loaded, normalised)
- State drill-down with zoom/pan
- Filters: Functional, Education, and extensible
- Particle canvas background
- 798 active vacancies (live count)

### Target: `alldeputations.com` (production `index.html`)
- Already has `<a href="/india-map">India Map</a>` in the nav (line 156)
- Liquid glass CSS, Plus Jakarta Sans / Sora / Unbounded fonts
- Hero wave canvas animation (`hero-wave.js`)
- Dark theme with `data-theme` attribute
- Shared `config.js`, `enrich.js`, `app.js` data layer

---

## 2. Architecture: One-Page App Transition (No Full Page Load)

**Decision: SPA-style transition from Home → India Map.**

Instead of a hard navigation to a separate page, the India Map becomes the *primary content experience* that replaces the home dashboard when the user clicks "India Map" in the nav. This enables:

- **Seamless transition animations** (home fades/transforms out, map animates in)
- **Shared state** (theme, filters, Supabase connection)
- **Breadcrumb navigation** ("← Back to Home" inside the map view)
- **URL routing** (`/india-map` serves the same page but initialises the map as the primary view)

### URL Strategy
| URL | Behavior |
|-----|----------|
| `/` or `/index.html` | Home dashboard (current) |
| `/india-map` | Map-only view (new — India map as primary content) |
| `/india-map?state=DL` | Deep link to Delhi drill-down |
| `/india-map?state=MH&district=Pune` | Deep link to district view |

### Implementation: Single `index.html` with View Switcher
```
index.html
├── <div id="home-view">         ... existing home dashboard ...
└── <div id="map-view" hidden>   ... India map (migrated from prototype) ...
```

A lightweight router in `app.js` toggles visibility based on `location.pathname`.

---

## 3. Design System: World-Class Animation Spec

### 3.1 Hero Transition (Home → Map)

**Concept: "The map materialises from the dashboard."**

1. **Phase 1 — Dismiss (0–400ms):** Home content fades + scales down (0.95) with a subtle blur. KPI cards scatter outward with staggered delays. The hero wave canvas dissolves into particles.
2. **Phase 2 — Morph (400–800ms):** A radial glow expands from center (brand gradient: cyan → purple → pink). The India map SVG paths draw themselves with `stroke-dashoffset` animation — each state traces its outline.
3. **Phase 3 — Settle (800–1200ms):** Particles coalesce into state boundaries. Count badges pop in with spring physics (overshoot + settle). Nav bar transitions to active "India Map" state with a glowing underline.

### 3.2 Map Animations (Never-Seen-Before)

#### A. Liquid State Fill
When data loads, each state doesn't just change color — it *fills like liquid pouring in*. Use SVG mask animation with a gradient that flows from south to north (following the monsoon wind direction metaphor). States with higher counts get deeper, more saturated fills.

#### B. Pulse Ripples on Count Change
When new vacancies arrive (real-time Supabase subscription), affected states emit a concentric ring ripple (like a sonar ping) that fades outward. Multiple simultaneous ripples create a beautiful interference pattern across the map.

#### C. Particle Constellation Background
Replace the current particle canvas with a **constellation network**: dots connected by faint lines, slowly drifting. When you hover a state, nearby particles accelerate toward it, creating a gravitational lens effect. This ties the background directly to user interaction.

#### D. Hover Micro-interactions
- State lifts slightly (SVG transform translateY(-2px) + shadow glow)
- Neighboring states dim to 30% opacity (spotlight effect)
- A tooltip card slides in with spring physics showing: state name, count, top ministries, closing-soon count
- The state outline pulses with a subtle glow matching the brand gradient

#### E. Drill-down Zoom (Cinematic)
When clicking a state:
1. Other states fade to 15% opacity
2. The selected state smoothly scales up (GSAP-style ease: `power3.inOut`)
3. Background particles swirl into a vortex and reform around the zoomed state
4. District labels fade in with staggered delays
5. A back button slides in from the left with a " ← Back to India" label

#### F. Scroll-triggered Parallax (Home page)
On the home page, as the user scrolls down past the hero, the India map *previews* in a small inset window (like a picture-in-picture), subtly animating — showing the map exists and inviting the click.

---

## 4. File Structure

```
D:/claude/Deputation/
├── index.html                          ← MODIFIED: add #map-view, router
├── app.js                              ← MODIFIED: add view router, map init
├── config.js                           ← UNCHANGED (shared)
├── enrich.js                           ← UNCHANGED (shared)
├── style.css                           ← MODIFIED: add map-view styles, animations
├── navbar.css                          ← MODIFIED: active state for India Map
│
├── india-map-view.js                   ← NEW: map init, drill-down, filters
├── india-map-data.js                   ← NEW: migrated from map-data-loader.js
├── india-map-animations.js             ← NEW: all animation orchestrators
├── india-map-particles.js              ← NEW: constellation particle system
│
├── india-map.html                      ← NEW (or redirect to index.html#map-view)
│   # This can be a thin wrapper that sets location.pathname
│   # and lets index.html handle everything
│
├── js/india-map/                       ← prototype source (reference only)
│   ├── map-data-loader.js              ← source of truth for data logic
│   ├── map-provider.js
│   ├── views/map-view.js
│   └── ...
│
├── assets/brand/
│   └── india-map-hero.mp4             ← optional: 2s looping hero background
│                                        (WebM/AV1, <500KB, muted, autoplay)
│
└── prototypes/india-map/               ← prototype archive (keep for reference)
```

---

## 5. CSS Architecture

### New sections in `style.css`:

```css
/* === India Map View === */
#map-view { /* full-screen map container */ }

/* State path animations */
.ad-state {
  transition: opacity 0.4s, filter 0.4s;
  cursor: pointer;
}
.ad-state.draw-in {
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
  animation: drawState 1.2s ease-out forwards;
}
@keyframes drawState {
  to { stroke-dashoffset: 0; }
}

/* Liquid fill animation */
.ad-state.liquid-fill::after {
  /* SVG mask animation for fill effect */
}

/* Ripple effect for new vacancies */
.ad-state .ripple-ring {
  animation: rippleOut 1.5s ease-out forwards;
}
@keyframes rippleOut {
  0%   { r: 5; opacity: 0.8; }
  100% { r: 40; opacity: 0; }
}

/* Spotlight hover */
.ad-state:hover { /* lift + glow */ }
.ad-state.neighbor-dim { opacity: 0.15; }

/* Spring tooltip */
.map-tooltip {
  transform: translateY(8px);
  opacity: 0;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
              opacity 0.2s;
}
.map-tooltip.visible {
  transform: translateY(0);
  opacity: 1;
}
```

### New file: `india-map-animations.css` (loaded only on map view)
- Ripple keyframes
- Draw-in keyframes
- Vortex transition keyframes
- Particle glow effects

---

## 6. JavaScript Architecture

### `app.js` additions:

```javascript
// === View Router ===
const VIEWS = { HOME: 'home', MAP: 'map' };
let currentView = VIEWS.HOME;

function navigateTo(view) {
  if (view === currentView) return;
  // Animate out current view
  animateViewOut(currentView, () => {
    // Show new view
    document.getElementById('home-view').hidden = (view !== VIEWS.HOME);
    document.getElementById('map-view').hidden = (view !== VIEWS.MAP);
    // Animate in
    animateViewIn(view);
    currentView = view;
    // Update nav
    updateNavActive(view);
    // Init map if needed
    if (view === VIEWS.MAP && !mapInitialised) initIndiaMap();
  });
}

// Listen to nav clicks
document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href');
    if (href === '/india-map') {
      e.preventDefault();
      navigateTo(VIEWS.MAP);
      history.pushState(null, '', '/india-map');
    }
  });
});

// Handle browser back/forward
window.addEventListener('popstate', () => {
  const isMap = location.pathname === '/india-map';
  navigateTo(isMap ? VIEWS.MAP : VIEWS.HOME);
});
```

### `india-map-view.js` (new, ~400 lines):
- `initIndiaMap()` — bootstraps the map, loads data, starts animations
- `renderMap(data)` — draws SVG states with draw-in animation
- `setupInteractions()` — hover, click, zoom, pan
- `drillDown(stateAbbr)` — zoom into state, show districts
- `drillDownDistrict(stateAbbr, district)` — show listings
- `applyMapFilters(filters)` — filter by Functional, Education, etc.
- `setupRealtime()` — Supabase real-time subscription for new vacancies

### `india-map-animations.js` (new, ~200 lines):
- `animateTransition(from, to)` — orchestrates home→map transition
- `animateStateDrawIn(paths)` — stroke-dashoffset stagger
- `animateLiquidFill(statePaths)` — gradient fill animation
- `spawnRipple(stateAbbr)` — vacancy arrival notification
- `initParticles(canvas)` — constellation background

### `india-map-data.js` (migrated from `js/india-map/map-data-loader.js`):
- Keep the same logic — it already works
- Export as ES module or attach to window
- Shared with prototype for consistency

---

## 7. Data Flow

```
Page Load
  │
  ├─ config.js loads (Supabase URL, keys)
  ├─ app.js boots
  │    ├─ Detects location.pathname
  │    ├─ If /india-map → navigateTo(MAP)
  │    └─ If / → show HOME
  │
  └─ If MAP view:
       ├─ india-map-view.js init
       │    ├─ Load SVG map geometry (inline or fetched)
       │    ├─ Call india-map-data.js → loadMapData()
       │    │    ├─ Supabase RPC (get_map_state_counts)
       │    │    └─ Fallback: vacancies.json
       │    ├─ Render states with draw-in animation
       │    ├─ Start particle canvas
       │    └─ Setup Supabase realtime subscription
       │
       └─ User interactions:
            ├─ Hover → spotlight + tooltip
            ├─ Click state → zoom + district drill-down
            ├─ Click district → vacancy listings
            └─ Filters → re-render with animation
```

---

## 8. Animation Timing (Home → Map Transition)

| Time | Event | Visual |
|------|-------|--------|
| 0ms | User clicks "India Map" | Nav highlight shifts, home content starts fading |
| 0-300ms | Home dismiss | Dashboard cards scale down + blur out (stagger: 20ms each) |
| 200ms | Radial glow | Brand gradient expands from center |
| 400ms | Hero wave dissolves | Wave canvas fades, particles scatter |
| 500ms | Map SVG enters | Map container fades in, positioned center |
| 600-1200ms | State draw-in | States trace their outlines (stagger: 30ms per state, 36 × 30ms = 1080ms total) |
| 1200-1500ms | Count badges pop | Spring animation: overshoot 1.2x → settle |
| 1500ms | Filters slide in | Bottom filter bar slides up |
| 1600ms | Ready | User can interact |

---

## 9. Responsive Behavior

| Viewport | Behavior |
|----------|----------|
| Desktop (>1024px) | Full map with sidebar tooltip, filters at bottom |
| Tablet (768-1024px) | Map centered, tooltip as modal overlay, filters collapsible |
| Mobile (<768px) | Full-screen map, touch-zoom gestures, bottom sheet for filters, simplified tooltip |

---

## 10. Performance Targets

| Metric | Target | Current |
|--------|--------|---------|
| First paint (map view) | <800ms | ~500ms (prototype) |
| State draw-in animation | 60fps | TBD |
| Hover response | <16ms | TBD |
| Drill-down zoom | 300ms ease | TBD |
| Particle count (desktop) | 80-120 | 50 (prototype) |
| Particle count (mobile) | 30-50 | — |

**Optimization notes:**
- Use `will-change: transform` on animated states
- GPU-accelerated transforms only (translate, scale, opacity)
- `requestAnimationFrame` for particle loop
- SVG paths pre-computed (no runtime geometry)
- Lazy-load district data only on drill-down

---

## 11. Implementation Sequence

### Phase 1: Structural (PR 1)
1. Add `#map-view` div to `index.html`
2. Add view router to `app.js`
3. Create thin `india-map.html` redirect
4. Test: `/india-map` loads the map view

### Phase 2: Data + Rendering (PR 2)
5. Migrate `map-data-loader.js` → `india-map-data.js`
6. Create `india-map-view.js` (init, render, interactions)
7. Add map-specific CSS to `style.css`
8. Test: map renders with real data, drill-down works

### Phase 3: Animations (PR 3)
9. Create `india-map-animations.js`
10. Implement draw-in, liquid fill, ripples
11. Implement constellation particle system
12. Test: animations smooth at 60fps

### Phase 4: Polish (PR 4)
13. Home → Map transition animation
14. Responsive breakpoints
15. Deep linking (`?state=DL`)
16. Accessibility (keyboard nav, ARIA)
17. Performance audit (Lighthouse)

---

## 12. Key Decisions for User Approval

1. **SPA vs separate page?** → SPA with view switcher (recommended for seamless transitions)
2. **Keep india-map.html as separate file or redirect?** → Redirect to `/` with `?view=map` (simpler)
3. **Prototype code migration strategy?** → Copy tested code verbatim, then adapt (don't rewrite)
4. **Animation library?** → Vanilla CSS + JS (no GSAP dependency to keep it lightweight)
5. **Map background: particles or video?** → Particles (more interactive, smaller bundle)

---

## 13. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| SVG map geometry too large inline | Fetch lazily, cache in sessionStorage |
| Animation jank on low-end devices | Detect GPU, reduce particle count, skip draw-in |
| Supabase RPC still undefined on production | Keep JSON fallback, add Supabase client init check |
| Mobile touch gestures conflict with page scroll | Pinch-zoom only on map container, prevent default |
| Deep link state not restored on reload | Store in URL params + sessionStorage |

---

*Plan authored: 2026-09-21 | Prototype verified: 798 vacancies, 36 states, drill-down functional*
