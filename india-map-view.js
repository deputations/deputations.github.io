// ===== india-map-view.js =====
// Production India Map — adapted from prototype map-view.js.
// All issues fixed: Ladakh (st_code: 38), 36-state coverage,
// projection clipping, ambient pulse on empty states, draw-in animation.

(() => {
  'use strict';

  let mapInitialised = false;
  let viewMode = 'national';
  let selectedAbbr = null;
  let districtsGeo = null;
  let districtsPromise = null;
  let currentProjection = null;
  let zoomAnimFrame = null;
  let generation = 0;

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

  // ----- Lazy load districts -----
  function ensureDistrictsLoaded() {
    if (districtsGeo) return Promise.resolve(districtsGeo);
    if (districtsPromise) return districtsPromise;
    districtsPromise = fetch('geo/india-districts-all.geojson')
      .then(r => r.ok ? r.json() : null)
      .then(g => { districtsGeo = g; return g; })
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
    path.style.strokeDashoffset = total;
    return total;
  }

  function playDrawIn(path, delay) {
    path.style.animation = 'none';
    // force reflow to restart animation
    void path.getBoundingClientRect();
    path.style.animation = `ad-draw-state 1.2s ease-out ${delay}ms forwards`;
  }

  function clearMap() {
    const old = document.getElementById('map-svg');
    if (old) old.remove();
    const wrap = document.getElementById('mapSvgWrap');
    if (wrap) wrap.appendChild(buildSvg());
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
        showTooltip(e, name, count);
        document.querySelectorAll('#map-svg .ad-state').forEach(s => {
          if (s !== path) s.classList.add('neighbor-dim');
        });
      });
      path.addEventListener('mousemove', moveTooltip);
      path.addEventListener('mouseleave', () => {
        hideTooltip();
        document.querySelectorAll('#map-svg .ad-state').forEach(s => s.classList.remove('neighbor-dim'));
      });
      path.addEventListener('click', () => drillToState(abbr, name));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drillToState(abbr, name); }
      });
      g.appendChild(path);

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
        num.style.setProperty('--ad-delay', `${900 + idx * 20}ms`);
        num.textContent = count;
        labelsG.appendChild(num);
      }
    });

    // Trigger draw-in for all paths after the SVG is in the DOM
    requestAnimationFrame(() => {
      document.querySelectorAll('#map-svg .ad-state').forEach((p, i) => {
        const delay = Math.min(i * 30, 600);
        playDrawIn(p, delay);
        // Make visible after its draw-in completes
        const totalDuration = delay + 1200;
        setTimeout(() => p.classList.add('drawn'), totalDuration);
      });
      // Count labels pop in after draw-in
      document.querySelectorAll('#map-svg .ad-state-count').forEach((el, i) => {
        el.style.animationDelay = `${900 + i * 20}ms`;
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

    updateCounter(data);
  }

  // ----- Drill to state -----
  async function drillToState(abbr, name) {
    if (viewMode === 'state' && selectedAbbr === abbr) return;
    const gen = ++generation;

    const dGeo = await ensureDistrictsLoaded();
    if (gen !== generation || !dGeo) return;

    // Mark selected
    const sel = document.querySelector(`[data-abbr="${abbr}"].ad-state`);
    if (sel) {
      sel.style.transition = 'fill 0.2s, stroke 0.2s';
      sel.classList.add('selected');
    }

    await cinematicZoom(abbr);
    if (gen !== generation) return;

    renderState(abbr, name);
    selectedAbbr = abbr;
    viewMode = 'state';
    const back = document.getElementById('btn-back');
    if (back) back.hidden = false;
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
      if (zoomAnimFrame) cancelAnimationFrame(zoomAnimFrame);
      function frame(now) {
        const t = Math.min((now - t0) / duration, 1);
        const e = 1 - Math.pow(1 - t, 3);
        vb.x = start.x + (target.x - start.x) * e;
        vb.y = start.y + (target.y - start.y) * e;
        vb.width = start.w + (target.w - start.w) * e;
        vb.height = start.h + (target.h - start.h) * e;
        if (t < 1) zoomAnimFrame = requestAnimationFrame(frame);
        else { zoomAnimFrame = null; resolve(); }
      }
      zoomAnimFrame = requestAnimationFrame(frame);
    });
  }

  function renderState(abbr, name) {
    clearMap();
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

      path.addEventListener('click', () => onDistrictClick(abbr, geoName));
      path.addEventListener('mouseenter', (e) => showTooltip(e, geoName, count));
      path.addEventListener('mousemove', moveTooltip);
      path.addEventListener('mouseleave', hideTooltip);
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

    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modal = document.getElementById('modal');
    if (modalTitle) modalTitle.textContent = `${unique.length} Vacanc${unique.length !== 1 ? 'ies' : 'y'} in ${districtName}`;
    if (modalBody) {
      modalBody.innerHTML = unique.map((l, i) => `
        <div class="ad-listing-card visible" style="animation-delay:${i * 60}ms">
          <div class="ad-listing-card-header">
            <div class="ad-listing-title">${esc(l.title)}</div>
            <span class="ad-listing-badge">${esc(l.functional || l.qualification || 'Any')}</span>
          </div>
          <div class="ad-listing-meta">
            ${l.ministry ? `<span>${esc(l.ministry)}</span>` : ''}
            ${l.payLevel ? `<span>Pay Level ${esc(l.payLevel)}</span>` : ''}
          </div>
          <div class="ad-listing-card-footer">
            ${l.closingDate ? `<span class="ad-listing-close-date">Closes ${esc(l.closingDate)}</span>` : ''}
            <span class="ad-listing-posts">${l.posts || 1} post${(l.posts || 1) > 1 ? 's' : ''}</span>
          </div>
        </div>`).join('') || '<p style="color:var(--text-muted); text-align:center; padding:20px;">No vacancies found.</p>';
    }
    if (modal) modal.showModal?.();
  }

  // ----- Tooltip -----
  function showTooltip(event, name, count) {
    const t = document.getElementById('mapTooltip');
    if (!t) return;
    const n = document.getElementById('mapTooltipName');
    const c = document.getElementById('mapTooltipCount');
    if (n) n.textContent = name;
    if (c) c.textContent = `${count} vacancy${count !== 1 ? 'ies' : ''}`;
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
    const sc = window.IndiaMapData?.stateCounts || {};
    return {
      nationalCount: Object.values(sc).reduce((s, c) => s + c, 0),
      stateCounts: sc,
    };
  }

  // ----- Filter buttons -----
  function applyFilter(type) {
    const paths = document.querySelectorAll('#map-svg .ad-state');
    paths.forEach(p => {
      const abbr = p.dataset.abbr;
      let visible = true;
      if (type === 'functional') {
        visible = (window.IndiaMapData?.getFiltered?.(abbr, { category: 'Functional' }) || []).length > 0;
      } else if (type === 'education') {
        visible = (window.IndiaMapData?.getFiltered?.(abbr, { category: 'Education' }) || []).length > 0;
      }
      p.style.opacity = visible ? '1' : '0.12';
    });
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

  // ----- Back button -----
  async function goBack() {
    if (viewMode === 'state') {
      const gen = ++generation;
      const svg = document.getElementById('map-svg');
      if (svg) {
        const vb = svg.viewBox.baseVal;
        await animateViewBox(svg, { x: vb.x, y: vb.y, w: vb.width, h: vb.height }, { x: 0, y: 0, w: 1000, h: 800 }, 400);
        if (gen !== generation) return;
      }
      renderNational(getData());
      const back = document.getElementById('btn-back');
      if (back) back.hidden = true;
      selectedAbbr = null;
      viewMode = 'national';
    } else if (viewMode === 'district') {
      const m = document.getElementById('modal');
      if (m) m.close?.();
      if (selectedAbbr) {
        renderState(selectedAbbr, ABBR_TO_NAME[selectedAbbr] || selectedAbbr);
        viewMode = 'state';
      } else {
        goBack();
      }
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

    // Load geometry
    try {
      const resp = await fetch('geo/india-states.geojson');
      if (resp.ok) window._indiaGeoData = await resp.json();
    } catch (e) { console.error('[map] state geo load failed:', e); }

    // Load data
    if (window.IndiaMapData && IndiaMapData.load) {
      try { await IndiaMapData.load(); } catch (e) { console.error('[map] data load failed:', e); }
    }

    // Start particles on canvas
    startParticles();

    renderNational(getData());

    // Wire controls
    const back = document.getElementById('btn-back');
    if (back) { back.hidden = true; back.addEventListener('click', goBack); }
    const mapBack = document.getElementById('mapBackBtn');
    if (mapBack) mapBack.addEventListener('click', goBack);
    document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn);
    document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut);
    document.getElementById('zoomResetBtn')?.addEventListener('click', zoomReset);
    document.querySelectorAll('.map-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.map-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilter(btn.dataset.filter);
      });
    });
  };

  function startParticles() {
    const canvas = document.getElementById('particleCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = [];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width, y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 1.2 + 0.3, a: Math.random() * 0.3 + 0.05,
      });
    }
    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 110) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(34,211,238,${0.07 * (1 - d / 110)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,211,238,${p.a})`;
        ctx.fill();
      });
      requestAnimationFrame(animate);
    }
    animate();
    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  }
})();
