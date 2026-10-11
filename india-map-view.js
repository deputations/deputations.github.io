// ===== india-map-view.js =====
// Production India Map — adapted from prototype map-view.js.
// All issues fixed: Ladakh (st_code: 38), 36-state coverage,
// projection clipping, ambient pulse on empty states, draw-in animation.

(() => {
  'use strict';

  let mapInitialised = false;
  let viewMode = 'national';
  let selectedAbbr = null;
  let selectedDistrict = null;
  let districtsGeo = null;
  let districtsPromise = null;
  let currentProjection = null;
  let zoomAnimFrame = null;
  let viewBoxAnimId = 0;
  let renderGeneration = 0;  // navigation/render lifecycle (J)
  let drawGeneration = 0;    // decorative draw-in lifecycle (J)
  let lastFocusedState = null;
  let announceTimer = null;
  let introPending = false;    // first national render plays the tricolour intro
  let ledGeneration = 0;       // bumped by clearMap: drops stale intro / border work

  function announce(msg) {
    const el = document.getElementById('mapAnnounce');
    if (!el) return;
    el.textContent = '';
    if (announceTimer) clearTimeout(announceTimer);
    // Brief delay so screen readers register the cleared then re-set text
    announceTimer = setTimeout(() => { el.textContent = msg; }, 50);
  }

  /* ---- gesture state ---- */
  let gestureState = null;
  let panState = null;

  // The single district-geometry resolver. Codes come from
  // IndiaMapData.getDistrictCodes() (always an array). Features with a blank
  // district name are state-outline sentinels in the GeoJSON, not districts,
  // so they are dropped here. Used by both cinematicZoom() and renderState().
  function districtFeaturesFor(abbr) {
    const codes = window.IndiaMapData?.getDistrictCodes?.(abbr) || [];
    if (!codes.length) return [];
    return (districtsGeo?.features || []).filter(f =>
      f && f.geometry && f.properties &&
      codes.includes(String(f.properties.st_code)) &&
      String(f.properties.district || '').trim() !== ''
    );
  }

  // Groups geometry fragments that share a district name into one logical
  // district: [{ name, features: [...] }], in first-seen order.
  function groupDistricts(features) {
    const byName = new Map();
    features.forEach(f => {
      const name = String(f.properties.district).trim();
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(f);
    });
    return Array.from(byName, ([name, feats]) => ({ name, features: feats }));
  }

  const STATE_ABBR = {
    'Andaman and Nicobar':'AN','Andhra Pradesh':'AP','Arunachal Pradesh':'AR','Assam':'AS',
    'Bihar':'BR','Chandigarh':'CH','Chhattisgarh':'CG','Delhi':'DL','Goa':'GA','Gujarat':'GJ',
    'Haryana':'HR','Himachal Pradesh':'HP','Jammu and Kashmir':'JK','Jharkhand':'JH',
    'Karnataka':'KA','Kerala':'KL','Lakshadweep':'LD','Ladakh':'LA',
    'Madhya Pradesh':'MP','Maharashtra':'MH','Manipur':'MN','Meghalaya':'ML','Mizoram':'MZ',
    'Nagaland':'NL','Odisha':'OD','Puducherry':'PY','Punjab':'PB','Rajasthan':'RJ',
    'Sikkim':'SK','Tamil Nadu':'TN','Telangana':'TS','Tripura':'TR','Uttar Pradesh':'UP',
    'Uttarakhand':'UK','West Bengal':'WB',
    'Dadra and Nagar Haveli and Daman and Diu':'DNH','Dadra and Nagar Haveli':'DN',
    'Daman and Diu':'DD',
  };
  const ABBR_TO_NAME = Object.fromEntries(Object.entries(STATE_ABBR).map(([k,v]) => [v,k]));

  // ----- Projection (from prototype; handles Ladakh's high latitude) -----
  // `fill`: the share of the 1000×800 canvas the shapes may span. All of
  // India takes nearly the full height; a state keeps a margin (cinematicZoom
  // assumes 0.92 to land where renderState draws).
  const NATIONAL_FILL = 0.97;

  // ----- Home view: fitted to what is drawn, so the map fills any screen -----
  // The viewBox wraps the drawn shapes (and, nationally, their name tags)
  // with a small margin; preserveAspectRatio 'meet' then scales that to the
  // map area, so India fills the height of a laptop or widescreen and the
  // width of a phone or portrait tablet. Reset and Back to India return here.
  const VIEW_PAD = 0.02;   // of the box's longer side, on every edge
  let homeView = { x: 0, y: 0, w: 1000, h: 800 };
  let nationalHome = null;
  function padBox(b) {
    const w = Math.max(b.width, 30), h = Math.max(b.height, 24);
    const pad = VIEW_PAD * Math.max(w, h);
    return { x: b.x + b.width / 2 - w / 2 - pad, y: b.y + b.height / 2 - h / 2 - pad, w: w + 2 * pad, h: h + 2 * pad };
  }
  function contentView(els) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    els.forEach(el => {
      let b = null;
      try { b = el && el.getBBox(); } catch (e) { /* not rendered */ }
      if (!b || !(b.width > 0 && b.height > 0)) return;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
    });
    if (!isFinite(x0)) return { x: 0, y: 0, w: 1000, h: 800 };
    return padBox({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  function setView(svg, v) {
    const vb = svg.viewBox.baseVal;
    vb.x = v.x; vb.y = v.y; vb.width = v.w; vb.height = v.h;
  }

  // ----- State view layout: the state, and its name beside it -----
  // Landscape map areas give the name a column on the right, under the
  // vacancy counter and aligned to its right edge; the state is framed in
  // the space left of it. Portrait areas keep the state as it is and set
  // the name in the free band above or below it (see placeStateTitle).
  // edge: kept clear above and below the state for the floating buttons
  const TITLE = { pad: 20, gap: 32, below: 28, edge: 60, minCol: 260, maxCol: 620, colShare: 0.3 };
  function mapAreaRect(el) {
    const area = document.getElementById('mapContainer')?.getBoundingClientRect();
    const r = el && !el.hidden ? el.getBoundingClientRect() : null;
    if (!area || !r || !r.width) return null;
    return { left: r.left - area.left, top: r.top - area.top, right: r.right - area.left, bottom: r.bottom - area.top };
  }
  function stateLayout() {
    const wrap = document.getElementById('mapSvgWrap')?.getBoundingClientRect();
    if (!wrap || !wrap.width) return null;
    const W = wrap.width, H = wrap.height;
    const counter = mapAreaRect(document.getElementById('mapCounter'));
    const zoom = mapAreaRect(document.querySelector('.map-zoom-controls'));
    const top = (counter ? counter.bottom : 60) + TITLE.below;
    const foot = (zoom ? zoom.top : H - 60) - 16;
    if (W / H >= 1.05 && W >= 700) {
      const col = Math.round(Math.min(TITLE.maxCol, Math.max(TITLE.minCol, W * TITLE.colShare)));
      return {
        mode: 'side', W, H,
        title: { right: TITLE.pad, top, width: col - TITLE.pad, height: Math.max(80, foot - top) },
        map: { x: 0, y: TITLE.edge, w: W - col - TITLE.gap, h: H - 2 * TITLE.edge },
      };
    }
    return { mode: 'band', W, H, map: { x: 0, y: 0, w: W, h: H } };
  }
  // The viewBox that shows `box` as large as it fits in the layout's map
  // region, centred there. Used for the state's home view and as the end of
  // the zoom into it, so the two meet exactly.
  function stateViewBox(box, layout) {
    if (!layout) return box;
    const m = layout.map;
    const sc = Math.min(m.w / box.w, m.h / box.h);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    return { x: cx - (m.x + m.w / 2) / sc, y: cy - (m.y + m.h / 2) / sc, w: layout.W / sc, h: layout.H / sc };
  }
  let stateContent = null;   // the open state's drawn box, for re-framing on resize
  function computeProjection(features, fill = 0.92) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    features.forEach(f => {
      if (!f.geometry) return;
      flattenCoords(f.geometry).forEach(([lon, lat]) => {
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      });
    });
    if (!isFinite(minLon)) { minLon = 68; maxLon = 97; minLat = 6; maxLat = 37; }
    // Pad latitude more generously to include Ladakh
    const lonRange = (maxLon - minLon) || 1;
    const latRange = (maxLat - minLat) || 1;
    const mapW = 1000, mapH = 800;
    const scale = Math.min(mapW / lonRange, mapH / latRange) * fill;
    const offsetX = (mapW - lonRange * scale) / 2;
    const offsetY = mapH - (mapH - latRange * scale) / 2;
    currentProjection = { minLon, maxLon, minLat, maxLat, scale, offsetX, offsetY };
  }

  function project(lon, lat) {
    if (!currentProjection) return [500, 400];
    const p = currentProjection;
    return [(lon - p.minLon) * p.scale + p.offsetX, p.offsetY - (lat - p.minLat) * p.scale];
  }

  function ringExtent(ring) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of ring) {
      if (c[0] < minLon) minLon = c[0]; if (c[0] > maxLon) maxLon = c[0];
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
    }
    return { rangeLon: maxLon - minLon, rangeLat: maxLat - minLat };
  }
  function hasRealExtent(ring) {
    const e = ringExtent(ring);
    return e.rangeLon > 0.005 && e.rangeLat > 0.005;
  }
  function flattenCoords(geom) {
    const result = [];
    if (!geom) return result;
    if (geom.type === 'Polygon') {
      geom.coordinates.filter(hasRealExtent).forEach(ring => ring.forEach(c => result.push(c)));
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(poly => {
        poly.filter(hasRealExtent).forEach(ring => ring.forEach(c => result.push(c)));
      });
    }
    return result;
  }
  function getValidRings(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return geom.coordinates.filter(hasRealExtent);
    if (geom.type === 'MultiPolygon') {
      const rings = [];
      geom.coordinates.forEach(poly => poly.forEach(r => { if (hasRealExtent(r)) rings.push(r); }));
      return rings;
    }
    return [];
  }
  function projectRing(ring) {
    const pts = ring.map(([lon, lat]) => {
      const [x, y] = project(lon, lat);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    if (pts.length < 2) return `M ${pts[0] || '0,0'}`;
    return `M ${pts[0]} L ${pts.slice(1).join(' L ')}`;
  }
  function projectCoords(geom) {
    if (!geom) return '';
    return getValidRings(geom).map(projectRing).join(' ');
  }
  function centroid(geom) {
    const pts = flattenCoords(geom);
    if (!pts.length) return [0, 0];
    let sx = 0, sy = 0;
    pts.forEach(([lon, lat]) => { sx += lon; sy += lat; });
    return [sx / pts.length, sy / pts.length];
  }
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ----- Lazy load districts (with 24h sessionStorage cache) -----
  function ensureDistrictsLoaded() {
    if (districtsGeo) return Promise.resolve(districtsGeo);
    if (districtsPromise) return districtsPromise;

    // Check sessionStorage cache first (24h TTL)
    // Bump with the file's ?v= whenever geo/india-districts-all.geojson changes
    const cacheKey = 'india-districts-geo-v2';
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && parsed._ts && (Date.now() - parsed._ts) < 86400000) {
          districtsGeo = parsed.data;
          return Promise.resolve(districtsGeo);
        }
      }
    } catch (e) { /* sessionStorage unavailable — fall through to fetch */ }

    districtsPromise = fetch('geo/india-districts-all.geojson?v=2')
      .then(r => r.ok ? r.json() : null)
      .then(g => {
        districtsGeo = g;
        // Cache in sessionStorage (24h TTL)
        try {
          sessionStorage.setItem(cacheKey, JSON.stringify({ _ts: Date.now(), data: g }));
        } catch (e) { /* quota exceeded — silently ignore */ }
        return g;
      })
      .catch(() => null);
    return districtsPromise;
  }

  // ----- State colours -----
  // Eight muted colours defined once as CSS custom properties (--map-c-<key>
  // in india-map.css); the view only names the key. The mapping is fixed,
  // not random: every colour is used 4–5 times, no two bordering states share
  // one, and bordering states never get one of the palette's near-twin pairs
  // (mist/slate, sage/olive, powder/lavender) — the weakest contrast between
  // neighbours is ΔE76 ≈ 33. Checked against geo/india-states.geojson by
  // tests/test_india_map.py::TestStateColours.
  const STATE_COLORS = {
    JK: 'sage', LA: 'lavender', HP: 'champagne', PB: 'rose', CH: 'olive',
    HR: 'powder', DL: 'olive', UK: 'sage', UP: 'rose', RJ: 'olive', GJ: 'rose',
    MP: 'powder', MH: 'champagne', DNH: 'powder', GA: 'slate', CG: 'sage',
    TS: 'rose', KA: 'sage', AP: 'powder', TN: 'champagne', KL: 'lavender',
    PY: 'mist', OD: 'rose', JH: 'champagne', BR: 'sage', WB: 'powder',
    SK: 'olive', AS: 'champagne', AR: 'mist', NL: 'lavender', MN: 'mist',
    MZ: 'lavender', TR: 'mist', ML: 'slate', AN: 'slate', LD: 'slate',
  };
  function stateColor(abbr) { return STATE_COLORS[abbr] || 'slate'; }
  function stateFill(abbr) { return `var(--map-c-${stateColor(abbr)})`; }

  // ----- Build / clear SVG -----
  function buildSvg() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('xmlns', ns);
    svg.setAttribute('viewBox', '0 0 1000 800');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.id = 'map-svg';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'India map');

    const defs = document.createElementNS(ns, 'defs');

    svg.appendChild(defs);

    const g = document.createElementNS(ns, 'g');
    g.id = 'map-group';
    svg.appendChild(g);

    // Lit "LED strip" state borders (see buildLeds)
    const leds = document.createElementNS(ns, 'g');
    leds.id = 'map-leds';
    leds.setAttribute('aria-hidden', 'true');
    svg.appendChild(leds);

    // One outline path above every shape (see .ad-outline in the CSS)
    const outline = document.createElementNS(ns, 'path');
    outline.id = 'map-outline';
    outline.setAttribute('class', 'ad-outline');
    outline.setAttribute('aria-hidden', 'true');
    svg.appendChild(outline);

    // Hovered state, redrawn on top of its neighbours so it can grow
    // (see setSpotlight / .ad-lift)
    const lift = document.createElementNS(ns, 'path');
    lift.id = 'map-lift';
    lift.setAttribute('class', 'ad-lift');
    lift.setAttribute('aria-hidden', 'true');
    svg.appendChild(lift);

    const labels = document.createElementNS(ns, 'g');
    labels.id = 'map-labels';
    svg.appendChild(labels);

    // Gestures live on the element, so every rebuilt SVG (e.g. after the
    // Delhi image map replaced it) gets wheel / pinch / drag again.
    svg.style.touchAction = 'none';
    svg.addEventListener('wheel', onWheelZoom, { passive: false });
    svg.addEventListener('touchstart', onTouchStart, { passive: false });
    svg.addEventListener('touchmove', onTouchMove, { passive: false });
    svg.addEventListener('touchend', onTouchEnd);
    svg.addEventListener('touchcancel', onTouchEnd);
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', onPointerUp);

    return svg;
  }

  // Returns #map-svg, rebuilding it if the Delhi image map replaced it.
  function ensureMapSvg() {
    const existing = document.getElementById('map-svg');
    if (existing) return existing;
    const wrap = document.getElementById('mapSvgWrap');
    if (!wrap) return null;
    wrap.innerHTML = '';
    const svg = buildSvg();
    wrap.appendChild(svg);
    return svg;
  }

  // Draw-in animation: stroke-dashoffset from full length → 0
  function prepareDrawIn(path) {
    let total = 0;
    try { total = path.getTotalLength(); } catch { total = 1500; }
    if (!isFinite(total) || total <= 0) total = 1500;
    path.style.strokeDasharray = total;
    // strokeDashoffset is set by the CSS animation (ad-draw-state),
    // which reads from --ad-draw-len. Do NOT set it here — it would
    // override the animation and keep the path permanently hidden.
    path.style.setProperty('--ad-draw-len', total);
    return total;
  }

  function playDrawIn(path, delay) {
    path.style.animation = 'none';
    void path.getBoundingClientRect();
    const dur = 2;
    const ease = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
    const useReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (useReducedMotion) {
      path.classList.add('ad-draw-state');
      path.style.strokeDashoffset = '0';
      path.style.animation = 'none';
    } else {
      path.classList.add('ad-draw-state');
      path.style.animation = `ad-draw ${dur}s ${ease} ${delay}ms forwards`;
    }
  }

  // Draws the hover / keyboard-focus / selection ring on the outline layer,
  // above all shapes, so a neighbour's border never covers part of it.
  function setOutline(path, kind) {
    const o = document.getElementById('map-outline');
    if (!o) return;
    if (!path) {
      o.setAttribute('class', 'ad-outline');
      o.removeAttribute('d');
      delete o.dataset.for;
      return;
    }
    o.setAttribute('d', path.getAttribute('d'));
    o.setAttribute('class', `ad-outline ad-outline-${kind}`);
    o.dataset.for = path.dataset.district || path.dataset.abbr || '';
  }
  function clearOutline(kind) {
    const o = document.getElementById('map-outline');
    if (o && o.classList.contains(`ad-outline-${kind}`)) setOutline(null);
  }
  function wireOutline(path, { hover = true } = {}) {
    if (hover) {
      path.addEventListener('mouseenter', () => setOutline(path, 'hover'));
      path.addEventListener('mouseleave', () => clearOutline('hover'));
    }
    path.addEventListener('focus', () => { if (path.matches(':focus-visible')) setOutline(path, 'focus'); });
    path.addEventListener('blur', () => clearOutline('focus'));
  }

  // National-map hover: the hovered state grows a little and darkens on the
  // lift layer (above every shape, below the labels); every other state and
  // its labels fade back. setSpotlight(null) eases it all back.
  function setSpotlight(path) {
    const svg = document.getElementById('map-svg');
    const lift = document.getElementById('map-lift');
    if (!svg || !lift) return;
    svg.querySelectorAll('.is-spot').forEach(el => el.classList.remove('is-spot'));
    if (!path || !path.isConnected) {
      svg.classList.remove('has-spotlight');
      lift.classList.remove('on');
      return;
    }
    const abbr = path.dataset.abbr;
    path.classList.add('is-spot');
    svg.querySelectorAll(`#map-labels [data-for="${abbr}"], .ad-wall[data-for="${abbr}"]`).forEach(el => el.classList.add('is-spot'));
    svg.classList.add('has-spotlight');

    // Small states grow proportionally more, so Goa or Delhi visibly lift
    // while Rajasthan doesn't swallow its neighbours
    let scale = 1.05;
    try {
      const b = path.getBBox();
      const size = Math.max(b.width, b.height);
      if (size > 0) scale = 1 + Math.min(0.2, Math.max(0.05, 10 / size));
    } catch (e) { /* not rendered */ }

    // Snap back to scale(1) first, so the grow plays for every new state
    // instead of morphing from the previous one
    lift.style.transition = 'none';
    lift.classList.remove('on');
    lift.setAttribute('d', path.getAttribute('d'));
    lift.style.fill = path.style.fill;
    lift.style.setProperty('--lift-scale', scale);
    lift.classList.toggle('empty-state', path.classList.contains('empty-state'));
    lift.getBoundingClientRect();
    lift.style.transition = '';
    lift.classList.add('on');
  }

  function clearMap() {
    // Paths are about to be removed without a mouseleave — drop any tooltip,
    // outline and hover spotlight
    hideTooltip();
    setOutline(null);
    setSpotlight(null);
    document.getElementById('map-lift')?.removeAttribute('d');
    ledGeneration++;
    hideStateTitle();
    stateContent = null;
    const old = document.getElementById('map-svg');
    if (old) {
      const g = old.querySelector('#map-group');
      const lg = old.querySelector('#map-labels');
      const leds = old.querySelector('#map-leds');
      if (g) g.innerHTML = '';
      if (lg) lg.innerHTML = '';
      if (leds) leds.innerHTML = '';
      old.classList.remove('ad-intro');
    }
    // Also clear any Delhi image-map content from the SVG wrapper
    const wrap = document.getElementById('mapSvgWrap');
    if (wrap && wrap.querySelector('.ad-delhi-map-wrap, .ad-delhi-district-view')) {
      wrap.innerHTML = '';
    }
  }

  // ----- Render national -----
  function renderNational(data) {
    viewMode = 'national';
    selectedAbbr = null;
    clearMap();
    const mapSvg = document.getElementById('map-svg');
    const g = mapSvg?.querySelector('#map-group');
    const labelsG = mapSvg?.querySelector('#map-labels');
    if (!g) return;

    const features = (window._indiaGeoData?.features) || [];
    if (!features.length) return;

    computeProjection(features, NATIONAL_FILL);

    // First load only: states start hidden under the tricolour (see
    // playTricolourIntro). Back to India / deep links use the quick draw-in.
    const intro = introPending;
    introPending = false;
    mapSvg.classList.toggle('ad-intro', intro);
    const lg = ledGeneration;

    const labelStates = [];
    features.forEach((feat, idx) => {
      const name = feat.properties.NAME_1;
      const abbr = STATE_ABBR[name];
      if (!abbr) return;
      const d = projectCoords(feat.geometry);
      if (!d) return;

      const count = data.stateCounts[abbr] || 0;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `${d} Z`);
      path.setAttribute('class', `ad-state${count === 0 ? ' empty-state' : ''}`);
      path.setAttribute('data-abbr', abbr);
      path.setAttribute('data-name', name);
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `${name}: ${count} vacancies`);

      // Prepare staggered draw-in animation
      const drawLen = prepareDrawIn(path);
      path.dataset.drawLen = drawLen;
      path.dataset.idx = idx;

      // Flat fill in the state's palette colour (see STATE_COLORS)
      path.dataset.color = stateColor(abbr);
      path.style.fill = stateFill(abbr);

      // Hover spotlight: this state grows and darkens, the rest fade
      path.addEventListener('mouseenter', (e) => {
        showTooltip(e, abbr, name, count);
        announce(`${name}: ${count} vacanc${count !== 1 ? 'ies' : 'y'}`);
        setSpotlight(path);
      });
      path.addEventListener('mousemove', moveTooltip);
      path.addEventListener('mouseleave', () => {
        hideTooltip();
        if (path.classList.contains('is-spot')) setSpotlight(null);
      });
      // The lifted copy draws its own ring, so no hover outline here
      wireOutline(path, { hover: false });
      path.addEventListener('click', () => navigateToState(abbr));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToState(abbr); }
      });

      g.appendChild(path);
      labelStates.push({ abbr, name, count, path });
    });

    // Full state names, each fitted inside its own borders (see
    // layoutStateLabels)
    layoutStateLabels(labelStates, labelsG);
    homeView = nationalHome = contentView([g, labelsG]);
    setView(mapSvg, homeView);
    buildRelief(labelStates.map(st => st.path), g, p => stateFill(p.dataset.abbr), p => p.dataset.abbr);

    // Trigger draw-in for all paths after the SVG is in the DOM
    requestAnimationFrame(() => {
      const paths = document.querySelectorAll('#map-svg .ad-state');
      let completed = 0;
      const total = paths.length;
      const gen = ++drawGeneration; // (J) separate from renderGeneration
      const useReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      function onPathComplete() {
        completed++;
        if (completed >= total && gen === drawGeneration) {
          document.dispatchEvent(new CustomEvent('map:drawInComplete'));
        }
      }

      if (intro) {
        paths.forEach(p => { p.style.strokeDasharray = ''; p.classList.add('drawn'); });
        // The chakra sits a little west of the white band's centre
        playTricolourIntro(Array.from(paths), lg, INTRO, () =>
          document.dispatchEvent(new CustomEvent('map:drawInComplete')),
          { chakraNudge: -0.03, seed: p => p.dataset.abbr === 'DL' });
        return;
      }
      // Lit borders draw in step with the state borders below
      buildLeds(Array.from(paths), lg, useReducedMotion ? null : (i) => i * 30);

      // After its draw-in a border goes back to solid: with non-scaling
      // strokes, a dash sized in user units would leave gaps once zoomed in.
      // Runs on the path's own animationend, so the completion event (which
      // deep links wait for) is never delayed by a racing timer.
      paths.forEach((p, i) => {
        playDrawIn(p, i * 30);
        let done = false;
        const finish = () => {
          if (done || gen !== drawGeneration) return;
          done = true;
          p.classList.add('drawn');
          p.classList.remove('ad-draw-state');
          p.style.animation = 'none';
          p.style.strokeDasharray = '';
          p.style.strokeDashoffset = '';
          onPathComplete();
        };
        if (useReducedMotion) {
          finish(); // no animation, count immediately
        } else {
          p.addEventListener('animationend', finish, { once: true });
          // Safety fallback: if animationend never fires (interrupted/removed)
          setTimeout(finish, i * 30 + 2600);
        }
      });
      // Count labels pop in after draw-in finishes (2s + max stagger 600ms)
      document.querySelectorAll('#map-svg .ad-state-count').forEach((el, i) => {
        el.style.animationDelay = `${1800 + i * 25}ms`;
        el.classList.add('pop');
      });
    });

    updateCounter(data);
  }

  // ----- Lit borders -----
  // Every border ends up lit as a thin gold line under a soft glow. Each
  // shape's own outline lights up first (drawn in step with the draw-in, or
  // by the intro's electricity); once all are lit they are swapped for one
  // border network with each border drawn once, so shared borders match
  // coastlines, and the light stays still.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, cls, parent) {
    const e = document.createElementNS(SVG_NS, tag);
    if (cls) e.setAttribute('class', cls);
    if (parent) parent.appendChild(e);
    return e;
  }
  function ledPath(d, cls, parent) {
    const e = svgEl('path', cls, parent);
    e.setAttribute('d', d);
    return e;
  }

  // A projected path's rings as [[x, y], ...] (see projectRing)
  function parseRings(d) {
    return String(d).split('M').map(sub => sub.replace(/Z/g, '').split('L')
      .map(s => s.trim()).filter(Boolean)
      .map(s => s.split(',').map(Number)))
      .filter(r => r.length > 1);
  }

  // delayFor(i) → ms before shape i's border lights (in step with its
  // draw-in); null → lit at once (reduced motion); omitted → the caller
  // animates (the intro) and calls settleBorders when done. `lg` is the
  // ledGeneration of the render that asked, so stale work is dropped.
  function buildLeds(paths, lg, delayFor) {
    const leds = document.getElementById('map-leds');
    if (!leds) return [];
    leds.innerHTML = '';
    leds.classList.remove('lit');
    const coreG = svgEl('g', '', leds);
    const items = paths.map(p => {
      let len = 0;
      try { len = p.getTotalLength(); } catch (e) { /* not rendered */ }
      if (!isFinite(len) || len <= 0) len = 1500;
      return { p, len, core: ledPath(p.getAttribute('d'), 'ad-led-core', coreG) };
    });
    if (delayFor === undefined) return items;
    if (delayFor === null) { settleBorders(paths, lg); return items; }
    Promise.all(items.map((it, i) =>
      drawLed(it, delayFor(i), 2000, 'cubic-bezier(0.22, 0.61, 0.36, 1)')))
      .then(() => settleBorders(paths, lg));
    return items;
  }

  // Lights a border from its start point all the way round
  function drawLed(it, delay, duration, easing) {
    it.core.style.strokeDasharray = `${it.len} ${it.len}`;
    return it.core.animate([{ strokeDashoffset: it.len }, { strokeDashoffset: 0 }],
      { delay, duration, easing, fill: 'both' }).finished.catch(() => {});
  }

  function settleBorders(paths, lg) {
    const leds = document.getElementById('map-leds');
    if (!leds || lg !== ledGeneration || !paths.length || !paths[0].isConnected) return;
    const edges = borderEdges(paths);
    const d = edges.network();
    leds.innerHTML = '';
    ledPath(d, 'ad-net-glow', leds);
    ledPath(d, 'ad-net-core', leds);
    // In a state, its outer border is black (drawn by the intro's current)
    if (paths[0].classList.contains('ad-district')) ledPath(edges.outline().join(''), 'ad-state-outline', leds);
    requestAnimationFrame(() => leds.classList.add('lit'));
  }

  // The shapes' outlines as one graph of unique edges. network() chains
  // them into polylines between junctions (each border once); outer() is
  // the edges only one shape uses (the outline of the whole) and outline()
  // those same edges chained, one path per stretch of outline.
  function borderEdges(paths) {
    const adj = new Map();
    const count = new Map();
    const pos = new Map();
    const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
    // Polylines through a graph of point keys, broken at junctions: the
    // chains between junctions first, then the closed loops left over
    const chainUp = (graph) => {
      const used = new Set();
      const out = [];
      const walk = (from, next) => {
        const chain = [from];
        let prev = from, cur = next;
        used.add(edgeKey(prev, cur));
        for (;;) {
          chain.push(cur);
          const nbrs = graph.get(cur);
          if (nbrs.length !== 2 || cur === from) break;
          const nxt = nbrs.find(n => n !== prev && !used.has(edgeKey(cur, n)));
          if (!nxt) break;
          used.add(edgeKey(cur, nxt));
          prev = cur; cur = nxt;
        }
        out.push(`M ${chain.join(' L ')} `);
      };
      graph.forEach((nbrs, n) => {
        if (nbrs.length !== 2) nbrs.forEach(m => { if (!used.has(edgeKey(n, m))) walk(n, m); });
      });
      graph.forEach((nbrs, n) => nbrs.forEach(m => { if (!used.has(edgeKey(n, m))) walk(n, m); }));
      return out;
    };
    paths.forEach(p => parseRings(p.getAttribute('d')).forEach(ring => {
      const keys = ring.map(([x, y]) => { const k = `${x},${y}`; pos.set(k, [x, y]); return k; });
      for (let i = 0; i < keys.length; i++) {
        const a = keys[i], b = keys[(i + 1) % keys.length];
        if (a === b) continue;
        const k = edgeKey(a, b);
        if (count.has(k)) { count.set(k, count.get(k) + 1); continue; }
        count.set(k, 1);
        if (!adj.has(a)) adj.set(a, []);
        if (!adj.has(b)) adj.set(b, []);
        adj.get(a).push(b);
        adj.get(b).push(a);
      }
    }));
    return {
      network() { return chainUp(adj).join(''); },
      outline() {
        const outerAdj = new Map();
        count.forEach((c, k) => {
          if (c !== 1) return;
          const [a, b] = k.split('|');
          if (!outerAdj.has(a)) outerAdj.set(a, []);
          if (!outerAdj.has(b)) outerAdj.set(b, []);
          outerAdj.get(a).push(b);
          outerAdj.get(b).push(a);
        });
        return chainUp(outerAdj);
      },
      outer() {
        const edges = [];
        count.forEach((c, k) => {
          if (c !== 1) return;
          const [a, b] = k.split('|');
          edges.push([...pos.get(a), ...pos.get(b)]);
        });
        return edges;
      },
    };
  }

  // The chakra's circle, up to rMax and never crossing the outline. It sits
  // in the middle of the flag's white band (half-way down the shape's box,
  // so equidistant from the saffron and green) and half-way across the land
  // along that line, moved by nudgeX × the box's width. Where a wheel of a
  // good size doesn't fit there, it takes the nearest spot where one does.
  function placeChakra(paths, box, rMax, nudgeX = 0) {
    const edges = borderEdges(paths).outer();
    const inside = (x, y) => {
      let c = false;
      for (const [ax, ay, bx, by] of edges) {
        if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) c = !c;
      }
      return c;
    };
    const room = (x, y) => {
      let best = Infinity;
      for (const [ax, ay, bx, by] of edges) {
        const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
        let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - ax - t * dx, ey = y - ay - t * dy;
        best = Math.min(best, ex * ex + ey * ey);
      }
      return Math.sqrt(best);
    };
    // Half-way down, and half-way between the first and last coast on it
    const cy = box.y + box.h / 2;
    const xs = [];
    for (const [ax, ay, bx, by] of edges) {
      if ((ay > cy) !== (by > cy)) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
    }
    const cx = (xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : box.x + box.w / 2) + nudgeX * box.w;
    if (inside(cx, cy)) {
      const fit = Math.min(room(cx, cy), rMax);
      if (fit >= rMax * 0.75) return { cx, cy, r: fit * 0.9 };
    }
    const step = Math.max(box.w, box.h) / 24;
    const spots = [];
    for (let x = box.x + step / 2; x < box.x + box.w; x += step) {
      for (let y = box.y + step / 2; y < box.y + box.h; y += step) {
        if (inside(x, y)) spots.push({ x, y, fit: Math.min(room(x, y), rMax), off: Math.hypot(x - cx, y - cy) });
      }
    }
    if (!spots.length) return null;
    const most = Math.max(...spots.map(s => s.fit));
    const pick = spots.filter(s => s.fit >= most * 0.97).sort((a, b) => a.off - b.off)[0];
    return { cx: pick.x, cy: pick.y, r: pick.fit * 0.9 };
  }

  // ----- A little 3D: the map as a raised slab -----
  // Each stretch of outline on the map's outer edge that faces down the
  // screen gets a side wall: quads hanging `depth` below the edge, in a
  // darker shade of the shape's own colour. Lit from the top left, walls
  // turned left are a little lighter and walls turned right a little darker.
  // Inner borders get none (they would sit under the neighbour). A faint
  // sheen over the top face finishes the relief. Both are static, so
  // nothing here redraws per frame.
  const WALL_SHADE = [78, 68, 56];   // % of the shape's colour (rest is ink): lit, front, shaded

  function buildRelief(paths, g, baseOf, keyOf) {
    g.querySelector('.ad-walls')?.remove();
    g.querySelector('.ad-sheen')?.remove();
    if (!paths.length) return;
    const shapes = paths.map(p => parseRings(p.getAttribute('d')));
    const edgeKey = (ax, ay, bx, by) => {
      const a = `${ax},${ay}`, b = `${bx},${by}`;
      return a < b ? `${a}|${b}` : `${b}|${a}`;
    };
    const count = new Map();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    shapes.forEach(rings => rings.forEach(r => r.forEach(([x, y], j) => {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      const [nx, ny] = r[(j + 1) % r.length];
      if (nx === x && ny === y) return;
      const k = edgeKey(x, y, nx, ny);
      count.set(k, (count.get(k) || 0) + 1);
    })));
    // A few screen pixels at any zoom the view opens at
    const depth = 0.009 * Math.max(x1 - x0, y1 - y0);
    const f = v => v.toFixed(1);

    const walls = svgEl('g', 'ad-walls');
    walls.setAttribute('aria-hidden', 'true');
    g.insertBefore(walls, g.firstChild);
    paths.forEach((p, i) => {
      const quads = ['', '', ''];
      shapes[i].forEach(r => {
        // Ring orientation decides which side of an edge is outside
        let area = 0;
        for (let j = 0; j < r.length; j++) {
          const [ax, ay] = r[j], [bx, by] = r[(j + 1) % r.length];
          area += ax * by - bx * ay;
        }
        const sgn = area >= 0 ? 1 : -1;
        for (let j = 0; j < r.length; j++) {
          const [ax, ay] = r[j], [bx, by] = r[(j + 1) % r.length];
          if ((ax === bx && ay === by) || count.get(edgeKey(ax, ay, bx, by)) !== 1) continue;
          const len = Math.hypot(bx - ax, by - ay);
          const nx = (sgn * (by - ay)) / len, ny = (sgn * (ax - bx)) / len;
          if (ny <= 0.05) continue;   // faces up the screen: hidden under the top face
          const shade = nx < -0.35 ? 0 : nx > 0.35 ? 2 : 1;
          quads[shade] += `M${f(ax)},${f(ay)}L${f(bx)},${f(by)}L${f(bx)},${f(by + depth)}L${f(ax)},${f(ay + depth)}Z`;
        }
      });
      quads.forEach((d, shade) => {
        if (!d) return;
        const w = ledPath(d, 'ad-wall', walls);
        w.style.setProperty('--wall-base', baseOf(p));
        w.style.setProperty('--wall-mix', `${WALL_SHADE[shade]}%`);
        const key = keyOf(p);
        if (key) w.setAttribute('data-for', key);
      });
    });

    // The sheen: every shape at once under one top-left → bottom-right wash
    const svg = g.ownerSVGElement;
    const defs = svg && svg.querySelector('defs');
    if (defs && !defs.querySelector('#ad-sheen-grad')) {
      const grad = svgEl('linearGradient', '', defs);
      grad.id = 'ad-sheen-grad';
      [['x1', 0], ['y1', 0], ['x2', 1], ['y2', 1]].forEach(([a, v]) => grad.setAttribute(a, v));
      [[0, '#FFFFFF', 0.2], [0.5, '#FFFFFF', 0], [1, '#1D2433', 0.07]].forEach(([o, c, a]) => {
        const s = svgEl('stop', '', grad);
        s.setAttribute('offset', o);
        s.setAttribute('stop-color', c);
        s.setAttribute('stop-opacity', a);
      });
    }
    const sheen = ledPath(paths.map(p => p.getAttribute('d')).join(' '), 'ad-sheen', g);
    sheen.setAttribute('fill', 'url(#ad-sheen-grad)');
    sheen.setAttribute('aria-hidden', 'true');
  }

  // ----- Intro: faded tricolour, then electricity lights every border -----
  // The shape (all of India, or a state on drill-in) appears as one faded
  // tricolour silhouette with no inner borders and a navy 3D Ashoka Chakra
  // turning at its centre. Then golden electricity spreads out from a seed
  // (Delhi, or the state's capital district) neighbour by neighbour: the
  // seed, then every shape bordering it, then every shape bordering those,
  // and so on. It runs once round each shape's border, leaving it lit, and
  // the shape's colour fades in over the flag.
  // waveGap: between one ring of neighbours and the next; inWave: the small
  // stagger inside a ring, nearest the seed first
  const INTRO = { flagIn: 700, start: 1400, waveGap: 700, inWave: 40, run: 1200, fill: 700 };
  const STATE_INTRO = { flagIn: 450, start: 1100, waveGap: 450, inWave: 25, run: 1000, fill: 600 };
  // The district a state's wave starts from: the capital's. Haryana and
  // Punjab's capital, Chandigarh, is a territory of its own, so theirs start
  // next to it (Panchkula; S.A.S. Nagar, i.e. Mohali); Andhra Pradesh's
  // capital Amaravati is in Guntur. Without a match, the most central one.
  const CAPITAL_DISTRICT = {
    AN: 'South Andaman', AP: 'Guntur', AR: 'Papum Pare', AS: 'Kamrup Metropolitan',
    BR: 'Patna', CH: 'Chandigarh', CG: 'Raipur', DNH: 'Daman', GA: 'North Goa',
    GJ: 'Gandhinagar', HR: 'Panchkula', HP: 'Shimla', JK: 'Srinagar', JH: 'Ranchi',
    KA: 'Bengaluru Urban', KL: 'Thiruvananthapuram', LA: 'Leh', LD: 'Lakshadweep',
    MP: 'Bhopal', MH: 'Mumbai', MN: 'Imphal West', ML: 'East Khasi Hills', MZ: 'Aizawl',
    NL: 'Kohima', OD: 'Khordha', PB: 'S.A.S. Nagar', PY: 'Puducherry', RJ: 'Jaipur',
    SK: 'East Sikkim', TN: 'Chennai', TS: 'Hyderabad', TR: 'West Tripura',
    UK: 'Dehradun', UP: 'Lucknow', WB: 'Kolkata',
  };

  // Each shape's wave: 0 for the seed, 1 for its neighbours (shapes sharing
  // a border edge), and so on; shapes with no land neighbour (islands) get
  // one more wave after the last. dist: from the seed, for order in a wave.
  function revealWaves(paths, isSeed, mid, boxes) {
    const owners = new Map();
    paths.forEach((p, i) => parseRings(p.getAttribute('d')).forEach(r => {
      for (let j = 0; j < r.length; j++) {
        const [ax, ay] = r[j], [bx, by] = r[(j + 1) % r.length];
        if (ax === bx && ay === by) continue;
        const a = `${ax},${ay}`, b = `${bx},${by}`;
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        const o = owners.get(k);
        if (!o) owners.set(k, [i]);
        else if (!o.includes(i)) o.push(i);
      }
    }));
    const nbrs = paths.map(() => new Set());
    owners.forEach(o => o.forEach(i => o.forEach(j => { if (i !== j) nbrs[i].add(j); })));
    const centre = i => [boxes[i].x + boxes[i].width / 2, boxes[i].y + boxes[i].height / 2];
    let seed = isSeed ? paths.findIndex(isSeed) : -1;
    if (seed < 0) {
      let best = Infinity;
      paths.forEach((_, i) => {
        const [x, y] = centre(i), d = Math.hypot(x - mid[0], y - mid[1]);
        if (d < best) { best = d; seed = i; }
      });
    }
    const wave = paths.map(() => -1);
    wave[seed] = 0;
    for (const queue = [seed]; queue.length;) {
      const i = queue.shift();
      nbrs[i].forEach(j => { if (wave[j] < 0) { wave[j] = wave[i] + 1; queue.push(j); } });
    }
    const last = Math.max(...wave);
    wave.forEach((w, i) => { if (w < 0) wave[i] = last + 1; });
    const [sx, sy] = centre(seed);
    return { wave, dist: paths.map((_, i) => { const [x, y] = centre(i); return Math.hypot(x - sx, y - sy); }) };
  }
  // The spark's crackle: broken dashes (ending on a dash) ahead of the head
  const CRACKLE = [3, 2, 5, 1, 2, 3, 6, 2, 1, 2, 4];
  const CRACKLE_LEN = CRACKLE.reduce((a, b) => a + b, 0);

  // opts.chakraNudge: shifts the chakra across by this share of the shape's
  // width (see placeChakra). opts.outlineCurrent: a black current runs round
  // the shape's outer border while it loads (a state's drill-in).
  // opts.seed(path): true for the shape the electricity spreads out from.
  function playTricolourIntro(paths, lg, T, onDone, opts = {}) {
    const svg = document.getElementById('map-svg');
    const g = svg?.querySelector('#map-group');
    const labelsG = svg?.querySelector('#map-labels');
    const leds = svg?.querySelector('#map-leds');
    if (!svg || !g || !leds || !paths.length) {
      svg?.classList.remove('ad-intro');
      buildLeds(paths, lg, null);
      onDone();
      return;
    }

    // The shape's box: the flag's bands run top to bottom across it
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const boxes = paths.map(p => {
      const b = p.getBBox();
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height);
      return b;
    });
    const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };

    const defs = svg.querySelector('defs');
    defs.querySelector('#ad-tricolour')?.remove();
    const grad = svgEl('linearGradient', '', defs);
    grad.id = 'ad-tricolour';
    grad.setAttribute('gradientUnits', 'userSpaceOnUse');
    grad.setAttribute('x1', 0); grad.setAttribute('y1', y0);
    grad.setAttribute('x2', 0); grad.setAttribute('y2', y1);
    [[0, '#FFC48E'], [0.31, '#FFC48E'], [0.355, '#FFFFFF'],
     [0.645, '#FFFFFF'], [0.69, '#9FD199'], [1, '#9FD199']].forEach(([o, c]) => {
      const s = svgEl('stop', '', grad);
      s.setAttribute('offset', o);
      s.setAttribute('stop-color', c);
    });

    // One silhouette: each shape filled and stroked with the flag, so no
    // seam between neighbours shows
    const flag = svgEl('g', 'ad-intro-flag');
    paths.forEach(p => {
      const s = ledPath(p.getAttribute('d'), '', flag);
      s.setAttribute('fill', 'url(#ad-tricolour)');
      s.setAttribute('stroke', 'url(#ad-tricolour)');
    });
    const walls = g.querySelector('.ad-walls');
    g.insertBefore(flag, walls ? walls.nextSibling : g.firstChild);
    flag.animate([{ opacity: 0 }, { opacity: 1 }],
      { duration: T.flagIn, easing: 'ease-out', fill: 'backwards' });

    const spot = placeChakra(paths, box, Math.min(box.w, box.h / 3) * 0.375, opts.chakraNudge || 0);
    const mid = spot ? [spot.cx, spot.cy] : [x0 + box.w / 2, y0 + box.h / 2];

    const items = buildLeds(paths, lg);
    const { wave, dist } = revealWaves(paths, opts.seed, mid, boxes);
    const order = items
      .map((it, i) => ({ it, wave: wave[i], dist: dist[i] }))
      .sort((a, b) => a.wave - b.wave || a.dist - b.dist);
    // Each shape starts on its wave's turn, nearest the seed first
    const inRing = new Map();
    order.forEach(o => {
      const k = inRing.get(o.wave) || 0;
      inRing.set(o.wave, k + 1);
      o.t0 = T.start + o.wave * T.waveGap + Math.min(k * T.inWave, T.waveGap * 0.6);
    });

    const zap = svgEl('g', 'ad-zap', leds);
    const end = Math.max(...order.map(o => o.t0)) + T.run;

    // A black current runs once round the outer border across the whole
    // load, drawing a black line behind it that stays as the state's border
    // (settleBorders keeps it): per stretch of outline, the line plus a
    // tail, a crackle and a head riding its leading edge
    if (opts.outlineCurrent) {
      const current = svgEl('g', 'ad-current', leds);
      const lap = { delay: T.flagIn, duration: Math.max(600, end - T.flagIn - 200), easing: 'cubic-bezier(0.37, 0, 0.63, 1)', fill: 'both' };
      borderEdges(paths).outline().forEach(d => {
        const line = ledPath(d, 'ad-current-line', current);
        let len = 0;
        try { len = line.getTotalLength(); } catch (e) { /* not rendered */ }
        if (!(len > 0)) { line.remove(); return; }
        line.style.strokeDasharray = `${len} ${len}`;
        line.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], lap);
        [['ad-current-tail', Math.min(160, len * 0.25), null],
         ['ad-current-crackle', CRACKLE_LEN, CRACKLE],
         ['ad-current-head', Math.min(14, len * 0.05), null]].forEach(([cls, seg, pattern]) => {
          const el = ledPath(d, cls, current);
          el.style.strokeDasharray = `${pattern ? pattern.join(' ') : seg} ${len + seg}`;
          el.animate([{ strokeDashoffset: seg }, { strokeDashoffset: seg - len }], lap);
          el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.03 }, { opacity: 1, offset: 0.95 }, { opacity: 0 }],
            { delay: lap.delay, duration: lap.duration, fill: 'both' });
        });
      });
    }

    // The chakra sits above everything, then zooms out towards the viewer,
    // swelling far past the map's edges as it fades, gone just as the first
    // shape starts to appear
    const chakra = spot ? buildChakra(svg, spot.cx, spot.cy, spot.r) : null;
    if (chakra) {
      leds.appendChild(chakra);
      chakra.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: T.flagIn, easing: 'ease-out', fill: 'backwards' });
      const zoomOut = Math.min(500, T.start - T.flagIn);
      chakra.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(7)' }],
        { delay: T.start - zoomOut, duration: zoomOut, easing: 'cubic-bezier(0.55, 0, 0.75, 0.2)', fill: 'forwards' });
    }
    const ease = 'cubic-bezier(0.45, 0.05, 0.35, 1)';
    const crackleLen = CRACKLE_LEN;
    order.forEach(({ it, t0 }) => {
      drawLed(it, t0, T.run, ease);
      // The electricity: a flickering golden tail, a crackle of broken
      // sparks, and a white-hot head, all riding the lit edge
      const d = it.p.getAttribute('d');
      [['ad-zap-tail', Math.min(120, it.len * 0.3), null],
       ['ad-zap-crackle', crackleLen, CRACKLE],
       ['ad-zap-head', Math.min(12, it.len * 0.05), null]].forEach(([cls, seg, pattern]) => {
        const el = ledPath(d, cls, zap);
        el.style.strokeDasharray = `${pattern ? pattern.join(' ') : seg} ${it.len + seg}`;
        el.animate([{ strokeDashoffset: seg }, { strokeDashoffset: seg - it.len }],
          { delay: t0, duration: T.run, easing: ease, fill: 'both' });
        el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.04 }, { opacity: 1, offset: 0.88 }, { opacity: 0 }],
          { delay: t0, duration: T.run, fill: 'both' });
      });
      // Colour and labels arrive once the spark is most of the way round
      // (.ad-state.empty-state rests at 0.75 in the CSS; districts at 1)
      const fo = it.p.matches('.ad-state.empty-state') ? 0.75 : 1;
      it.p.animate([{ fillOpacity: 0, strokeOpacity: 0 }, { fillOpacity: fo, strokeOpacity: 1 }],
        { delay: t0 + T.run * 0.55, duration: T.fill, easing: 'ease-out', fill: 'both' });
      const key = it.p.dataset.district || it.p.dataset.abbr;
      labelsG?.querySelectorAll(`[data-for="${CSS.escape(key)}"]`).forEach(el =>
        el.animate([{ opacity: 0 }, { opacity: 1 }],
          { delay: t0 + T.run * 0.8, duration: 450, easing: 'ease-out', fill: 'both' }));
    });

    flag.animate([{ opacity: 1 }, { opacity: 0 }], { delay: end - 600, duration: 600, fill: 'forwards' });

    setTimeout(() => {
      // Superseded by another render (e.g. Back pressed mid-intro)
      if (lg !== ledGeneration || !flag.isConnected) return;
      svg.classList.remove('ad-intro');
      paths.forEach(p => p.getAnimations().forEach(a => a.cancel()));
      labelsG?.querySelectorAll('[data-for]').forEach(el => el.getAnimations().forEach(a => a.cancel()));
      flag.remove();
      chakra?.remove();
      settleBorders(paths, lg);
      onDone();
    }, end + 150);
  }

  // Ashoka Chakra in navy, made 3D: a darker copy beneath for the wheel's
  // thickness, and the face lit by a fixed light (an SVG lighting filter)
  // while the wheel turns under it, so its highlights move like metal
  function buildChakra(svg, cx, cy, r) {
    const defs = svg.querySelector('defs');
    defs.querySelector('#ad-chakra-3d')?.remove();
    const f = svgEl('filter', '', defs);
    f.id = 'ad-chakra-3d';
    [['x', '-30%'], ['y', '-30%'], ['width', '160%'], ['height', '160%']].forEach(([a, v]) => f.setAttribute(a, v));
    f.innerHTML = `
      <feGaussianBlur in="SourceAlpha" stdDeviation="${(r * 0.025).toFixed(2)}" result="bump"/>
      <feSpecularLighting in="bump" surfaceScale="${(r * 0.06).toFixed(2)}" specularConstant="1.15"
          specularExponent="20" lighting-color="#E4ECFF" result="spec">
        <feDistantLight azimuth="235" elevation="40"/>
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="shine"/>
      <feComposite in="SourceGraphic" in2="shine" operator="arithmetic" k2="1" k3="0.9" result="lit"/>
      <feDropShadow in="lit" dx="${(r * 0.03).toFixed(2)}" dy="${(r * 0.07).toFixed(2)}"
          stdDeviation="${(r * 0.05).toFixed(2)}" flood-color="#0B163F" flood-opacity="0.4"/>`;

    const c = svgEl('g', 'ad-chakra');
    c.setAttribute('aria-hidden', 'true');
    const wheel = (cls, dy) => {
      const shift = svgEl('g', '', c);
      if (dy) shift.setAttribute('transform', `translate(0 ${dy.toFixed(2)})`);
      const w = svgEl('g', `ad-chakra-wheel ${cls}`, shift);
      const circle = (rad, stroke, fill) => {
        const e = svgEl('circle', '', w);
        e.setAttribute('cx', cx); e.setAttribute('cy', cy); e.setAttribute('r', rad.toFixed(2));
        if (stroke) e.setAttribute('stroke-width', stroke.toFixed(2));
        if (fill) e.setAttribute('class', 'fill');
        return e;
      };
      circle(r * 0.955, r * 0.09);   // rim
      circle(r * 0.15, 0, true);     // hub
      circle(r * 0.24, r * 0.035);   // hub ring
      // 24 tapered spokes, and a bead on the rim between each pair
      let spokes = '';
      for (let k = 0; k < 24; k++) {
        const a = (k * Math.PI) / 12, half = Math.PI / 80;
        const pt = (rad, ang) => `${(cx + Math.cos(ang) * rad).toFixed(2)},${(cy + Math.sin(ang) * rad).toFixed(2)}`;
        spokes += `M ${pt(r * 0.2, a)} L ${pt(r * 0.52, a - half)} L ${pt(r * 0.9, a)} L ${pt(r * 0.52, a + half)} Z `;
        const bead = circle(r * 0.028, 0, true);
        bead.setAttribute('cx', (cx + Math.cos(a + Math.PI / 24) * r * 0.86).toFixed(2));
        bead.setAttribute('cy', (cy + Math.sin(a + Math.PI / 24) * r * 0.86).toFixed(2));
      }
      ledPath(spokes, 'fill', w);
      return w;
    };
    wheel('back', r * 0.05);
    const front = wheel('front', 0);
    front.parentNode.setAttribute('filter', 'url(#ad-chakra-3d)');
    return c;
  }

  // ----- State names -----
  // Each state's full name, with its vacancy count beneath, is fitted inside
  // its own borders: the largest size that fits at the roomiest spots,
  // trying one to three lines and, for long narrow states, a tilt. Areas too
  // small for a readable name get a tag just outside, with a leader line.
  const LABEL = { max: 15, min: 6.5, lineH: 1.12, countScale: 1.25, padX: 0.3, padY: 0.12, tag: 8.5 };
  const LABEL_NAMES = {
    JK: 'Jammu & Kashmir',
    AN: 'Andaman & Nicobar Islands',
    DNH: 'Dadra & Nagar Haveli and Daman & Diu',
  };
  const LABEL_TILTS = [-30, 30, -55, 55, -80, 80];
  const labelFitCache = new Map();

  // A state's shape for label fitting: flat coordinate arrays per ring plus
  // bounding boxes, so the many point/edge tests below can skip whole rings
  function labelShape(d) {
    const rings = parseRings(d).map(r => {
      const n = r.length, xs = new Float64Array(n), ys = new Float64Array(n);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = r[i][0], y = r[i][1];
        xs[i] = x; ys[i] = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return { n, xs, ys, x0, y0, x1, y1 };
    });
    const b = rings.reduce((a, r) => ({
      x0: Math.min(a.x0, r.x0), y0: Math.min(a.y0, r.y0), x1: Math.max(a.x1, r.x1), y1: Math.max(a.y1, r.y1),
    }), { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    return { rings, ...b, w: b.x1 - b.x0, h: b.y1 - b.y0 };
  }

  // Even-odd: a ring whose box misses the point can't change the answer
  function inShape(sh, x, y) {
    if (x < sh.x0 || x > sh.x1 || y < sh.y0 || y > sh.y1) return false;
    let inside = false;
    for (const r of sh.rings) {
      if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
      const xs = r.xs, ys = r.ys;
      for (let i = 0, j = r.n - 1; i < r.n; j = i++) {
        if ((ys[i] > y) !== (ys[j] > y) && x < ((xs[j] - xs[i]) * (y - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
      }
    }
    return inside;
  }
  function edgeDist(sh, x, y) {
    let best = Infinity;
    for (const r of sh.rings) {
      const xs = r.xs, ys = r.ys;
      for (let i = 0, j = r.n - 1; i < r.n; j = i++) {
        const ax = xs[j], ay = ys[j], dx = xs[i] - ax, dy = ys[i] - ay, l2 = dx * dx + dy * dy;
        let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = x - ax - t * dx, ey = y - ay - t * dy, d2 = ex * ex + ey * ey;
        if (d2 < best) best = d2;
      }
    }
    return Math.sqrt(best);
  }
  // Does segment a→b cross any edge of the shape?
  function crossesShape(sh, ax, ay, bx, by) {
    const sx0 = Math.min(ax, bx), sx1 = Math.max(ax, bx), sy0 = Math.min(ay, by), sy1 = Math.max(ay, by);
    const ux = bx - ax, uy = by - ay;
    for (const r of sh.rings) {
      if (sx1 < r.x0 || sx0 > r.x1 || sy1 < r.y0 || sy0 > r.y1) continue;
      const xs = r.xs, ys = r.ys;
      for (let i = 0, j = r.n - 1; i < r.n; j = i++) {
        const cx = xs[j], cy = ys[j], dx = xs[i], dy = ys[i];
        if ((cx < sx0 && dx < sx0) || (cx > sx1 && dx > sx1) || (cy < sy0 && dy < sy0) || (cy > sy1 && dy > sy1)) continue;
        const s1 = ux * (cy - ay) - uy * (cx - ax), s2 = ux * (dy - ay) - uy * (dx - ax);
        if ((s1 > 0) === (s2 > 0)) continue;
        const vx = dx - cx, vy = dy - cy;
        const s3 = vx * (ay - cy) - vy * (ax - cx), s4 = vx * (by - cy) - vy * (bx - cx);
        if ((s3 > 0) !== (s4 > 0)) return true;
      }
    }
    return false;
  }
  // Inside points on a grid, roomiest (farthest from the border) first
  function roomiestPoints(sh, n) {
    const step = Math.max(sh.w, sh.h) / 18;
    if (!(step > 0)) return [];
    const pts = [];
    for (let x = sh.x0 + step / 2; x < sh.x1; x += step) {
      for (let y = sh.y0 + step / 2; y < sh.y1; y += step) {
        if (inShape(sh, x, y)) pts.push([x, y, edgeDist(sh, x, y)]);
      }
    }
    return pts.sort((p, q) => q[2] - p[2]).slice(0, n);
  }

  function layoutStateLabels(states, labelsG) {
    if (!labelsG || !states.length) return;
    // Text widths at font-size 1, in the labels' own font
    const probe = svgEl('text', '', labelsG);
    probe.style.fontSize = '100px';
    const widths = new Map();
    const textW = (text, cls) => {
      const k = `${cls}|${text}`;
      if (!widths.has(k)) {
        probe.setAttribute('class', cls);
        probe.textContent = text;
        widths.set(k, probe.getComputedTextLength() / 100);
      }
      return widths.get(k);
    };

    const shapes = new Map(states.map(st => [st.abbr, labelShape(st.path.getAttribute('d'))]));
    const placed = [];
    const tags = [];
    states.forEach(st => {
      const name = LABEL_NAMES[st.abbr] || st.name;
      const key = `${st.abbr}|${name}|${st.count}`;
      if (!labelFitCache.has(key)) labelFitCache.set(key, fitLabel(name, st.count, shapes.get(st.abbr), textW));
      const fit = labelFitCache.get(key);
      if (fit) {
        drawFittedLabel(st, fit, labelsG);
        placed.push(fit.box);
      } else {
        tags.push({ st, name });
      }
    });
    tags.forEach(({ st, name }) => drawTagLabel(st, name, shapes, placed, labelsG, textW));
    probe.remove();
  }

  function fitLabel(name, count, sh, textW) {
    const countStr = count > 0 ? String(count) : '';
    const widest = lines => Math.max(...lines.map(l => textW(l, 'ad-state-label')));

    // One line, plus the most balanced two- and three-line breaks
    const words = name.split(' ');
    const two = [], three = [];
    for (let i = 1; i < words.length; i++) {
      two.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
      for (let j = i + 1; j < words.length; j++) {
        three.push([words.slice(0, i).join(' '), words.slice(i, j).join(' '), words.slice(j).join(' ')]);
      }
    }
    const splits = [[name]];
    [two, three].forEach(c => { if (c.length) splits.push(c.reduce((a, b) => (widest(a) <= widest(b) ? a : b))); });

    // Each block's size at font-size 1 (scaled by the size being tried)
    const cw = countStr ? textW(countStr, 'ad-state-count') * LABEL.countScale : 0;
    const blocks = splits.map(lines => ({
      lines,
      w: Math.max(widest(lines), cw) + 2 * LABEL.padX,
      h: lines.length * LABEL.lineH + (countStr ? LABEL.countScale * 1.05 : 0) + 2 * LABEL.padY,
      weight: [1, 0.96, 0.9][lines.length - 1],
    }));

    const corners = (x, y, rad, blk, s) => {
      const hw = (blk.w * s) / 2, hh = (blk.h * s) / 2, c = Math.cos(rad), sn = Math.sin(rad);
      return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [x + u * c - v * sn, y + u * sn + v * c]);
    };
    const fits = (x, y, rad, blk, s) => {
      const k = corners(x, y, rad, blk, s);
      for (const [px, py] of k) if (!inShape(sh, px, py)) return false;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = k[i], [bx, by] = k[(i + 1) % 4];
        if (crossesShape(sh, ax, ay, bx, by)) return false;
      }
      return true;
    };

    // Largest size above `floor` that fits here, or 0
    const sizeAt = (x, y, rad, blk, floor) => {
      let lo = Math.max(LABEL.min, floor + 0.01);
      if (lo > LABEL.max || !fits(x, y, rad, blk, lo)) return 0;
      let hi = LABEL.max;
      if (fits(x, y, rad, blk, hi)) return hi;
      for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (fits(x, y, rad, blk, m)) lo = m; else hi = m; }
      return lo;
    };

    const spots = roomiestPoints(sh, 12);
    const found = [];
    let bestScore = 0;
    const tryAt = (x, y, deg, blk) => {
      // Upright reads best: the steeper the tilt, the bigger it must fit
      const weight = blk.weight * (1 - 0.0055 * Math.abs(deg));
      const rad = (deg * Math.PI) / 180;
      const size = sizeAt(x, y, rad, blk, bestScore / weight);
      if (!size) return;
      bestScore = Math.max(bestScore, size * weight);
      found.push({ x, y, deg, rad, blk, weight, s: size, score: size * weight });
    };
    spots.forEach(([x, y]) => blocks.forEach(blk => tryAt(x, y, 0, blk)));
    spots.forEach(([x, y]) => blocks.forEach(blk => LABEL_TILTS.forEach(deg => tryAt(x, y, deg, blk))));
    if (!found.length) return null;

    // Slide the few best placements around while the name can grow
    let best = null;
    found.sort((a, b) => b.score - a.score).slice(0, 4).forEach(f => {
      let cur = f, step = Math.max(sh.w, sh.h) / 30, guard = 40;
      while (step > 0.4 && guard-- > 0) {
        let moved = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const x = cur.x + dx * step, y = cur.y + dy * step;
          const size = sizeAt(x, y, cur.rad, cur.blk, cur.s);
          if (size > cur.s) { cur = { ...cur, x, y, s: size, score: size * cur.weight }; moved = true; break; }
        }
        if (!moved) step /= 2;
      }
      if (!best || cur.score > best.score) best = cur;
    });

    const k = corners(best.x, best.y, best.rad, best.blk, best.s);
    const xs = k.map(p => p[0]), ys = k.map(p => p[1]);
    return {
      x: best.x, y: best.y, deg: best.deg, s: best.s, lines: best.blk.lines, h: best.blk.h, countStr,
      box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
    };
  }

  function drawFittedLabel(st, fit, labelsG) {
    const s = fit.s;
    const g = svgEl('g', 'ad-label-block', labelsG);
    g.setAttribute('transform',
      `translate(${fit.x.toFixed(1)} ${fit.y.toFixed(1)})${fit.deg ? ` rotate(${fit.deg})` : ''}`);
    // Lines are centred on their line box; 0.35em drops the baseline so the
    // letters sit in the middle of it
    const top = (-fit.h / 2 + LABEL.padY) * s;
    const name = svgEl('text', 'ad-state-label', g);
    name.setAttribute('data-for', st.abbr);
    name.style.fontSize = `${s.toFixed(2)}px`;
    fit.lines.forEach((line, i) => {
      const t = svgEl('tspan', '', name);
      t.setAttribute('x', 0);
      t.setAttribute('y', (top + (i + 0.5) * LABEL.lineH * s + 0.35 * s).toFixed(2));
      t.textContent = line;
    });
    // Always drawn (empty when 0) so the filters and live updates can set it
    const cs = s * LABEL.countScale;
    const num = svgEl('text', `ad-state-count${fit.countStr ? '' : ' empty'}`, g);
    num.setAttribute('data-for', st.abbr);
    num.setAttribute('x', 0);
    num.setAttribute('y', (top + fit.lines.length * LABEL.lineH * s + 0.525 * cs + 0.35 * cs).toFixed(2));
    num.style.fontSize = `${cs.toFixed(2)}px`;
    num.textContent = fit.countStr;
  }

  // Tags placed by hand: Chandigarh's out west of Punjab (beyond India's
  // border); Sikkim's just above the state and Meghalaya's just below it
  const TAG_PLACE = { CH: { westOf: 'PB' }, SK: { side: 'above' }, ML: { side: 'below' } };

  // A tag beside an area too small to hold its name: out at sea if
  // possible, never over another label, joined to the area by a leader
  function drawTagLabel(st, name, shapes, placed, labelsG, textW) {
    // Point at the area's largest piece (Puducherry, Lakshadweep and the
    // islands are scattered; their overall box centre is elsewhere)
    const whole = shapes.get(st.abbr);
    const ringArea = r => {
      let a = 0;
      for (let i = 0, j = r.n - 1; i < r.n; j = i++) a += (r.xs[j] + r.xs[i]) * (r.ys[j] - r.ys[i]);
      return Math.abs(a / 2);
    };
    const main = whole.rings.reduce((p, q) => (ringArea(q) > ringArea(p) ? q : p));
    const b = { rings: [main], x0: main.x0, y0: main.y0, x1: main.x1, y1: main.y1, w: main.x1 - main.x0, h: main.y1 - main.y0 };
    const spot = roomiestPoints(b, 1)[0];
    const [ax, ay] = spot ? spot : [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const s = LABEL.tag;
    const countStr = st.count > 0 ? String(st.count) : '';
    const padX = s * 0.6, gap = countStr ? s * 0.5 : 0;
    const W = textW(name, 'ad-state-label') * s + gap + (countStr ? textW(countStr, 'ad-state-count') * s : 0) + 2 * padX;
    const H = s * 1.7;

    const overlaps = (box) => placed.some(p =>
      box.x < p.x + p.w + 2 && p.x < box.x + box.w + 2 && box.y < p.y + p.h + 2 && p.y < box.y + box.h + 2);
    const onLand = (box) => {
      for (const fx of [0, 0.5, 1]) {
        for (const fy of [0, 0.5, 1]) {
          const px = box.x + fx * box.w, py = box.y + fy * box.h;
          for (const sh of shapes.values()) if (inShape(sh, px, py)) return true;
        }
      }
      return false;
    };
    // Liang–Barsky: does the leader from the area to this point cut a label?
    const cutsLabel = (ex, ey) => placed.some(p => {
      let t0 = 0, t1 = 1;
      const dx = ex - ax, dy = ey - ay;
      for (const [q, v] of [[-dx, ax - p.x], [dx, p.x + p.w - ax], [-dy, ay - p.y], [dy, p.y + p.h - ay]]) {
        if (q === 0) { if (v < 0) return false; continue; }
        const t = v / q;
        if (q < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
      return t0 < t1;
    });
    let box = null;
    const hint = TAG_PLACE[st.abbr];
    if (hint?.westOf && shapes.get(hint.westOf)) {
      box = { x: shapes.get(hint.westOf).x0 - 8 - W, y: ay - H / 2, w: W, h: H };
    } else if (hint?.side) {
      // Far enough off the state for the leader to show
      box = { x: (b.x0 + b.x1) / 2 - W / 2, y: hint.side === 'above' ? b.y0 - 12 - H : b.y1 + 12, w: W, h: H };
    }
    search:
    for (const [sea, clean] of box ? [] :  [[true, true], [false, true], [false, false]]) {
      for (const r of [8, 16, 26, 38, 52, 68, 86]) {
        for (const deg of [180, 0, 210, 150, 330, 30, 240, 120, 300, 60, 270, 90]) {
          const ux = Math.cos((deg * Math.PI) / 180), uy = Math.sin((deg * Math.PI) / 180);
          // Start just past the area's own box in this direction
          const reach = Math.abs(ux) * (ux > 0 ? b.x1 - ax : ax - b.x0) + Math.abs(uy) * (uy > 0 ? b.y1 - ay : ay - b.y0);
          const cx = ax + ux * (reach + r + W / 2), cy = ay + uy * (reach + r + H / 2);
          const cand = { x: cx - W / 2, y: cy - H / 2, w: W, h: H };
          if (cand.x < 4 || cand.y < 4 || cand.x + W > 996 || cand.y + H > 796) continue;
          if (overlaps(cand) || (sea && onLand(cand))) continue;
          if (clean && cutsLabel(Math.max(cand.x, Math.min(ax, cand.x + W)), Math.max(cand.y, Math.min(ay, cand.y + H)))) continue;
          box = cand;
          break search;
        }
      }
    }
    if (!box) return;
    placed.push(box);

    const nx = Math.max(box.x, Math.min(ax, box.x + box.w));
    const ny = Math.max(box.y, Math.min(ay, box.y + box.h));
    const leader = svgEl('line', 'ad-tag-leader', labelsG);
    leader.setAttribute('data-for', st.abbr);
    [['x1', ax], ['y1', ay], ['x2', nx], ['y2', ny]].forEach(([a, v]) => leader.setAttribute(a, v.toFixed(1)));
    const dot = svgEl('circle', 'ad-tag-dot', labelsG);
    dot.setAttribute('data-for', st.abbr);
    dot.setAttribute('cx', ax.toFixed(1)); dot.setAttribute('cy', ay.toFixed(1)); dot.setAttribute('r', 1.6);

    const tag = svgEl('g', 'ad-tag', labelsG);
    tag.setAttribute('data-for', st.abbr);
    const pill = svgEl('rect', 'ad-tag-pill', tag);
    [['x', box.x], ['y', box.y], ['width', W], ['height', H], ['rx', H / 2]]
      .forEach(([a, v]) => pill.setAttribute(a, v.toFixed(1)));
    const baseline = (box.y + H / 2 + 0.35 * s).toFixed(1);
    const nm = svgEl('text', 'ad-state-label ad-tag-name', tag);
    nm.setAttribute('x', (box.x + padX).toFixed(1));
    nm.setAttribute('y', baseline);
    nm.style.fontSize = `${s}px`;
    nm.textContent = name;
    const num = svgEl('text', `ad-state-count ad-tag-count${countStr ? '' : ' empty'}`, tag);
    num.setAttribute('data-for', st.abbr);
    num.setAttribute('x', (box.x + W - padX).toFixed(1));
    num.setAttribute('y', baseline);
    num.style.fontSize = `${s}px`;
    num.textContent = countStr;

    // The area itself is hard to hit, so the tag opens it too
    tag.addEventListener('click', () => navigateToState(st.abbr));
    tag.addEventListener('mouseenter', (e) => { showTooltip(e, st.abbr, st.name, st.count); setSpotlight(st.path); });
    tag.addEventListener('mousemove', moveTooltip);
    tag.addEventListener('mouseleave', () => {
      hideTooltip();
      if (st.path.classList.contains('is-spot')) setSpotlight(null);
    });
  }

  // One subtle ring when a live insert lands on a state (realtime only)
  function spawnRipple(targetPath) {
    const ns = 'http://www.w3.org/2000/svg';
    const bbox = targetPath.getBBox();
    const ring = document.createElementNS(ns, 'circle');
    ring.setAttribute('cx', bbox.x + bbox.width / 2);
    ring.setAttribute('cy', bbox.y + bbox.height / 2);
    ring.setAttribute('r', '4');
    ring.setAttribute('class', 'ad-ripple');
    targetPath.parentNode.appendChild(ring);
    setTimeout(() => ring.remove(), 1400);
  }

  // ----- Drill to state -----
  // Rendering only — never touches history. Resolves true when the state
  // view is on screen, false when superseded by a newer navigation or when
  // district geometry could not be loaded.
  function isOnState(abbr) {
    return selectedAbbr === abbr && (viewMode === 'state' || viewMode === 'district');
  }

  async function drillToState(abbr, name) {
    if (isOnState(abbr)) return true;
    lastFocusedState = abbr;
    const gen = ++renderGeneration; // (J) render navigation generation
    // The national paths are about to be replaced, so their mouseleave will
    // never fire — clear the hover tooltip now or it sticks over the new view.
    // The lifted state eases back to its true size before the zoom lands.
    hideTooltip();
    setSpotlight(null);

    // Delhi uses the image map; every other state needs district GeoJSON
    if (abbr !== 'DL') {
      const dGeo = await ensureDistrictsLoaded();
      if (gen !== renderGeneration || !dGeo) return false;
    }

    const sel = document.querySelector(`#map-svg [data-abbr="${abbr}"].ad-state`);
    if (sel) {
      sel.style.transition = 'fill 0.2s, stroke 0.2s';
      sel.classList.add('selected');
      setOutline(sel, 'selected');
    }

    await cinematicZoom(abbr, sel);
    if (gen !== renderGeneration) return false;

    renderState(abbr, name);
    selectedAbbr = abbr;
    viewMode = 'state';
    const back = document.getElementById('btn-back');
    if (back) { back.hidden = false; back.focus(); }
    announce(abbr === 'DL'
      ? `${name}: showing 11 districts. Click a district for details.`
      : `${name}: zoomed in. Explore districts for ${name}.`);
    return true;
  }

  // The state's box in viewBox units: its national path when on screen,
  // otherwise its districts in the current projection.
  function stateBox(abbr, sel) {
    if (sel && sel.isConnected) {
      try {
        const b = sel.getBBox();
        if (b.width > 0 && b.height > 0) return { x: b.x, y: b.y, width: b.width, height: b.height };
      } catch (e) { /* not rendered */ }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    districtFeaturesFor(abbr).forEach(f => flattenCoords(f.geometry).forEach(([lon, lat]) => {
      const [x, y] = project(lon, lat);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }));
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  async function cinematicZoom(abbr, sel) {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const box = stateBox(abbr, sel);
    if (!box) return;

    // End on the state framed the way renderState() frames its districts
    // (padBox of what is drawn, placed by stateViewBox), so the hand-off to
    // the district view lands where the zoom ended instead of jumping.
    const target = stateViewBox(padBox(box), stateLayout());
    // No hover tooltips from states sliding under a still cursor mid-zoom
    svg.classList.add('ad-zooming');
    try {
      await animateViewBox(svg, { x: vb.x, y: vb.y, w: vb.width, h: vb.height }, target, 700);
    } finally {
      svg.classList.remove('ad-zooming');
    }
  }

  // Zooms geometrically about the centre of the smaller of the two boxes.
  // That point stays on screen for the whole animation and glides from its
  // start position to its end position, so a 50× zoom into a small UT never
  // flies past it (linear viewBox interpolation does).
  function animateViewBox(svg, start, target, duration) {
    return new Promise(resolve => {
      const vb = svg.viewBox.baseVal;
      const inner = target.w < start.w ? target : start;
      const px = inner.x + inner.w / 2, py = inner.y + inner.h / 2;
      const u0 = (px - start.x) / start.w, u1 = (px - target.x) / target.w;
      const v0 = (py - start.y) / start.h, v1 = (py - target.y) / target.h;
      function apply(e) {
        const w = start.w * Math.pow(target.w / start.w, e);
        const h = start.h * Math.pow(target.h / start.h, e);
        vb.x = px - (u0 + (u1 - u0) * e) * w;
        vb.y = py - (v0 + (v1 - v0) * e) * h;
        vb.width = w;
        vb.height = h;
      }
      const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
      const t0 = performance.now();
      const id = ++viewBoxAnimId; // a newer animation supersedes this one
      let resolved = false;
      function finish() {
        if (resolved) return;
        resolved = true;
        if (id !== viewBoxAnimId) { resolve(); return; } // superseded: don't touch the viewBox
        zoomAnimFrame = null;
        apply(1);
        resolve();
      }
      if (zoomAnimFrame) cancelAnimationFrame(zoomAnimFrame);
      function frame(now) {
        if (resolved || id !== viewBoxAnimId) return;
        const t = Math.min((now - t0) / duration, 1);
        apply(ease(t));
        if (t < 1) zoomAnimFrame = requestAnimationFrame(frame);
        else finish();
      }
      zoomAnimFrame = requestAnimationFrame(frame);
      // Safety: if RAF is throttled, land on the target after duration + margin
      setTimeout(finish, duration + 200);
    });
  }

  // ===== Delhi image-map drill-down =====
  // Delhi districts: { name, left, top, width, height, image } — percentages
  // relative to the coloured overview image (1472×1344).
  const DELHI_DISTRICTS = [
    { name: 'North',        left: 42, top:  2, width: 24, height: 20, image: 'd7-north.webp' },
    { name: 'North West',   left: 28, top: 16, width: 20, height: 22, image: 'd8-north_west.webp' },
    { name: 'West',         left: 26, top: 38, width: 20, height: 20, image: 'd5-west.webp' },
    { name: 'South West',   left: 16, top: 60, width: 26, height: 22, image: 'd3-south_west.webp' },
    { name: 'North East',   left: 68, top:  4, width: 20, height: 28, image: 'd10-north_east.webp' },
    { name: 'Shahdara',     left: 70, top: 24, width: 18, height: 20, image: 'd9-shahadara.webp' },
    { name: 'East',         left: 76, top: 42, width: 16, height: 20, image: 'd6-east.webp' },
    { name: 'Central',      left: 62, top: 28, width: 14, height: 14, image: 'd11-central.webp' },
    { name: 'New Delhi',    left: 44, top: 52, width: 20, height: 24, image: 'd2-new_delhi.webp' },
    { name: 'South East',   left: 72, top: 62, width: 18, height: 22, image: 'd04-south_east.jpg' },
    { name: 'South',        left: 40, top: 78, width: 22, height: 18, image: 'd1-south.webp' }
  ];

  function renderDelhiImageMap(abbr, name, data) {
    clearMap();
    const back = document.getElementById('btn-back');
    if (back) back.hidden = false;
    viewMode = 'state';
    selectedAbbr = abbr;

    const districtEntries = DELHI_DISTRICTS.map(d => {
      const key = `${abbr.toLowerCase()}|${d.name.toLowerCase()}`;
      const count = (data.districtCounts?.[key]) ||
        IndiaMapData.getListingsForDistrict(abbr, d.name).length;
      return { name: d.name, count, image: d.image };
    });

    const hotspots = DELHI_DISTRICTS.map(d => {
      const entry = districtEntries.find(e => e.name === d.name);
      const count = entry ? entry.count : 0;
      const zeroAttr = count === 0 ? ' data-zero="true"' : '';
      const countDisplay = count > 0
        ? `<span class="ad-delhi-count">${count}</span>` : '';
      return `<button class="ad-delhi-hotspot"${zeroAttr}
        style="left:${d.left}%;top:${d.top}%;width:${d.width}%;height:${d.height}%"
        data-district="${d.name}"
        data-image="${d.image}"
        aria-label="${d.name}: ${count} listings">
        ${countDisplay}
      </button>`;
    }).join('');

    const mapArea = document.getElementById('mapSvgWrap');
    if (mapArea) {
      mapArea.innerHTML = `
        <div class="ad-delhi-map-wrap">
          <img src="img/delhi/delhi-coloured.jpg" alt="Delhi district map" class="ad-delhi-map-img" draggable="false">
          <img src="" alt="District preview" class="ad-delhi-preview-img" draggable="false" aria-hidden="true">
          <div class="ad-delhi-hotspots">${hotspots}</div>
        </div>
      `;

      const container = mapArea.querySelector('.ad-delhi-hotspots');
      container.querySelectorAll('.ad-delhi-hotspot').forEach(btn => {
        // Same navigation layer as every other district click
        btn.addEventListener('click', () => navigateToDistrict(abbr, btn.dataset.district));
        btn.addEventListener('mouseenter', () => {
          const previewImg = mapArea.querySelector('.ad-delhi-preview-img');
          if (previewImg) {
            previewImg.src = `img/delhi/${btn.dataset.image}`;
            previewImg.classList.add('visible');
          }
        });
        btn.addEventListener('mouseleave', () => {
          const previewImg = mapArea.querySelector('.ad-delhi-preview-img');
          if (previewImg) previewImg.classList.remove('visible');
        });
      });
    }

    updateStateListButton(abbr, name, DELHI_DISTRICTS.map(d => d.name));
    announce(`${name}: showing ${DELHI_DISTRICTS.length} districts. Click a district for details.`);
  }

  // Delhi district photo behind the listings modal. Rendering only — the
  // modal and history are owned by openDistrictModal() / the navigation layer.
  function renderDelhiDistrictView(districtName) {
    const dist = DELHI_DISTRICTS.find(d => d.name === districtName);
    const mapArea = document.getElementById('mapSvgWrap');
    if (!dist || !mapArea) return;
    mapArea.innerHTML = `
      <div class="ad-delhi-district-view">
        <img src="img/delhi/${dist.image}" alt="${esc(districtName)}" class="ad-delhi-district-img" draggable="false">
        <button class="ad-delhi-back-btn" id="delhiBackBtn" aria-label="Back to Delhi overview">← Delhi overview</button>
      </div>
    `;
    document.getElementById('delhiBackBtn').addEventListener('click', closeDistrict);
  }

  // ----- State title: the open state's name, large, beside it -----
  // A small monospace line (state or union territory, and its districts),
  // the name sized to fill its space, a gold rule and the vacancy count.
  // Once the state has fully loaded (one animation at a time) it decodes in:
  // corner brackets lock on, the small line types itself, each letter of
  // the name cycles through random characters before settling while a gold
  // scan line sweeps across, then the rule draws and the count ticks up.
  // Letters sit in fixed-width boxes while they cycle, so nothing shifts.
  const UNION_TERRITORIES = new Set(['AN', 'CH', 'DNH', 'DL', 'JK', 'LA', 'LD', 'PY']);
  const SCRAMBLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<>/#%&*+=';
  const TITLE_LINE_H = 0.98;     // the name's line height, in ems
  // px above and below the name: small line, rule and count; in a portrait
  // band the count is dropped (.compact) so a short band still fits a name
  const TITLE_EXTRA = { side: 86, band: 46 };
  let titleRun = 0;              // bumped to stop a reveal in progress
  const TITLE_REVEAL = 1800;     // ms the decode takes

  function hideStateTitle() {
    titleRun++;
    const el = document.getElementById('mapStateTitle');
    if (el) { el.hidden = true; el.innerHTML = ''; el.className = 'map-state-title'; }
  }

  // The largest size the name fits at in width × height, on one to three
  // balanced lines (fewer lines win a near tie)
  function fitTitleName(name, family, width, height, max, extra) {
    const ctx = fitTitleName.ctx || (fitTitleName.ctx = document.createElement('canvas').getContext('2d'));
    ctx.font = `700 100px ${family}`;
    const w = t => ctx.measureText(t).width / 100 - 0.02 * t.length;   // -0.02em tracking
    const words = name.split(' ');
    const options = [[name]];
    const widest = lines => Math.max(...lines.map(w));
    const two = [], three = [];
    for (let i = 1; i < words.length; i++) {
      two.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
      for (let j = i + 1; j < words.length; j++) {
        three.push([words.slice(0, i).join(' '), words.slice(i, j).join(' '), words.slice(j).join(' ')]);
      }
    }
    // Never a line that is only a joining word ("&", "and")
    const lone = lines => lines.some(l => /^(&|and|of|the)$/i.test(l));
    [two, three].forEach(c => {
      const ok = c.filter(lines => !lone(lines));
      if (ok.length) options.push(ok.reduce((a, b) => (widest(a) <= widest(b) ? a : b)));
    });
    let best = null;
    options.forEach(lines => {
      const size = Math.min(width / widest(lines), (height - extra) / (lines.length * TITLE_LINE_H), max);
      const score = size * [1, 0.94, 0.88][lines.length - 1];
      if (!best || score > best.score) best = { lines, size, score, charW: ch => Math.max(0, w(ch)) };
    });
    return best && best.size >= 14 ? best : null;
  }

  // Positions the title for the current layout and sizes its name; returns
  // the fit, or null when there's no room for it
  function placeStateTitle(el, name) {
    const layout = stateLayout();
    if (!layout) return null;
    const nameEl = el.querySelector('.mst-name');
    const family = getComputedStyle(nameEl).fontFamily;
    let box, align;
    if (layout.mode === 'side') {
      box = layout.title;
      align = 'right';
      el.style.left = '';
      el.style.right = `${box.right}px`;
    } else {
      // Portrait: the larger free band above or below the state
      const area = document.getElementById('mapContainer').getBoundingClientRect();
      const g = document.getElementById('map-group')?.getBoundingClientRect();
      if (!g || !g.height) return null;
      const head = Math.max(...['btn-back', 'stateListBtn', 'mapCounter']
        .map(id => mapAreaRect(document.getElementById(id))).filter(Boolean).map(r => r.bottom), 0);
      const foot = Math.min(...['zoomInBtn']
        .map(id => mapAreaRect(document.getElementById(id))).filter(Boolean).map(r => r.top), layout.H);
      const mapTop = g.top - area.top, mapBottom = g.bottom - area.top;
      const above = mapTop - head - 24, below = foot - mapBottom - 24;
      box = above >= below
        ? { top: head + 12, height: above, width: layout.W - 2 * TITLE.pad }
        : { top: mapBottom + 12, height: below, width: layout.W - 2 * TITLE.pad };
      align = 'left';
      el.style.right = '';
      el.style.left = `${TITLE.pad}px`;
    }
    const max = layout.mode === 'side' ? Math.min(140, layout.H * 0.16) : 56;
    const fit = fitTitleName(name, family, box.width, box.height, max, TITLE_EXTRA[layout.mode]);
    if (!fit) return null;
    el.style.top = `${box.top}px`;
    el.style.width = `${box.width}px`;
    el.classList.toggle('align-right', align === 'right');
    el.classList.toggle('compact', layout.mode === 'band');
    nameEl.style.fontSize = `${fit.size.toFixed(1)}px`;
    return fit;
  }

  // The name's lines as plain text (kerned), keeping the scan line element
  function setTitleLines(nameEl, lines) {
    nameEl.querySelectorAll('.mst-line').forEach(l => l.remove());
    lines.forEach(line => {
      const l = document.createElement('span');
      l.className = 'mst-line';
      l.textContent = line;
      nameEl.appendChild(l);
    });
  }

  function showStateTitle(abbr, info, lg) {
    const el = document.getElementById('mapStateTitle');
    if (!el || abbr === 'DL') return;
    const run = ++titleRun;
    const name = LABEL_NAMES[abbr] || ABBR_TO_NAME[abbr] || abbr;
    const kind = UNION_TERRITORIES.has(abbr) ? 'Union territory' : 'State';
    const over = `${kind} · ${info.districts} district${info.districts !== 1 ? 's' : ''}`;
    const stats = n => `${n} active vacanc${n !== 1 ? 'ies' : 'y'}`;
    el.setAttribute('aria-label', `${name}: ${stats(info.vacancies)}`);
    el.innerHTML = `
      <span class="mst-over" aria-hidden="true"></span>
      <span class="mst-name" aria-hidden="true"><span class="mst-scan"></span></span>
      <span class="mst-rule" aria-hidden="true"></span>
      <span class="mst-stats" aria-hidden="true"></span>
      <span class="mst-corner tl"></span><span class="mst-corner tr"></span>
      <span class="mst-corner bl"></span><span class="mst-corner br"></span>`;
    el.className = 'map-state-title';
    el.dataset.name = name;
    el.style.visibility = 'hidden';
    el.hidden = false;

    // Placed straight away but kept hidden; reveal() starts the decode
    let fit = null, wanted = false, played = false;
    const play = () => {
      if (played || !fit || run !== titleRun) return;
      played = true;
      el.style.visibility = '';
      const overEl = el.querySelector('.mst-over');
      const nameEl = el.querySelector('.mst-name');
      const ruleEl = el.querySelector('.mst-rule');
      const statsEl = el.querySelector('.mst-stats');
      const D = info.duration;

      const finish = () => {
        overEl.textContent = over;
        statsEl.textContent = stats(info.vacancies);
        setTitleLines(nameEl, fit.lines);
        el.classList.add('done');
      };
      if (!D) { finish(); return; }

      // Letters in fixed-width boxes while they cycle
      const chars = [];
      fit.lines.forEach(line => {
        const l = document.createElement('span');
        l.className = 'mst-line';
        [...line].forEach(ch => {
          const c = document.createElement('span');
          c.className = 'mst-ch';
          c.style.width = `${(fit.charW(ch) * fit.size).toFixed(2)}px`;
          c.dataset.ch = ch;
          if (ch !== ' ') chars.push(c);
          else c.textContent = ' ';
          l.appendChild(c);
        });
        nameEl.appendChild(l);
      });

      const n = chars.length;
      const starts = chars.map((_, i) => 0.08 * D + (n > 1 ? i / (n - 1) : 0) * 0.58 * D);
      const lockAfter = Math.max(180, 0.14 * D);
      const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
      el.querySelectorAll('.mst-corner').forEach(c => {
        c.animate([{ opacity: 0, transform: 'scale(1.8)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 320, easing: ease, fill: 'both' });
        c.animate([{ opacity: 1 }, { opacity: 0 }], { delay: D - 300, duration: 300, fill: 'forwards' });
      });
      el.querySelector('.mst-scan').animate([
        { transform: 'translateX(0)', opacity: 0 }, { opacity: 1, offset: 0.08 },
        { opacity: 1, offset: 0.9 }, { transform: `translateX(${nameEl.offsetWidth}px)`, opacity: 0 },
      ], { delay: 0.08 * D, duration: 0.7 * D, easing: 'cubic-bezier(0.45, 0.05, 0.55, 0.95)', fill: 'both' });
      ruleEl.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { delay: 0.72 * D, duration: 0.2 * D, easing: ease, fill: 'both' });

      const t0 = performance.now();
      let tick = 0;
      const frame = (now) => {
        if (run !== titleRun) return;
        const t = now - t0;
        tick++;
        const typed = Math.min(over.length, Math.floor((t / (0.25 * D)) * over.length));
        overEl.textContent = over.slice(0, typed) + (typed < over.length ? '_' : '');
        chars.forEach((c, i) => {
          if (t < starts[i] || c.classList.contains('done')) return;
          if (t >= starts[i] + lockAfter) {
            c.textContent = c.dataset.ch;
            c.classList.remove('scr');
            c.classList.add('done');
          } else {
            c.classList.add('scr');
            if (tick % 2 === 0 || !c.textContent) c.textContent = SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)];
          }
        });
        const p = Math.max(0, Math.min(1, (t - 0.6 * D) / (0.4 * D)));
        statsEl.textContent = t < 0.6 * D ? '' : stats(Math.round((1 - Math.pow(1 - p, 3)) * info.vacancies));
        if (t < D) requestAnimationFrame(frame);
        else finish();
      };
      requestAnimationFrame(frame);
    };

    // After this frame: the Back button and state list button are showing
    // by then, so the layout measures the header as it will stay
    requestAnimationFrame(() => {
      if (run !== titleRun || lg !== ledGeneration) return;
      fit = placeStateTitle(el, name);
      if (!fit) { hideStateTitle(); return; }
      if (wanted) play();
    });
    return { reveal() { wanted = true; play(); } };
  }

  // Keeps the open state framed beside its title when the window resizes
  function onStateResize() {
    if (!stateContent || (viewMode !== 'state' && viewMode !== 'district')) return;
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    homeView = stateViewBox(stateContent, stateLayout());
    setView(svg, homeView);
    const el = document.getElementById('mapStateTitle');
    if (el && !el.hidden && el.classList.contains('done')) {
      const fit = placeStateTitle(el, el.dataset.name);
      if (fit) setTitleLines(el.querySelector('.mst-name'), fit.lines);
      else el.style.visibility = 'hidden';
    }
  }

  function renderState(abbr, name) {
    clearMap();

    // Delhi uses an image-map drill-down (coloured district photos)
    if (abbr === 'DL') {
      const data = getData();
      renderDelhiImageMap(abbr, name, data);
      return;
    }

    const mapSvg = ensureMapSvg();
    const g = mapSvg?.querySelector('#map-group');
    const labelsG = mapSvg?.querySelector('#map-labels');
    if (!g) return;

    const feats = districtFeaturesFor(abbr);
    if (!feats.length) { updateStateListButton(abbr, name, []); return; }

    // Re-project the state's districts onto the 1000×800 canvas; the view is
    // fitted to them once drawn (below), replacing the national zoom.
    computeProjection(feats);
    mapSvg.setAttribute('viewBox', '0 0 1000 800');

    const groups = groupDistricts(feats);
    updateStateListButton(abbr, name, groups.map(g => g.name));

    groups.forEach(({ name: geoName, features: parts }, idx) => {
      const count = getDistrictCount(abbr, geoName);
      const d = parts.map(f => projectCoords(f.geometry)).filter(Boolean).join(' ');
      if (!d) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `${d} Z`);
      path.setAttribute('class', `ad-district${count === 0 ? ' empty-state' : ''}`);
      path.setAttribute('data-abbr', abbr);
      path.setAttribute('data-district', geoName);
      path.setAttribute('tabindex', '0');
      path.setAttribute('role', 'button');
      path.setAttribute('aria-label', `${geoName}: ${count} vacancies`);
      path.style.setProperty('--ad-delay', `${Math.min(idx * 20, 500)}ms`);
      // State colour where there are vacancies, neutral surface elsewhere
      path.style.fill = count > 0 ? stateFill(abbr) : 'var(--map-neutral)';

      path.addEventListener('click', () => navigateToDistrict(abbr, geoName));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToDistrict(abbr, geoName); }
      });
      path.addEventListener('mouseenter', (e) => {
        path.classList.add('ad-gpu');
        showTooltip(e, abbr, geoName, count);
      });
      path.addEventListener('mousemove', moveTooltip);
      path.addEventListener('mouseleave', () => { path.classList.remove('ad-gpu'); hideTooltip(); });
      wireOutline(path);
      g.appendChild(path);

      // Name and count at the district's roomiest point, well inside it even
      // for odd shapes; the average of its border points drifts towards
      // detailed stretches (it put neighbours' names on top of each other)
      const spot = roomiestPoints(labelShape(`${d} Z`), 1)[0];
      const [cx, cy] = spot || project(...centroid({
        type: 'MultiPolygon',
        coordinates: parts.flatMap(f => f.geometry.type === 'MultiPolygon'
          ? f.geometry.coordinates : [f.geometry.coordinates]),
      }));

      if (count > 0) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('x', cx);
        badge.setAttribute('y', cy - 6);
        badge.setAttribute('class', 'ad-count-badge');
        badge.setAttribute('data-for', geoName);
        badge.textContent = count;
        badge.style.setProperty('--ad-delay', `${500 + idx * 15}ms`);
        labelsG.appendChild(badge);
      }

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', cx);
      label.setAttribute('y', cy + 4);
      label.setAttribute('class', 'ad-district-label');
      label.setAttribute('data-for', geoName);
      label.textContent = geoName;
      label.style.setProperty('--ad-delay', `${550 + idx * 15}ms`);
      labelsG.appendChild(label);
    });

    // Framed on the districts alone, the way cinematicZoom() framed the state
    stateContent = contentView([g]);
    homeView = stateViewBox(stateContent, stateLayout());
    setView(mapSvg, homeView);
    buildRelief(Array.from(g.querySelectorAll('.ad-district')), g, p => p.style.fill, () => null);

    // District names and counts fade in (the CSS starts them at opacity 0)
    requestAnimationFrame(() => labelsG.querySelectorAll('.ad-district-label')
      .forEach(l => l.classList.add('visible')));

    // The same entrance as all of India: the state in faded tricolour with
    // the chakra, then electricity lights each district's border
    const paths = Array.from(g.querySelectorAll('.ad-district'));
    const lg = ledGeneration;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    mapSvg.classList.toggle('ad-intro', !reduced);
    // The state's name beside it: placed now, decoded in only once the
    // state has fully loaded, so the two animations don't run together
    const title = showStateTitle(abbr, {
      districts: groups.length,
      vacancies: stateListings(abbr).length,
      duration: reduced ? 0 : TITLE_REVEAL,
    }, lg);
    requestAnimationFrame(() => {
      if (lg !== ledGeneration) return;
      if (reduced) { buildLeds(paths, lg, null); title?.reveal(); }
      else playTricolourIntro(paths, lg, STATE_INTRO, () => title?.reveal(),
        { outlineCurrent: true, seed: p => p.dataset.district === CAPITAL_DISTRICT[abbr] });
    });
  }

  function getDistrictCount(abbr, districtName) {
    if (!window.IndiaMapData) return 0;
    const listings = IndiaMapData.getListingsForDistrict(abbr, districtName);
    const seen = new Set();
    listings.forEach(l => seen.add(l.id));
    return seen.size;
  }

  // ----- Tooltip -----
  // Name and active-vacancy count of the state or district under the pointer.
  function showTooltip(event, abbr, name, count) {
    const t = document.getElementById('mapTooltip');
    if (!t) return;
    const n = document.getElementById('mapTooltipName');
    const c = document.getElementById('mapTooltipCount');
    const m = document.getElementById('mapTooltipMeta');
    if (n) n.textContent = name;
    if (c) c.textContent = `${count} vacanc${count !== 1 ? 'ies' : 'y'}`;
    if (m) m.textContent = '';
    moveTooltip(event);
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('visible'));
  }
  function moveTooltip(event) {
    const t = document.getElementById('mapTooltip');
    if (!t) return;
    t.style.left = (event.clientX + 16) + 'px';
    t.style.top = (event.clientY - 10) + 'px';
  }
  function hideTooltip() {
    const t = document.getElementById('mapTooltip');
    if (t) { t.classList.remove('visible'); t.hidden = true; }
  }

  // ----- Counter -----
  // "Active Vacancies" counts every active vacancy, as the dashboard does:
  // nationwide and multi-state ones and ones with no mappable state too.
  // The state labels only count vacancies placed in that state, so they
  // add up to less.
  function updateCounter(data) {
    const v = document.getElementById('mapCounterValue');
    if (v) v.textContent = (data?.nationalCount || 0).toLocaleString();
  }

  function getData() {
    const sc = window.IndiaMapData?.getStateCounts?.() || {};
    return {
      nationalCount: window.IndiaMapData?.getActiveTotal?.() || 0,
      stateCounts: sc,
    };
  }

  function zoomIn() {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const newW = vb.width / 1.3;
    const newH = vb.height / 1.3;
    const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
    vb.x = cx - newW / 2; vb.y = cy - newH / 2;
    vb.width = newW; vb.height = newH;
  }
  function zoomOut() {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const newW = vb.width * 1.3, newH = vb.height * 1.3;
    const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
    vb.x = cx - newW / 2; vb.y = cy - newH / 2;
    vb.width = newW; vb.height = newH;
  }
  function zoomReset() {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    setView(svg, homeView);
  }

  // ===== Navigation layer (the only code that mutates history) =====
  // Every history entry the map writes is makeRoute(...):
  //   hasMapParent=true  → the entry directly below is this route's in-app
  //                        parent (National below State, State below District),
  //                        so leaving it is history.back().
  //   hasMapParent=false → direct entry (initial load or deep link); there is
  //                        no in-app parent below, so leaving it replaces the
  //                        current entry instead of backing out of the page.
  //
  //   initial national load          replaceState(national, no parent)
  //   direct ?state / ?district link replaceState(route, no parent)
  //   user National → State          pushState(state, parent)
  //   user State → District          pushState(district, parent)
  //   user closes district           parent: history.back() once
  //                                  no parent: replaceState(state, no parent)
  //   in-app Back to India           parent: history.back() once
  //                                  no parent: replaceState(national)
  //   popstate (browser Back/Fwd)    render only, never push/replace
  //
  // Rendering functions (drillToState, renderState, renderDelhiImageMap,
  // renderDelhiDistrictView, openDistrictModal, goToNational) never touch
  // history.

  function makeRoute(view, state, district, hasMapParent) {
    return { mapRoute: true, view, state: state || null, district: district || null, hasMapParent };
  }

  function stateUrl(abbr) { return `?state=${abbr}`; }
  function districtUrl(abbr, district) {
    return `?state=${abbr}&district=${encodeURIComponent(district)}`;
  }

  // Set while a route change (popstate, Back to India) closes the modal, so
  // the dialog's 'close' event does not treat it as a user close and write
  // history a second time. Only set when the dialog is actually open —
  // close() on a closed dialog fires no event and would leave it stuck.
  let routeClosingModal = false;
  function closeModalForRoute() {
    const modal = document.getElementById('modal');
    if (modal && modal.open) {
      routeClosingModal = true;
      modal.close();
    }
  }

  // UI half of leaving a district: back to the state view. Idempotent.
  function leaveDistrictView() {
    if (viewMode !== 'district') return;
    const closedDistrict = selectedDistrict;
    viewMode = 'state';
    selectedDistrict = null;
    // Delhi swapped its image map for a district photo — put the map back
    // and return focus to the hotspot that opened the district (the modal's
    // own trigger was inside the photo view, which no longer exists).
    if (selectedAbbr === 'DL') {
      renderDelhiImageMap('DL', ABBR_TO_NAME.DL, getData());
      const hotspot = Array.from(document.querySelectorAll('.ad-delhi-hotspot'))
        .find(b => b.dataset.district === closedDistrict);
      if (hotspot) hotspot.focus();
    }
  }

  // User closed the district (Escape, close button, backdrop, Delhi overview).
  function closeDistrict() {
    const modal = document.getElementById('modal');
    if (modal && modal.open) {
      modal.close(); // 'close' handler re-enters via onModalClosedByUser()
      return;
    }
    onModalClosedByUser();
  }

  function onModalClosedByUser() {
    if (viewMode !== 'district' || !selectedAbbr) return;
    const abbr = selectedAbbr;
    const entry = history.state || {};
    leaveDistrictView();
    if (entry.mapRoute && entry.view === 'district' && entry.hasMapParent) {
      // The State entry is directly below: step back onto it. popstate then
      // finds the UI already on the state and does nothing further.
      history.back();
    } else {
      history.replaceState(makeRoute('state', abbr, null, false), '', stateUrl(abbr));
    }
  }

  // User click: National → State. Exactly one push, after the state renders.
  async function navigateToState(stateAbbr) {
    if (isOnState(stateAbbr)) return;
    const name = ABBR_TO_NAME[stateAbbr] || stateAbbr;
    const ok = await drillToState(stateAbbr, name);
    if (!ok) return;
    history.pushState(makeRoute('state', stateAbbr, null, true), '', stateUrl(stateAbbr));
  }

  // User click: State → District. Exactly one push.
  function navigateToDistrict(stateAbbr, districtName) {
    if (viewMode !== 'state' || selectedAbbr !== stateAbbr) return;
    openDistrictModal(stateAbbr, districtName);
    history.pushState(
      makeRoute('district', stateAbbr, districtName, true),
      '', districtUrl(stateAbbr, districtName)
    );
  }

  // In-app "Back to India".
  async function goBack() {
    if (viewMode === 'district') { closeDistrict(); return; }
    if (viewMode !== 'state') return;
    const entry = history.state || {};
    if (entry.mapRoute && entry.view === 'state' && entry.hasMapParent) {
      history.back(); // popstate lands on National and renders it
      return;
    }
    // Direct state entry: no in-app parent below, so stay on the page
    history.replaceState(makeRoute('national', null, null, false), '', location.pathname);
    await goToNational();
  }

  // Render a route (deep link or popstate). Never pushes or replaces.
  async function renderRouteFromURL(stateAbbr, districtName) {
    if (!stateAbbr) {
      await goToNational();
      return;
    }
    if (!isOnState(stateAbbr)) {
      const ok = await drillToState(stateAbbr, ABBR_TO_NAME[stateAbbr] || stateAbbr);
      if (!ok) return;
    }
    if (districtName) {
      if (viewMode !== 'district' || selectedDistrict !== districtName) {
        openDistrictModal(stateAbbr, districtName);
      }
    } else {
      closeModalForRoute();
      leaveDistrictView();
    }
  }

  // Opens the listings modal for a district. Rendering only.
  function openDistrictModal(stateAbbr, districtName) {
    selectedDistrict = districtName;
    viewMode = 'district';

    if (stateAbbr === 'DL') renderDelhiDistrictView(districtName);

    const listings = window.IndiaMapData
      ? IndiaMapData.getListingsForDistrict(stateAbbr, districtName) : [];
    const seen = new Set();
    const unique = listings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    // Focus returns here when the modal closes (C24)
    let districtTrigger = null;
    if (stateAbbr === 'DL') {
      districtTrigger = document.getElementById('delhiBackBtn');
    } else {
      const paths = document.querySelectorAll('#map-svg .ad-district');
      for (const p of paths) {
        if (p.dataset.district === districtName && p.dataset.abbr === stateAbbr) {
          districtTrigger = p; break;
        }
      }
    }

    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modal = document.getElementById('modal');
    if (modalTitle) modalTitle.textContent =
      `${unique.length} Vacanc${unique.length !== 1 ? 'ies' : 'y'} in ${districtName}`;
    if (modalBody) modalBody.innerHTML = listingCardsHtml(unique);
    if (modal) {
      modal._districtTrigger = districtTrigger;
      if (!modal.open) modal.showModal?.();
    }
  }

  // Why a card's place is shown when the post names none (Location_Assumed)
  const LOCATION_BASIS_NOTE = {
    notification: 'The post gives no location; shown where the other posts of the same notification are',
    organisation: "The post gives no location; shown at the organisation's location",
    default: 'The notification gives no location; Central Government posts are shown at New Delhi',
  };

  // Each card opens its vacancy on the home page (/?v=<Vacancy_ID>). The title
  // link is stretched over the whole card; the Notification link sits above it.
  function listingCardsHtml(listings) {
    return listings.map((l, i) => `
        <div class="ad-listing-card visible${l.id ? ' is-linked' : ''}" style="animation-delay:${i * 60}ms">
          <div class="ad-listing-card-header">
            ${l.id
              ? `<a class="ad-listing-title ad-listing-open" href="/?v=${encodeURIComponent(l.id)}">${esc(l.title)}</a>`
              : `<div class="ad-listing-title">${esc(l.title)}</div>`}
            ${l.level ? `<span class="ad-listing-badge">${esc(l.level)}</span>` : ''}
          </div>
          <div class="ad-listing-meta">
            ${l.city ? `<span${l.locationAssumed ? ` title="${esc(LOCATION_BASIS_NOTE[l.locationBasis] || LOCATION_BASIS_NOTE.default)}"` : ''}>${esc(l.city)}${l.locationAssumed ? ' (location not stated)' : ''}</span>` : ''}
            ${l.ministry ? `<span>${esc(l.ministry)}</span>` : ''}
            ${l.organisation ? `<span>${esc(l.organisation)}</span>` : ''}
            ${l.functionalArea ? `<span>${esc(l.functionalArea)}</span>` : ''}
          </div>
          <div class="ad-listing-card-footer">
            ${l.closingDate ? `<span class="ad-listing-close-date">Closes ${esc(l.closingDate)}</span>` : ''}
            ${l.notificationLink ? `<a href="${esc(l.notificationLink)}" target="_blank" rel="noopener" class="ad-listing-link">Notification</a>` : ''}
          </div>
        </div>`).join('') || '<p style="color:var(--text-muted); text-align:center; padding:20px;">No vacancies found.</p>';
  }

  // ----- "View all vacancies in <State>" -----
  // Every active vacancy in the state, including ones whose city could not be
  // placed on a district (e.g. "Goa", or Chandigarh listed under Punjab), so
  // a state view never hides vacancies the national map counted.
  function stateListings(abbr) {
    return window.IndiaMapData ? IndiaMapData.getFiltered(abbr, {}) : [];
  }

  function updateStateListButton(abbr, name, districtNames) {
    const btn = document.getElementById('stateListBtn');
    if (!btn) return;
    const all = abbr ? stateListings(abbr) : [];
    if (!all.length) { btn.hidden = true; return; }
    const placed = new Set();
    (districtNames || []).forEach(d =>
      IndiaMapData.getListingsForDistrict(abbr, d).forEach(l => placed.add(l.id)));
    const unplaced = all.filter(l => !placed.has(l.id)).length;
    btn.textContent = all.length === 1
      ? `View the 1 vacancy in ${name}` : `View all ${all.length} vacancies in ${name}`;
    if (unplaced) {
      const note = document.createElement('span');
      note.className = 'map-state-list-note';
      note.textContent = `${unplaced} not linked to a district`;
      btn.appendChild(note);
    }
    btn.dataset.abbr = abbr;
    btn.hidden = false;
  }

  // Opens the listings modal for the whole state. Not a route: closing it
  // leaves the state view and history exactly as they were.
  function openStateListModal() {
    const btn = document.getElementById('stateListBtn');
    const abbr = btn?.dataset.abbr;
    if (!abbr || viewMode !== 'state' || selectedAbbr !== abbr) return;
    const name = ABBR_TO_NAME[abbr] || abbr;
    const all = stateListings(abbr);
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modal = document.getElementById('modal');
    if (modalTitle) modalTitle.textContent =
      `${all.length} Vacanc${all.length !== 1 ? 'ies' : 'y'} in ${name}`;
    if (modalBody) modalBody.innerHTML = listingCardsHtml(all);
    if (modal) {
      modal._districtTrigger = btn;
      if (!modal.open) modal.showModal?.();
    }
  }

  // Browser Back/Forward: render the route the URL now names. Never writes
  // history.
  function onPopState() {
    const params = new URLSearchParams(location.search);
    const urlAbbr = (params.get('state') || '').toUpperCase();
    const urlDistrict = params.get('district') || '';
    const validAbbr = urlAbbr && ABBR_TO_NAME[urlAbbr] ? urlAbbr : null;

    if (!validAbbr) {
      if (viewMode !== 'national') goToNational();
      else closeModalForRoute();
      return;
    }
    renderRouteFromURL(validAbbr, urlDistrict || null);
  }

  async function goToNational() {
    const gen = ++renderGeneration;
    selectedDistrict = null;
    // Close district modal if open (can survive after a back-navigation)
    closeModalForRoute();
    const svg = ensureMapSvg();
    if (svg) {
      const vb = svg.viewBox.baseVal;
      await animateViewBox(svg, { x: vb.x, y: vb.y, w: vb.width, h: vb.height },
        nationalHome || { x: 0, y: 0, w: 1000, h: 800 }, 400);
    }
    if (gen !== renderGeneration) return;
    selectedAbbr = null;
    viewMode = 'national';
    const back = document.getElementById('btn-back');
    if (back) back.hidden = true;
    updateStateListButton(null);
    const data = getData();
    renderNational(data);
    // Return focus to the state that was drilled into
    if (lastFocusedState) {
      const st = document.querySelector(`#map-svg [data-abbr="${lastFocusedState}"].ad-state`);
      if (st) st.focus();
    }
  }

  // ----- Main init -----
  window.initIndiaMap = async function() {
    if (mapInitialised) return;
    mapInitialised = true;

    const wrap = document.getElementById('mapSvgWrap');
    if (!wrap) return;
    wrap.innerHTML = '';
    wrap.appendChild(buildSvg());

    // Load geometry (7-day sessionStorage cache)
    const stateGeoKey = 'india-states-geo';
    const stateGeoCacheMaxAge = 7 * 86400000; // 7 days
    // Tests set window.__MAP_TEST_MODE to bypass sessionStorage;
    // in production this is never set so normal cache applies.
    if (!window.__MAP_TEST_MODE && !window._indiaGeoData) {
      try {
        const cached = sessionStorage.getItem(stateGeoKey);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && parsed._ts && (Date.now() - parsed._ts) < stateGeoCacheMaxAge) {
            window._indiaGeoData = parsed.data;
          }
        }
      } catch (e) { /* sessionStorage unavailable */ }
    }
    if (!window._indiaGeoData) {
      try {
        const resp = await fetch('geo/india-states.geojson');
        if (resp.ok) {
          window._indiaGeoData = await resp.json();
          if (!window.__MAP_TEST_MODE) {
            try {
              sessionStorage.setItem(stateGeoKey, JSON.stringify({ _ts: Date.now(), data: window._indiaGeoData }));
            } catch (e) { /* quota exceeded */ }
          }
        }
      } catch (e) { console.error('[map] state geo load failed:', e); }
    }

    // Load data
    if (window.IndiaMapData && IndiaMapData.load) {
      try { await IndiaMapData.load(); } catch (e) { console.error('[map] data load failed:', e); }
    }

    const urlParams = new URLSearchParams(location.search);
    const deepState = urlParams.get('state');
    const deepDistrict = urlParams.get('district'); // already decoded
    const deepAbbr = deepState ? deepState.toUpperCase() : '';
    const isDeepLink = !!(deepAbbr && ABBR_TO_NAME[deepAbbr]);

    // The tricolour intro plays on a plain visit only: a deep link goes
    // straight to its state, and reduced motion gets the map at once
    introPending = !isDeepLink &&
      !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    // BLOCKER 1 + 9: render national map BEFORE deep-link so draw-in can complete
    // Deep-link must use replace=true so initial load produces exactly one history entry
    const initData = getData();
    renderNational(initData);

    // Wire popstate handler (C18)
    window.addEventListener('popstate', onPopState);

    // Deep-link handler: support both state and district.
    // Direct entry: hasMapParent=false — replace, never push, so the deep
    // link is exactly one history entry and in-app Back stays on the page.
    if (isDeepLink) {
      history.replaceState(
        makeRoute(deepDistrict ? 'district' : 'state', deepAbbr, deepDistrict || null, false),
        '', deepDistrict ? districtUrl(deepAbbr, deepDistrict) : stateUrl(deepAbbr)
      );
      // Drill once the national draw-in has finished
      document.addEventListener('map:drawInComplete',
        () => renderRouteFromURL(deepAbbr, deepDistrict || null), { once: true });
    } else {
      history.replaceState(makeRoute('national', null, null, false), '', location.pathname);
    }

    // Subscribe to Supabase Realtime for live vacancy inserts
    setupRealtime();

    // Wire controls
    const back = document.getElementById('btn-back');
    if (back) { back.hidden = true; back.addEventListener('click', goBack); }
    document.getElementById('stateListBtn')?.addEventListener('click', openStateListModal);
    const mapBack = document.getElementById('mapBackBtn');
    if (mapBack) mapBack.addEventListener('click', goBack);
    document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn);
    document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut);
    document.getElementById('zoomResetBtn')?.addEventListener('click', zoomReset);

    // Wire modal close handlers. The dialog 'close' event fires for every
    // close path (button, Escape, backdrop, or closeModalForRoute()).
    const modal = document.getElementById('modal');
    const modalClose = modal?.querySelector('.map-modal-close');
    if (modalClose) {
      modalClose.addEventListener('click', () => modal?.close());
    }
    if (modal) {
      modal.addEventListener('close', () => {
        // Restore focus to the district trigger that opened the modal (C24)
        const trigger = modal._districtTrigger;
        if (trigger && document.contains(trigger)) {
          try { trigger.focus(); } catch (e) { /* element gone */ }
        }
        modal._districtTrigger = null;
        if (routeClosingModal) {
          // The route already moved (popstate / Back to India): no history write
          routeClosingModal = false;
          return;
        }
        onModalClosedByUser();
      });
    }

    let stateResizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(stateResizeTimer);
      stateResizeTimer = setTimeout(onStateResize, 150);
    });
  };

  // ----- Wheel zoom (centered on cursor) -----
  function onWheelZoom(e) {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    e.preventDefault();
    const vb = svg.viewBox.baseVal;
    const factor = e.deltaY < 0 ? 0.9 : 1.1;
    const newW = Math.min(Math.max(vb.width * factor, 80), 2000);
    const newH = Math.min(Math.max(vb.height * factor, 64), 1600);
    // Map cursor position to SVG coordinate space so zoom centers on pointer
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
    const ratioX = (svgPt.x - vb.x) / vb.width;
    const ratioY = (svgPt.y - vb.y) / vb.height;
    vb.x = svgPt.x - newW * ratioX;
    vb.y = svgPt.y - newH * ratioY;
    vb.width = newW; vb.height = newH;
  }

  // ----- Pinch-zoom (two-finger) -----
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      gestureState = {
        dist: Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        ),
      };
      e.preventDefault();
    } else if (e.touches.length === 1 && !gestureState) {
      panState = { startX: e.touches[0].clientX, startY: e.touches[0].clientY };
    }
  }
  function onTouchMove(e) {
    if (e.touches.length === 2 && gestureState) {
      const newDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const svg = document.getElementById('map-svg');
      if (!svg) return;
      const vb = svg.viewBox.baseVal;
      const scale = gestureState.dist / newDist;
      const newW = Math.min(Math.max(vb.width * scale, 80), 2000);
      const newH = Math.min(Math.max(vb.height * scale, 64), 1600);
      const cx = vb.x + vb.width / 2, cy = vb.y + vb.height / 2;
      vb.x = cx - newW / 2; vb.y = cy - newH / 2;
      vb.width = newW; vb.height = newH;
      gestureState = { dist: newDist };
      e.preventDefault();
    } else if (e.touches.length === 1 && panState) {
      const svg = document.getElementById('map-svg');
      if (!svg) return;
      const dx = e.touches[0].clientX - panState.startX;
      const dy = e.touches[0].clientY - panState.startY;
      panState.startX = e.touches[0].clientX;
      panState.startY = e.touches[0].clientY;
      const vb = svg.viewBox.baseVal;
      vb.x -= dx * (vb.width / svg.clientWidth);
      vb.y -= dy * (vb.height / svg.clientHeight);
      e.preventDefault();
    }
  }
  function onTouchEnd() {
    gestureState = null;
    panState = null;
  }

  // ----- Pointer pan (drag on SVG background / not on a state) -----
  function onPointerDown(e) {
    // Only primary pointer, and not on a state path
    if (e.button !== 0) return;
    if (e.target.closest('.ad-state') || e.target.closest('.ad-district')) return;
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    svg.setPointerCapture(e.pointerId);
    panState = { startX: e.clientX, startY: e.clientY };
  }
  function onPointerMove(e) {
    if (!panState) return;
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    const dx = e.clientX - panState.startX;
    const dy = e.clientY - panState.startY;
    panState.startX = e.clientX;
    panState.startY = e.clientY;
    vb.x -= dx * (vb.width / svg.clientWidth);
    vb.y -= dy * (vb.height / svg.clientHeight);
  }
  function onPointerUp(e) {
    if (panState) {
      const svg = document.getElementById('map-svg');
      if (svg && svg.hasPointerCapture(e.pointerId)) {
        svg.releasePointerCapture(e.pointerId);
      }
      panState = null;
    }
  }

  // ===== Supabase Realtime: INSERT events trigger state ripples =====
  let realtimeSubscribed = false;

  function setupRealtime() {
    if (realtimeSubscribed) return;
    if (!window.ensureSupabaseAvailable) {
      console.info('[map] realtime unavailable: ensureSupabaseAvailable not on window');
      return;
    }

    // Only proceed when Supabase is reachable (skipped silently on NIC)
    try {
      var probePromise = window.ensureSupabaseAvailable().then(function (available) {
        if (!available) {
          console.info('[map] realtime unavailable: Supabase not reachable');
          return;
        }
        startRealtime();
      });
    } catch (e) {
      console.info('[map] realtime unavailable:', e.message);
    }
  }

  function startRealtime() {
    if (realtimeSubscribed) return;
    if (!window.WebSocket) return;

    var SB_URL = (window.SUPABASE_URL || "").replace(/\/+$/, "");
    var SB_KEY = window.SUPABASE_ANON_KEY || "";
    if (!SB_URL) return;

    var SUPABASE_HOST_RE = /(\.supabase\.co$|^api\.alldeputations\.com$)/i;
    if (!SUPABASE_HOST_RE.test(SB_URL)) return;

    var wsUrl = "wss://" + SB_URL.replace(/^https?:\/\//, "") +
                "/realtime/v1/websocket?apikey=" + encodeURIComponent(SB_KEY) +
                "&vsn=1.0.0";

    var ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      console.info('[map] realtime unavailable:', e.message);
      return;
    }

    var refCounter = 1;
    function send(topic, event, payload) {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ topic: topic, event: event, payload: payload || {}, ref: String(refCounter++) }));
    }

    ws.addEventListener("open", function () {
      send("vacancies", "phx_join", {
        config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [{ event: "INSERT", schema: "public", table: "vacancies" }] },
        postgres_changes: { event: "INSERT", schema: "public", table: "vacancies" }
      });
    });

    ws.addEventListener("message", function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && m.event === "postgres_changes" && m.payload && m.payload.eventType === "INSERT") {
        handleNewVacancy(m.payload.new || {});
      }
    });

    ws.addEventListener("error", function () {
      // Best-effort: polling fallback (realtime-toast.js) covers NIC networks
    });

    ws.addEventListener("close", function () {
      // Don't retry — page lifecycle is short, polling covers the gap
    });

    realtimeSubscribed = true;
    console.info('[map] realtime subscribed');
  }

  function handleNewVacancy(row) {
    if (!window.IndiaMapData || !IndiaMapData.recordNewVacancy) return;
    // recordNewVacancy handles dedup, normalisation, and count updates.
    var ingested = IndiaMapData.recordNewVacancy(row);
    if (!ingested) return;

    // Re-normalise to get the final abbr (recordNewVacancy already did this internally)
    var norm = IndiaMapData.normaliseVacancy(row);
    var abbr = norm && norm.state_abbr;
    if (!abbr) return;

    var newCount = IndiaMapData.getStateCount(abbr);

    var path = document.querySelector('#map-svg [data-abbr="' + abbr + '"].ad-state');
    if (path) {
      path.classList.remove('empty-state');
      spawnRipple(path);
    }

    var countEl = document.querySelector('#map-labels text.ad-state-count[data-for="' + abbr + '"]');
    if (countEl) {
      countEl.textContent = newCount;
      countEl.classList.remove('empty');
      countEl.classList.add('pop');
      countEl.style.display = '';
    }

    var totalEl = document.getElementById('mapCounterValue');
    if (totalEl) {
      totalEl.textContent = (IndiaMapData.getActiveTotal ? IndiaMapData.getActiveTotal() : 0).toLocaleString();
    }
  }

  function updateCounterFromStateCounts(stateCounts) {
    var total = 0;
    if (stateCounts) {
      Object.values(stateCounts).forEach(function (c) { total += c; });
    }
    var el = document.getElementById('mapCounterValue');
    if (el) el.textContent = total.toLocaleString();
  }

  // ===== End of realtime additions =====

  // ===== GPU acceleration class =====
  // .ad-gpu is toggled per-element on hover (in renderState)
  // to avoid 36+ elements always carrying will-change.

  // ===== Auto-init on standalone page load =====
  const doInit = () => {
    const mv = document.getElementById('map-view');
    if (mv) mv.classList.add('visible');
    window.initIndiaMap();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', doInit);
  } else {
    doInit();
  }

})();
