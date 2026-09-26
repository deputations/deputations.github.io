# India Map Page — Design Document v2
> Planning — awaiting approval before implementation

---

## 1. Page Context

**Route:** `https://alldeputations.com/india-map`

**New file:** `india-map.html` — sits alongside `index.html` in the repo root. The production server routes `/india-map` to this file. Zero changes to `index.html` or any existing page.

**Navbar:** Shared production navbar. The India Map page adds its own nav-item link ("India Map") to the existing navbar markup in `index.html` — but that's a one-line addition to the shared nav, not a modification to the home page experience.

**Viewport:** The map page fills 100% of the viewport below the navbar. No chrome, no padding, no gaps. The map IS the page.

---

## 2. Locked Design Decisions

### 2.1 Three View Modes

| View | Icon | Content | Interaction |
|------|------|---------|-------------|
| **Map** | 🗺️ | Full India map, state → district drill-down, cinematic fly-to | Click state → particle burst → fly-to → districts appear → click district → results |
| **Functional** | ⚙️ | Card grid by function category (Admin, Technical, Defence, Police, Vigilance, Education, Healthcare, Finance, Engineering, Teaching, Legal, General) | Scrollable cards, expand to show listings |
| **Education** | 🎓 | Card grid by qualification (MBA, BE/BTech variants, MBBS, Nursing, LLB, PG, Graduate, Diploma, 12th, 10th, Doctorate, Others) | Scrollable cards, expand to show listings |

Functional and Education views are **card/table views only** — no maps.

---

### 2.2 Cinematic Transition (Map View)

Click a state → particle burst from click point → circular clip-path ripple expands from click point → camera fly-to (CSS transform on SVG `g`) → district labels stagger in with pop-in count badges.

All CSS + vanilla JS canvas. No animation library.

---

### 2.3 HUD — Auto-Hiding Bottom Bar

Single glass bar at bottom edge. Contains: view toggle (3 segments) | filter button | zoom controls. Auto-hides after 4s of mouse inactivity, reappears on mouse-move-to-bottom-edge. Always visible on touch devices.

Filter opens a bottom sheet with pill-shaped filter chips.

---

### 2.4 Results Panel — Bottom Sheet

District click → district polygon pulses with glow ring → frosted-glass bottom sheet rises from bottom (45% viewport on desktop, 60% on mobile) → listing cards stagger in with 60ms delay per card → swipe down or tap dimmed area to dismiss.

---

### 2.5 Visual Polish (6 details)

1. State hover glow (cyan drop-shadow, 200ms transition)
2. District pulse on drill-down (ring animation)
3. Count badges pop-in (scale animation, staggered)
4. Results cards stagger in (slide-up, 60ms stagger)
5. Filter chips bounce in (spring-like scale)
6. Empty state ambient pulse (map state fills slowly pulse even with zero listings)

---

### 2.6 Brand & Typography

- Production navbar carries the logo + nav items (unchanged)
- Typography: Sora (headings) + Plus Jakarta Sans (body) — same as production
- Palette: production colors applied cartographically (cyan density, purple selection, gold heat, near-black background)
- Brand anchor: summary card (top-right glass) + breadcrumb in HUD
- No persistent chrome beyond the production navbar

---

## 3. File Architecture

### NEW FILES ONLY — nothing existing is modified (except the shared nav)

| File | Purpose |
|------|---------|
| `india-map.html` | Complete page — HUD, view containers, particle canvas, bottom sheet. Sits alongside `index.html`. |
| `js/india-map/app.js` | Bootstrap + view router — switches Map/Functional/Education, manages URL params |
| `js/india-map/views/map-view.js` | Map view — SVG rendering, state/district drill-down, cinematic transitions, particle system |
| `js/india-map/views/functional-view.js` | Functional card grid — category cards, expand/collapse, listing tables |
| `js/india-map/views/education-view.js` | Education card grid — qualification cards, expand/collapse, listing tables |
| `js/india-map/views/shared/card-grid.js` | Shared card-grid component for Functional + Education |
| `js/india-map/views/shared/listing-table.js` | Shared listing table component |
| `js/india-map/hud.js` | Bottom HUD bar — auto-hide, view toggle, filter button, zoom |
| `js/india-map/particles.js` | Particle burst system for cinematic transitions |
| `css/india-map/main.css` | All styles — layout, glass morphism, animations, responsive |
| `css/india-map/animations.css` | Animation keyframes (pop-in, pulse, stagger, ripple) |
| `css/india-map/results-sheet.css` | Bottom sheet styles |

### EXISTING FILES — untouched

| File | Status |
|------|--------|
| `index.html` | No changes |
| `style.css` | No changes |
| `navbar.css` | No changes |
| `liquid-glass.css` | No changes |
| `js/app.js` | No changes |
| `js/map-provider.js` | No changes (data adapter can be imported) |
| `js/state-geo.js` | No changes |
| `geo/*.geojson` | No changes |
| `fixtures/mock-data.js` | Additive only — new `function` and `qualificationGroup` fields per listing. Existing fields unchanged. |
| `tests/` | Existing tests preserved. New tests added in `tests/india-map/`. |

### MINIMAL ADDITION to existing production code:

| File | Change | Reason |
|------|--------|--------|
| Production `index.html` (navbar section) | Add one `<li><a href="/india-map">India Map</a></li>` to the nav links | Makes the page reachable from the live site |
| Production server config | Route `/india-map` → serve `india-map.html` | One-line route addition |

That's it. Everything else is new files in the prototype directory (or a new `india-map/` subdirectory).

---

## 4. Data Model — Additive Changes Only

New fields on each listing in `fixtures/mock-data.js`:

```javascript
{
  // ... all existing fields unchanged ...
  function: "Administrative",              // NEW — functional category
  qualificationGroup: "Graduate (General)" // NEW — education grouping
}
```

These fields exist alongside existing `category` (exchange type). Map view ignores them. Functional/Education views use them for grouping. No existing code breaks.

---

## 5. URL Structure

| View | URL | Example |
|------|-----|---------|
| Map (national) | `/india-map` | base URL |
| Map (state) | `/india-map?state=MH` | |
| Map (district) | `/india-map?state=MH&district=Pune` | |
| Functional | `/india-map?view=functional` | |
| Functional (category) | `/india-map?view=functional&category=Administrative` | |
| Education | `/india-map?view=education` | |
| Education (qualification) | `/india-map?view=education&qualification=Graduate` | |

URL changes use `history.pushState`. Refresh / direct link restores the correct view + drill-down level.

---

## 6. Build Phases

### Phase 1 — Foundation (Map View, static transitions)
- `india-map.html` structure (HUD, view containers, particle canvas, bottom sheet)
- `css/india-map/main.css` (production fonts, brand palette, layout)
- `js/india-map/app.js` bootstrap + view router
- Map view with working drill-down (instant transitions, no cinematics yet)
- HUD bar (functional, no auto-hide)
- Results as bottom sheet

### Phase 2 — Cinematics
- `js/india-map/particles.js` — particle burst system
- Ripple clip-path transition
- Camera fly-to with custom easing
- District label stagger + count badge pop-in
- HUD auto-hide behavior

### Phase 3 — Functional & Education Views
- `js/india-map/views/functional-view.js` + `education-view.js`
- `js/india-map/views/shared/card-grid.js` + `listing-table.js`
- Category/qualification data in mock-data.js
- Card expand/collapse with listing tables

### Phase 4 — Polish
- All 6 visual polish details
- Empty state animations
- Mobile responsiveness
- Accessibility (keyboard nav, screen reader, focus management)

### Phase 5 — Integration & Testing
- Route from production navbar
- URL restoration on refresh/direct link
- Full Playwright test suite for all three views
- Visual regression screenshots

---

## 7. What This Does NOT Include (v1 Scope)

- No backend integration (mock data only)
- No user accounts / login on this page
- No search (v2)
- No pagination
- No WebGL / three.js (CSS + canvas particles only)
- No bookmarking / save

---

## 8. Approval Checklist

- [ ] **File isolation** — OK that `india-map.html` + `js/india-map/` + `css/india-map/` are entirely new, zero changes to existing pages?
- [ ] **Navbar addition** — OK to add one `<li>India Map</li>` to the production nav?
- [ ] **Particle burst** — 60–80 particles per state click, canvas overlay?
- [ ] **HUD auto-hide** — 4s timeout, reappear on mouse-to-bottom-edge?
- [ ] **Bottom sheet** — 45% viewport desktop, 60% mobile?
- [ ] **Functional categories** — 12 listed (Admin, Technical, Defence, Police, Vigilance, Education, Healthcare, Finance, Engineering, Teaching, Legal, General) — OK?
- [ ] **Education categories** — 15 listed (MBA, BE/BTech CS, BE/BTech Civil, BE/BTech Mechanical, BE/BTech Electrical, MBBS, Nursing, LLB, PG, Graduate, Diploma, 12th, 10th, Doctorate, Others) — OK?
- [ ] **Build approach** — Phase by phase (each reviewable) or all at once? (I recommend phase by phase)
- [ ] **Commit strategy** — one commit per phase?
