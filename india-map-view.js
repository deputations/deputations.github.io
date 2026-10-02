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
  let renderGeneration = 0;  // navigation/render lifecycle (J)
  let drawGeneration = 0;    // decorative draw-in lifecycle (J)
  let lastFocusedState = null;
  let announceTimer = null;
  let activeMapFilter = 'all'; // C21: explicit filter state

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

  const ABBR_TO_CODE = { 'JK':'01','HP':'02','PB':'03','CH':'04','UT':'05','HR':'06','DL':'07','RJ':'08','UP':'09','BR':'10','SK':'11','AR':'12','NL':'13','MN':'14','MZ':'15','TR':'16','ML':'17','AS':'18','WB':'19','JH':'20','OD':'21','CG':'22','MP':'23','GJ':'24','DD':'25','DN':'26','MH':'27','AP':'28','KA':'29','GA':'30','LD':'31','KL':'32','TN':'33','PY':'34','AN':'35','TS':'36','LA':'38' };

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
  function computeProjection(features) {
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
    const scale = Math.min(mapW / lonRange, mapH / latRange) * 0.92;
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
    const cacheKey = 'india-districts-geo';
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

    districtsPromise = fetch('geo/india-districts-all.geojson')
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

    // State hover glow filter
    const filter = document.createElementNS(ns, 'filter');
    filter.setAttribute('id', 'state-glow');
    filter.innerHTML = '<feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
    defs.appendChild(filter);

    // Liquid fill gradient (south→north, monsoon metaphor)
    const lg = document.createElementNS(ns, 'linearGradient');
    lg.setAttribute('id', 'liquid-gradient');
    lg.setAttribute('x1', '0'); lg.setAttribute('y1', '1');
    lg.setAttribute('x2', '0'); lg.setAttribute('y2', '0');
    lg.innerHTML = `
      <stop offset="0%" stop-color="#f5a721" stop-opacity="0.85"/>
      <stop offset="60%" stop-color="#ffb840" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#ffcb6b" stop-opacity="0.3"/>`;
    defs.appendChild(lg);

    svg.appendChild(defs);

    const g = document.createElementNS(ns, 'g');
    g.id = 'map-group';
    svg.appendChild(g);

    const labels = document.createElementNS(ns, 'g');
    labels.id = 'map-labels';
    svg.appendChild(labels);

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

  function clearMap() {
    const old = document.getElementById('map-svg');
    if (old) {
      const g = old.querySelector('#map-group');
      const lg = old.querySelector('#map-labels');
      if (g) g.innerHTML = '';
      if (lg) lg.innerHTML = '';
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

    computeProjection(features);

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

      // Liquid fill: states with vacancies get the gold gradient
      if (count > 0) {
        path.classList.add('liquid-fill');
        path.style.fill = 'url(#liquid-gradient)';
      }

      // Hover spotlight (dims neighbours)
      path.addEventListener('mouseenter', (e) => {
        showTooltip(e, abbr, name, count);
        path.classList.add('ad-gpu');
        announce(`${name}: ${count} vacanc${count !== 1 ? 'ies' : ''}`);
        document.querySelectorAll('#map-svg .ad-state').forEach(s => {
          if (s !== path) s.classList.add('neighbor-dim');
        });
      });
      path.addEventListener('mousemove', moveTooltip);
      path.addEventListener('mouseleave', () => {
        hideTooltip();
        path.classList.remove('ad-gpu');
        document.querySelectorAll('#map-svg .ad-state').forEach(s => s.classList.remove('neighbor-dim'));
      });
      path.addEventListener('click', () => navigateToState(abbr));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToState(abbr); }
      });

      g.appendChild(path);   // <-- BUG FIX: actually add the path to the SVG

      // Label
      const [clon, clat] = centroid(feat.geometry);
      const [cx, cy] = project(clon, clat);
      if (!isFinite(cx) || !isFinite(cy) || cx < 0 || cx > 1000 || cy < 0 || cy > 800) return;

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', cx);
      label.setAttribute('y', cy - 5);
      label.setAttribute('class', 'ad-state-label');
      label.style.setProperty('--ad-delay', `${600 + idx * 20}ms`);
      label.textContent = abbr;
      labelsG.appendChild(label);

      if (count > 0) {
        const num = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        num.setAttribute('x', cx);
        num.setAttribute('y', cy + 9);
        num.setAttribute('class', 'ad-state-count');
        num.setAttribute('data-for', abbr);
        num.style.setProperty('--ad-delay', `${900 + idx * 20}ms`);
        num.textContent = count;
        labelsG.appendChild(num);
      } else {
        // Always render a count text (possibly empty) so filter can address it
        const num = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        num.setAttribute('x', cx);
        num.setAttribute('y', cy + 9);
        num.setAttribute('class', 'ad-state-count empty');
        num.setAttribute('data-for', abbr);
        num.style.setProperty('--ad-delay', `${900 + idx * 20}ms`);
        num.textContent = '';
        labelsG.appendChild(num);
      }
    });

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

      paths.forEach((p, i) => {
        playDrawIn(p, i * 30);
        const totalDuration = i * 30 + 2000;
        setTimeout(() => {
          if (gen === drawGeneration) p.classList.add('drawn');
        }, totalDuration);
        if (useReducedMotion) {
          onPathComplete(); // no animation, count immediately
        } else {
          p.addEventListener('animationend', onPathComplete, { once: true });
          // Safety fallback: if animationend never fires (interrupted/removed), count after max duration
          setTimeout(() => {
            if (completed < total && gen === drawGeneration) onPathComplete();
          }, 3500);
        }
      });
      // Count labels pop in after draw-in finishes (2s + max stagger 600ms)
      document.querySelectorAll('#map-svg .ad-state-count').forEach((el, i) => {
        el.style.animationDelay = `${1800 + i * 25}ms`;
        el.classList.add('pop');
      });
    });

    updateCounter(data);
    spawnRippleForHighCounts(data);
  }

  // Concentric ring ripple for states with > 5 vacancies
  function spawnRippleForHighCounts(data) {
    if (!data?.stateCounts) return;
    setTimeout(() => {
      Object.entries(data.stateCounts).forEach(([abbr, count]) => {
        if (count >= 5) {
          const path = document.querySelector(`#map-svg [data-abbr="${abbr}"]`);
          if (path) spawnRipple(path);
        }
      });
    }, 1800); // after draw-in completes
  }

  function spawnRipple(targetPath) {
    const ns = 'http://www.w3.org/2000/svg';
    const bbox = targetPath.getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const parent = targetPath.parentNode;
    [0, 200, 400].forEach((delay, i) => {
      const ring = document.createElementNS(ns, 'circle');
      ring.setAttribute('cx', cx);
      ring.setAttribute('cy', cy);
      ring.setAttribute('r', '4');
      ring.setAttribute('class', 'ad-ripple');
      ring.style.animationDelay = `${delay}ms`;
      parent.appendChild(ring);
      setTimeout(() => ring.remove(), 2500 + delay);
    });
  }

  // Vortex burst: spawns a spiral of gold particles from the clicked state's
  // centroid while the cinematic zoom plays. Particles fade out over 1.5s.
  function spawnVortex(statePath) {
    const wrap = document.getElementById('mapSvgWrap');
    const vortexCanvas = document.createElement('canvas');
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    vortexCanvas.width = rect.width * dpr;
    vortexCanvas.height = rect.height * dpr;
    vortexCanvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:30';
    wrap.appendChild(vortexCanvas);
    const ctx = vortexCanvas.getContext('2d');

    const bbox = statePath.getBBox();
    const svg = document.getElementById('map-svg');
    const vb = svg.viewBox.baseVal;
    // Convert SVG centroid to screen coords
    const cxScreen = (bbox.x + bbox.width / 2 - vb.x) / vb.width * rect.width;
    const cyScreen = (bbox.y + bbox.height / 2 - vb.y) / vb.height * rect.height;

    const particles = Array.from({ length: 30 }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: 0.04 + Math.random() * 0.08,
      dist: Math.random() * 6,
      life: 0,
      maxLife: 60 + Math.random() * 40,
      r: 1.5 + Math.random() * 2,
    }));

    const t0 = performance.now();
    function frame() {
      const elapsed = performance.now() - t0;
      const alpha = Math.max(0, 1 - elapsed / 1500);
      if (alpha === 0) { vortexCanvas.remove(); return; }
      ctx.clearRect(0, 0, vortexCanvas.width, vortexCanvas.height);
      for (const p of particles) {
        p.angle += p.speed;
        p.dist += 0.6;
        p.life++;
        const fade = 1 - p.life / p.maxLife;
        const x = (cxScreen + Math.cos(p.angle) * p.dist * 8) * dpr;
        const y = (cyScreen + Math.sin(p.angle) * p.dist * 8) * dpr;
        ctx.beginPath(); ctx.arc(x, y, p.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,184,64,${alpha * fade * 0.9})`; ctx.fill();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    setTimeout(() => vortexCanvas.remove(), 2000);
  }

  // ----- Drill to state -----
  async function drillToState(abbr, name) {
    if (viewMode === 'state' && selectedAbbr === abbr) return;
    lastFocusedState = abbr;
    const gen = ++renderGeneration; // (J) render navigation generation

    // Delhi uses image-map, not district GeoJSON
    if (abbr === 'DL') {
      const sel = document.querySelector(`[data-abbr="${abbr}"].ad-state`);
      if (sel) {
        sel.style.transition = 'fill 0.2s, stroke 0.2s';
        sel.classList.add('selected');
      }
      if (sel) spawnVortex(sel);
      await cinematicZoom(abbr);
      if (gen !== renderGeneration) return;
      renderState(abbr, name);
      selectedAbbr = abbr;
      viewMode = 'state';
      const back = document.getElementById('btn-back');
      if (back) { back.hidden = false; back.focus(); }
      announce(`${name}: showing 11 districts. Click a district for details.`);
      return;
    }

    const dGeo = await ensureDistrictsLoaded();
    if (gen !== renderGeneration || !dGeo) return;

    // Mark selected
    const sel = document.querySelector(`[data-abbr="${abbr}"].ad-state`);
    if (sel) {
      sel.style.transition = 'fill 0.2s, stroke 0.2s';
      sel.classList.add('selected');
    }

    // Vortex burst: gold particles spiral out from clicked state during zoom
    if (sel) spawnVortex(sel);

    await cinematicZoom(abbr);
    if (gen !== renderGeneration) return;

    renderState(abbr, name);
    selectedAbbr = abbr;
    viewMode = 'state';
    const back = document.getElementById('btn-back');
    if (back) { back.hidden = false; back.focus(); }
    announce(`${name}: zoomed in. Explore districts for ${name}.`);
  }

  async function cinematicZoom(abbr) {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;

    const code = ABBR_TO_CODE[abbr] || abbr;
    const feats = (districtsGeo?.features || []).filter(f => f.properties.st_code === code);
    let cx = 500, cy = 400;
    if (feats.length) {
      const all = feats.flatMap(f => f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat().flat() : f.geometry.coordinates[0]);
      if (all.length) {
        const proj = all.map(c => project(c[0], c[1]));
        cx = proj.reduce((s, p) => s + p[0], 0) / proj.length;
        cy = proj.reduce((s, p) => s + p[1], 0) / proj.length;
      }
    }

    const targetW = vb.width / 2.4;
    const targetH = vb.height / 2.4;
    const start = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    const target = { x: cx - targetW / 2, y: cy - targetH / 2, w: targetW, h: targetH };
    await animateViewBox(svg, start, target, 600);
  }

  function animateViewBox(svg, start, target, duration) {
    return new Promise(resolve => {
      const vb = svg.viewBox.baseVal;
      const t0 = performance.now();
      let resolved = false;
      if (zoomAnimFrame) cancelAnimationFrame(zoomAnimFrame);
      function frame(now) {
        const t = Math.min((now - t0) / duration, 1);
        const e = 1 - Math.pow(1 - t, 3);
        vb.x = start.x + (target.x - start.x) * e;
        vb.y = start.y + (target.y - start.y) * e;
        vb.width = start.w + (target.w - start.w) * e;
        vb.height = start.h + (target.h - start.h) * e;
        if (t < 1) zoomAnimFrame = requestAnimationFrame(frame);
        else { zoomAnimFrame = null; resolved = true; resolve(); }
      }
      zoomAnimFrame = requestAnimationFrame(frame);
      // Safety: if RAF is throttled, resolve after expected duration + margin
      setTimeout(() => { if (!resolved) { zoomAnimFrame = null; resolve(); } }, duration + 200);
    });
  }

  // ===== Delhi image-map drill-down =====
  // Delhi districts: { name, left, top, width, height, image } — percentages
  // relative to the coloured overview image (1472×1344).
  const DELHI_DISTRICTS = [
    { name: 'North',        left: 42, top:  2, width: 24, height: 20, image: 'd7-north.png' },
    { name: 'North West',   left: 28, top: 16, width: 20, height: 22, image: 'd8-north_west.png' },
    { name: 'West',         left: 26, top: 38, width: 20, height: 20, image: 'd5-west.png' },
    { name: 'South West',   left: 16, top: 60, width: 26, height: 22, image: 'd3-south_west.png' },
    { name: 'North East',   left: 68, top:  4, width: 20, height: 28, image: 'd10-north_east.png' },
    { name: 'Shahdara',     left: 70, top: 24, width: 18, height: 20, image: 'd9-shahadara.png' },
    { name: 'East',         left: 76, top: 42, width: 16, height: 20, image: 'd6-east.png' },
    { name: 'Central',      left: 62, top: 28, width: 14, height: 14, image: 'd11-central.png' },
    { name: 'New Delhi',    left: 44, top: 52, width: 20, height: 24, image: 'd2-new_delhi.png' },
    { name: 'South East',   left: 72, top: 62, width: 18, height: 22, image: 'd04-south_east.jpg' },
    { name: 'South',        left: 40, top: 78, width: 22, height: 18, image: 'd1-south.png' }
  ];

  function renderDelhiImageMap(abbr, name, data, initialDistrict) {
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
        btn.addEventListener('click', () => {
          showDelhiDistrict(abbr, btn.dataset.district, btn.dataset.image, data);
        });
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

    if (initialDistrict) {
      const dist = DELHI_DISTRICTS.find(d => d.name === initialDistrict);
      if (dist) showDelhiDistrict(abbr, initialDistrict, dist.image, data, true);
    }

    announce(`${name}: showing ${DELHI_DISTRICTS.length} districts. Click a district for details.`);
  }

  function showDelhiDistrict(stateAbbr, districtName, imageFile, data, skipPush) {
    selectedDistrict = districtName;
    viewMode = 'district';

    const mapArea = document.getElementById('mapSvgWrap');
    if (mapArea) {
      mapArea.innerHTML = `
        <div class="ad-delhi-district-view">
          <img src="img/delhi/${imageFile}" alt="${districtName}" class="ad-delhi-district-img" draggable="false">
          <button class="ad-delhi-back-btn" id="delhiBackBtn" aria-label="Back to Delhi overview">← Delhi overview</button>
        </div>
      `;
      document.getElementById('delhiBackBtn').addEventListener('click', () => {
        renderDelhiImageMap(stateAbbr, 'Delhi', data);
      });
    }

    const listings = window.IndiaMapData
      ? IndiaMapData.getListingsForDistrict(stateAbbr, districtName) : [];
    const seen = new Set();
    const unique = listings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modal = document.getElementById('modal');
    if (modalTitle) modalTitle.textContent =
      `${unique.length} Vacanc${unique.length !== 1 ? 'ies' : 'y'} in ${districtName}`;
    if (modalBody) {
      modalBody.innerHTML = unique.map((l, i) => `
        <div class="ad-listing-card visible" style="animation-delay:${i * 60}ms">
          <div class="ad-listing-card-header">
            <div class="ad-listing-title">${esc(l.title)}</div>
            ${l.level ? `<span class="ad-listing-badge">${esc(l.level)}</span>` : ''}
          </div>
          <div class="ad-listing-meta">
            ${l.ministry ? `<span>${esc(l.ministry)}</span>` : ''}
            ${l.organisation ? `<span>${esc(l.organisation)}</span>` : ''}
            ${l.functionalArea ? `<span>${esc(l.functionalArea)}</span>` : ''}
          </div>
          <div class="ad-listing-card-footer">
            ${l.closingDate ? `<span class="ad-listing-close-date">Closes ${esc(l.closingDate)}</span>` : ''}
            ${l.notificationLink ? `<a href="${esc(l.notificationLink)}" target="_blank" rel="noopener" class="ad-listing-link">Notification</a>` : ''}
          </div>
        </div>`).join('') || '<p style="color:var(--text-muted);text-align:center;padding:20px;">No vacancies found.</p>';
    }
    if (modal) {
      modal._districtTrigger = document.querySelector('.ad-delhi-hotspot.active');
      modal.showModal?.();
    }
    if (!skipPush) {
      history.pushState(
        { view: 'district', state: stateAbbr, district: districtName },
        '', `?state=${stateAbbr}&district=${encodeURIComponent(districtName)}`
      );
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

    const mapSvg = document.getElementById('map-svg');
    const g = mapSvg?.querySelector('#map-group');
    const labelsG = mapSvg?.querySelector('#map-labels');
    if (!g) return;

    const code = ABBR_TO_CODE[abbr] || abbr;
    const feats = (districtsGeo?.features || []).filter(f => f.properties.st_code === code);

    // Re-project for state's bbox
    if (feats.length) {
      computeProjection(feats);
      // Re-project national shapes too? No — keep current projection but fit
      // For now just render districts
    }

    feats.forEach((feat, idx) => {
      const geoName = feat.properties.district || `District ${idx}`;
      const count = getDistrictCount(abbr, geoName);
      const d = projectCoords(feat.geometry);
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

      path.addEventListener('click', () => navigateToDistrict(abbr, geoName));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateToDistrict(abbr, geoName); }
      });
      path.addEventListener('mouseenter', (e) => { path.classList.add('ad-gpu'); showTooltip(e, abbr, geoName, count); });
      path.addEventListener('mousemove', moveTooltip);
      path.addEventListener('mouseleave', () => { path.classList.remove('ad-gpu'); hideTooltip(); });
      g.appendChild(path);

      const [clon, clat] = centroid(feat.geometry);
      const [cx, cy] = project(clon, clat);

      if (count > 0) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('x', cx);
        badge.setAttribute('y', cy - 6);
        badge.setAttribute('class', 'ad-count-badge');
        badge.textContent = count;
        badge.style.setProperty('--ad-delay', `${500 + idx * 15}ms`);
        labelsG.appendChild(badge);
      }

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', cx);
      label.setAttribute('y', cy + 4);
      label.setAttribute('class', 'ad-district-label');
      label.textContent = geoName;
      label.style.setProperty('--ad-delay', `${550 + idx * 15}ms`);
      labelsG.appendChild(label);
    });
  }

  function getDistrictCount(abbr, districtName) {
    if (!window.IndiaMapData) return 0;
    const listings = IndiaMapData.getListingsForDistrict(abbr, districtName);
    const seen = new Set();
    listings.forEach(l => seen.add(l.id));
    return seen.size;
  }

  function onDistrictClick(abbr, districtName) {
    const listings = window.IndiaMapData ? IndiaMapData.getListingsForDistrict(abbr, districtName) : [];
    const seen = new Set();
    const unique = listings.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });

    // C24: capture district trigger element for focus restoration
    let districtTrigger = null;
    if (abbr === 'DL') {
      const activeBtn = document.querySelector('.ad-delhi-hotspot.active');
      if (activeBtn) districtTrigger = activeBtn;
    } else {
      const paths = document.querySelectorAll('#map-svg .ad-district');
      for (const p of paths) {
        if (p.dataset.district === districtName && p.dataset.abbr === abbr) {
          districtTrigger = p; break;
        }
      }
    }

    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modal = document.getElementById('modal');
    if (modalTitle) modalTitle.textContent = `${unique.length} Vacanc${unique.length !== 1 ? 'ies' : 'y'} in ${districtName}`;
    if (modalBody) {
      modalBody.innerHTML = unique.map((l, i) => `
        <div class="ad-listing-card visible" style="animation-delay:${i * 60}ms">
          <div class="ad-listing-card-header">
            <div class="ad-listing-title">${esc(l.title)}</div>
            ${l.level ? `<span class="ad-listing-badge">${esc(l.level)}</span>` : ''}
          </div>
          <div class="ad-listing-meta">
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
    if (modal) {
      modal._districtTrigger = districtTrigger;
      modal.showModal?.();
      history.pushState(
        { view: 'district', state: abbr, district: districtName },
        '', `?state=${abbr}&district=${encodeURIComponent(districtName)}`
      );
    }
  }

  // ----- Tooltip -----
  function showTooltip(event, abbr, name, count) {
    const t = document.getElementById('mapTooltip');
    if (!t) return;
    const n = document.getElementById('mapTooltipName');
    const c = document.getElementById('mapTooltipCount');
    const m = document.getElementById('mapTooltipMeta');
    if (n) n.textContent = name;
    // C21: tooltip count respects activeMapFilter
    let tooltipCount = count;
    if (activeMapFilter !== 'all' && window.IndiaMapData) {
      const filtered = IndiaMapData.getFiltered(abbr, { category: activeMapFilter === 'functional' ? 'Functional' : 'Education' });
      tooltipCount = filtered.length;
    }
    if (c) c.textContent = `${tooltipCount} vacanc${tooltipCount !== 1 ? 'ies' : ''}`;
    if (m) {
      const listings = window.IndiaMapData ? IndiaMapData.getFiltered(abbr, {}) : [];
      const cats = {};
      listings.forEach(v => { cats[v.category] = (cats[v.category]||0)+1; });
      m.textContent = Object.entries(cats).map(([k,v]) => `${v} ${k}`).join(' · ') || '';
    }
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
  function updateCounter(data) {
    const v = document.getElementById('mapCounterValue');
    if (v) v.textContent = (data?.nationalCount || 0).toLocaleString();
  }

  function getData() {
    const sc = window.IndiaMapData?.getStateCounts?.() || {};
    return {
      nationalCount: Object.values(sc).reduce((s, c) => s + c, 0),
      stateCounts: sc,
    };
  }

  // ----- Filter buttons -----
  function applyFilter(type) {
    activeMapFilter = type; // C21: store filter state for tooltip consistency
    const paths = document.querySelectorAll('#map-svg .ad-state');
    const labelsG = document.querySelector('#map-svg #map-labels');
    let filteredTotal = 0;
    paths.forEach(p => {
      const abbr = p.dataset.abbr;
      let visible = true;
      let count = 0;
      if (type === 'functional') {
        const list = window.IndiaMapData?.getFiltered?.(abbr, { category: 'Functional' }) || [];
        count = list.length;
        visible = count > 0;
      } else if (type === 'education') {
        const list = window.IndiaMapData?.getFiltered?.(abbr, { category: 'Education' }) || [];
        count = list.length;
        visible = count > 0;
      } else {
        count = window.IndiaMapData?.getStateCount?.(abbr) || 0;
      }
      filteredTotal += count;
      p.style.opacity = visible ? '1' : '0.12';
      p.setAttribute('aria-label', `${ABBR_TO_NAME[abbr] || abbr}: ${count} vacancies`);
      // Update count label from the shared #map-labels group
      if (labelsG) {
        const countEl = labelsG.querySelector(`text.ad-state-count[data-for="${abbr}"]`);
        if (countEl) {
          countEl.textContent = type === 'all' ? count : (count > 0 ? count : '');
          countEl.style.display = (type !== 'all' && count === 0) ? 'none' : '';
        }
      }
    });
    // Update header counter
    const counter = document.getElementById('mapCounterValue');
    if (counter) counter.textContent = filteredTotal.toLocaleString();
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
    const vb = svg.viewBox.baseVal;
    vb.x = 0; vb.y = 0; vb.width = 1000; vb.height = 800;
  }

  // ----- Back button (C18: delegates to history for URL sync) -----
  async function goBack() {
    if (viewMode === 'state') {
      history.back(); // triggers popstate → goToView
      return;
    } else if (viewMode === 'district') {
      const m = document.getElementById('modal');
      if (m) m.close?.();
      // After close, the close handler on the modal will restore focus.
      // Fall back to the state view if district → state navigation needed.
      history.back(); // pops district → triggers popstate
      return;
    }
  }

  // ===== History / Deep linking (C18) =====
  let _popstateGuard = false;

  // One clear navigation path: user click → push exactly one entry.
  // popstate → render only, never push. deep-link → replace current entry.
  async function navigateToState(stateAbbr) {
    const name = ABBR_TO_NAME[stateAbbr] || stateAbbr;
    await drillToState(stateAbbr, name);
    history.pushState({ view: 'state', state: stateAbbr, district: null }, '', `?state=${stateAbbr}`);
  }

  async function navigateToDistrict(stateAbbr, districtName) {
    // If we're not already on the state, drill there first (no push)
    if (viewMode !== 'state' || selectedAbbr !== stateAbbr) {
      await drillToState(stateAbbr, ABBR_TO_NAME[stateAbbr] || stateAbbr);
    }
    openDistrictModal(stateAbbr, districtName);
    history.pushState({ view: 'district', state: stateAbbr, district: districtName }, '',
      `?state=${stateAbbr}&district=${encodeURIComponent(districtName)}`);
  }

  // Render from URL/history state only — never pushes
  async function renderRouteFromURL(stateAbbr, districtName) {
    if (!stateAbbr) {
      await goToNational();
      return;
    }
    // Ensure state view first
    if (viewMode !== 'state' || selectedAbbr !== stateAbbr) {
      await drillToState(stateAbbr, ABBR_TO_NAME[stateAbbr] || stateAbbr);
    }
    if (districtName) {
      openDistrictModal(stateAbbr, districtName);
    }
  }

  async function goToView(stateAbbr, districtName, replace = false) {
    if (!stateAbbr) {
      if (viewMode !== 'national') await goToNational();
      return;
    }
    if (replace) {
      await renderRouteFromURL(stateAbbr, districtName);
      return;
    }
    if (districtName) {
      await navigateToDistrict(stateAbbr, districtName);
    } else {
      await navigateToState(stateAbbr);
    }
  }

  // BLOCKER 4: separate modal open from navigation so closing can restore route
  function openDistrictModal(stateAbbr, districtName) {
    selectedDistrict = districtName;
    viewMode = 'district';

    const listings = window.IndiaMapData
      ? IndiaMapData.getListingsForDistrict(stateAbbr, districtName) : [];
    const seen = new Set();
    const unique = listings.filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    // BLOCKER 4: capture district trigger for focus restoration
    let districtTrigger = null;
    if (stateAbbr === 'DL') {
      const activeBtn = document.querySelector('.ad-delhi-hotspot.active');
      if (activeBtn) districtTrigger = activeBtn;
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
    if (modalBody) {
      modalBody.innerHTML = unique.map((l, i) => `
        <div class="ad-listing-card visible" style="animation-delay:${i * 60}ms">
          <div class="ad-listing-card-header">
            <div class="ad-listing-title">${esc(l.title)}</div>
            ${l.level ? `<span class="ad-listing-badge">${esc(l.level)}</span>` : ''}
          </div>
          <div class="ad-listing-meta">
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
    if (modal) {
      modal._districtTrigger = districtTrigger;
      modal.showModal?.();
    }
  }

  function onPopState(e) {
    if (_popstateGuard) return;
    const params = new URLSearchParams(location.search);
    const urlAbbr = (params.get('state') || '').toUpperCase();
    const urlDistrict = params.get('district') || '';
    const validAbbr = urlAbbr && (ABBR_TO_NAME[urlAbbr] || false) ? urlAbbr : null;

    if (!validAbbr && viewMode !== 'national') {
      goToNational();
      return;
    }
    goToView(validAbbr, urlDistrict || null, true);
  }

  async function goToNational() {
    const gen = ++renderGeneration;
    selectedDistrict = null;
    // Close district modal if open (can survive after a back-navigation)
    const modal = document.getElementById('modal');
    if (modal) { try { modal.close(); } catch(e) {} }
    const mapArea = document.getElementById('mapSvgWrap');
    const needRebuild = !document.getElementById('map-svg');
    if (needRebuild && mapArea) {
      mapArea.innerHTML = '';
      mapArea.appendChild(buildSvg());
    }
    const svg = document.getElementById('map-svg');
    if (svg) {
      const vb = svg.viewBox.baseVal;
      await animateViewBox(svg, { x: vb.x, y: vb.y, w: vb.width, h: vb.height }, { x: 0, y: 0, w: 1000, h: 800 }, 400);
    }
    if (gen !== renderGeneration) return;
    selectedAbbr = null;
    viewMode = 'national';
    const back = document.getElementById('btn-back');
    if (back) back.hidden = true;
    const data = getData();
    renderNational(data);
    spawnRippleForHighCounts(data);
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

    // BLOCKER 1 + 9: render national map BEFORE deep-link so draw-in can complete
    // Deep-link must use replace=true so initial load produces exactly one history entry
    const initData = getData();
    renderNational(initData);

    // Start particles on canvas
    startParticles();

    // Wire popstate handler (C18)
    window.addEventListener('popstate', onPopState);

    // Deep-link handler (C18: support both state and district)
    // BLOCKER 9: use replace=true so initial load produces exactly one history entry
    const urlParams = new URLSearchParams(location.search);
    const deepState = urlParams.get('state');
    const deepDistrict = urlParams.get('district');
    if (deepState) {
      const abbr = deepState.toUpperCase();
      if (ABBR_TO_NAME[abbr]) {
        const params = deepDistrict
          ? `?state=${abbr}&district=${encodeURIComponent(deepDistrict)}`
          : `?state=${abbr}`;
        history.replaceState({ view: deepDistrict ? 'district' : 'state', state: abbr, district: deepDistrict || null }, '', params);
        const doDrill = () => {
          const d = deepDistrict ? decodeURIComponent(deepDistrict) : null;
          renderRouteFromURL(abbr, d);
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            document.addEventListener('map:drawInComplete', doDrill, { once: true });
          });
        } else {
          document.addEventListener('map:drawInComplete', doDrill, { once: true });
        }
      }
    } else {
      history.replaceState({ view: 'national', state: null, district: null }, '', location.pathname);
    }

    // Subscribe to Supabase Realtime for live vacancy inserts
    setupRealtime();

    // Wire controls
    const back = document.getElementById('btn-back');
    if (back) { back.hidden = true; back.addEventListener('click', goBack); }
    const mapBack = document.getElementById('mapBackBtn');
    if (mapBack) mapBack.addEventListener('click', goBack);
    document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn);
    document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut);
    document.getElementById('zoomResetBtn')?.addEventListener('click', zoomReset);

    // Wire modal close handlers
    // BLOCKER 4: the 'close' event fires for ALL close paths (button, Escape, backdrop).
    // Wire the button to close the dialog; the event listener below handles everything.
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
        restoreStateFromDistrictClose();
      });
    }

    // BLOCKER 4: helper — when district modal closes, return view to state route
    function restoreStateFromDistrictClose() {
      if (viewMode === 'district' && selectedAbbr) {
        viewMode = 'state';
        selectedDistrict = null;
        // Update URL to reflect we're on state view (replace current entry)
        history.replaceState({ view: 'state', state: selectedAbbr, district: null }, '', `?state=${selectedAbbr}`);
      }
    }

    document.querySelectorAll('.map-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.map-filter-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        applyFilter(btn.dataset.filter);
        announce(`Filter: ${btn.textContent}`);
      });
    });

    // Wire gesture controls
    const mapSvgEl = document.getElementById('map-svg');
    if (mapSvgEl) {
      mapSvgEl.style.touchAction = 'none';
      mapSvgEl.addEventListener('wheel', onWheelZoom, { passive: false });
      mapSvgEl.addEventListener('touchstart', onTouchStart, { passive: false });
      mapSvgEl.addEventListener('touchmove', onTouchMove, { passive: false });
      mapSvgEl.addEventListener('touchend', onTouchEnd);
      mapSvgEl.addEventListener('touchcancel', onTouchEnd);
      mapSvgEl.addEventListener('pointerdown', onPointerDown);
      mapSvgEl.addEventListener('pointermove', onPointerMove);
      mapSvgEl.addEventListener('pointerup', onPointerUp);
      mapSvgEl.addEventListener('pointercancel', onPointerUp);
    }

    // Filter toggle button (mobile)
    document.getElementById('mapFiltersToggle')?.addEventListener('click', onFiltersToggle);

    // Handle viewport resize — particles + filter toggle (C24)
    let resizeDebounce;
    window.addEventListener('resize', () => {
      clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => handleParticleResize(), 150);
      syncMobileFilters();
    });
    syncMobileFilters();
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

  // ----- Filter toggle (mobile) -----
  // Show/hide filter buttons and the toggle based on viewport width.
  // Touch target = 44px minimum. Close filter panel on resize to desktop.
  function syncMobileFilters() {
    const btn = document.getElementById('mapFiltersToggle');
    const filters = document.querySelector('.map-filters');
    if (!btn || !filters) return;
    const isMobile = window.innerWidth < 768;
    btn.hidden = !isMobile;
    if (!isMobile) {
      filters.classList.remove('open');
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
  }
  function onFiltersToggle() {
    const btn = document.getElementById('mapFiltersToggle');
    const filters = document.querySelector('.map-filters');
    if (!btn || !filters) return;
    const isOpen = filters.classList.toggle('open');
    btn.classList.toggle('open', isOpen);
    btn.setAttribute('aria-expanded', String(isOpen));
  }

  // C24: handle particle lifecycle on resize
  function handleParticleResize() {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      stopParticles();
    } else {
      resizeParticleCanvas();
      if (!particleRaf) {
        resetParticles();
        isMapVisible = true;
        tickParticles();
      }
    }
  }

  // ----- Particles (canvas background) -----
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
      path.classList.add('liquid-fill');
      path.style.fill = 'url(#liquid-gradient)';
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
      totalEl.textContent = (IndiaMapData.getTotal ? IndiaMapData.getTotal() : 0).toLocaleString();
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

  // ===== Ambient canvas particles with spatial grid =====
  const CONN_DIST = 120;
  const SPEED = 0.35;
  let particleRaf = null;
  let particles = [];
  let particleCanvas = null;
  let particleCtx = null;
  let particleMouseX = -9999;
  let particleMouseY = -9999;
  let isMapVisible = false;

  function getParticleCount() {
    const isMobile = window.innerWidth < 768;
    let count = isMobile ? 25 : 50;
    const cores = navigator.hardwareConcurrency || 8;
    if (cores <= 4) count = Math.floor(count / 2);
    return count;
  }

  function initParticleCanvas() {
    particleCanvas = document.getElementById('particleCanvas');
    if (!particleCanvas) return false;
    particleCtx = particleCanvas.getContext('2d');
    return true;
  }

  function resizeParticleCanvas() {
    if (!particleCanvas) return;
    const container = particleCanvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    particleCanvas.width = rect.width;
    particleCanvas.height = rect.height;
  }

  function makeParticle() {
    const canvas = particleCanvas;
    return {
      x: Math.random() * (canvas ? canvas.width : 800),
      y: Math.random() * (canvas ? canvas.height : 600),
      vx: (Math.random() - 0.5) * SPEED * 2,
      vy: (Math.random() - 0.5) * SPEED * 2,
      r: 1.2 + Math.random() * 1.4,
      alpha: 0.25 + Math.random() * 0.45,
    };
  }

  function resetParticles() {
    if (!particleCanvas) return;
    particles = [];
    for (let i = 0; i < getParticleCount(); i++) {
      particles.push(makeParticle());
    }
  }

  function buildSpatialGrid(pts, cellSize) {
    const grid = new Map();
    for (let i = 0; i < pts.length; i++) {
      const cx = Math.floor(pts[i].x / cellSize);
      const cy = Math.floor(pts[i].y / cellSize);
      const key = cx + ',' + cy;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    return grid;
  }

  function tickParticles() {
    if (!isMapVisible || !particleCtx || !particleCanvas) return;
    const w = particleCanvas.width;
    const h = particleCanvas.height;
    if (w === 0 || h === 0) { particleRaf = requestAnimationFrame(tickParticles); return; }

    particleCtx.clearRect(0, 0, w, h);

    // Move
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w;
      if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h;
      if (p.y > h) p.y = 0;
    }

    // Connections via spatial grid
    const grid = buildSpatialGrid(particles, CONN_DIST);
    const drawn = new Set();
    particleCtx.lineWidth = 0.5;

    for (let i = 0; i < particles.length; i++) {
      const pi = particles[i];
      const cx = Math.floor(pi.x / CONN_DIST);
      const cy = Math.floor(pi.y / CONN_DIST);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get((cx + dx) + ',' + (cy + dy));
          if (!cell) continue;
          for (let k = 0; k < cell.length; k++) {
            const j = cell[k];
            if (j <= i) continue;
            const pairKey = i * 10000 + j;
            if (drawn.has(pairKey)) continue;
            drawn.add(pairKey);
            const pj = particles[j];
            const ddx = pi.x - pj.x;
            const ddy = pi.y - pj.y;
            const dist = Math.sqrt(ddx * ddx + ddy * ddy);
            if (dist < CONN_DIST) {
              const opacity = (1 - dist / CONN_DIST) * 0.18;
              particleCtx.strokeStyle = `rgba(245,167,33,${opacity})`;
              particleCtx.beginPath();
              particleCtx.moveTo(pi.x, pi.y);
              particleCtx.lineTo(pj.x, pj.y);
              particleCtx.stroke();
            }
          }
        }
      }
    }

    // Draw particles
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      particleCtx.beginPath();
      particleCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      particleCtx.fillStyle = `rgba(245,167,33,${p.alpha})`;
      particleCtx.fill();
    }

    particleRaf = requestAnimationFrame(tickParticles);
  }

  function startParticles() {
    if (particleRaf) return; // already running
    // Skip entirely on mobile to save GPU
    if (window.innerWidth < 768) return;
    if (!initParticleCanvas()) return;
    resizeParticleCanvas();
    resetParticles();
    isMapVisible = true;
    tickParticles();
  }

  function stopParticles() {
    isMapVisible = false;
    if (particleRaf) {
      cancelAnimationFrame(particleRaf);
      particleRaf = null;
    }
    if (particleCtx && particleCanvas) {
      particleCtx.clearRect(0, 0, particleCanvas.width, particleCanvas.height);
    }
    particles = [];
  }

  // BLOCKER 8: read-only test hook — reports particle loop state, no data exposure
  window.__mapParticleState = function __mapParticleState() {
    return {
      rafRunning: particleRaf !== null,
      particleCount: particles.length,
      canvasWidth: particleCanvas ? particleCanvas.width : 0,
      canvasHeight: particleCanvas ? particleCanvas.height : 0,
      isMapVisible: isMapVisible,
    };
  };

  // ===== GPU acceleration class =====
  // .ad-gpu is toggled per-element on hover (in renderNational / renderState)
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
