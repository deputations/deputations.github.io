// ===== india-map-view.js =====
// Production India Map view — adapted from the working prototype.
// Matches the actual HTML structure in index.html.

(() => {
  'use strict';

  // ---- state ----
  let mapInitialised = false;
  let viewMode = 'national';
  let selectedAbbr = null;
  let selectedDistrict = null;
  let generation = 0;
  let geoData = null;
  let districtsGeo = null;
  let currentProjection = null;
  let zoomLevel = 1.0;
  let panX = 0, panY = 0;
  let zoomAnimFrame = null;

  // ---- projection (from prototype) ----
  function computeProjection(features) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    features.forEach(f => {
      if (!f.geometry) return;
      const coords = flattenCoords(f.geometry);
      coords.forEach(([lon, lat]) => {
        if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
      });
    });
    if (!isFinite(minLon)) { minLon = 68; maxLon = 97; minLat = 6; maxLat = 36; }
    const lonRange = (maxLon - minLon) || 1;
    const latRange = (maxLat - minLat) || 1;
    const mapW = 1000, mapH = 800;
    const scale = Math.min(mapW / (lonRange * 1.04), mapH / (latRange * 1.04));
    const offsetX = (mapW - lonRange * scale) / 2;
    const offsetY = (mapH + latRange * scale) / 2;
    currentProjection = { minLon, maxLon, minLat, maxLat, scale, offsetX, offsetY };
  }

  function project(lon, lat) {
    if (!currentProjection) return [500, 400];
    const p = currentProjection;
    return [(lon - p.minLon) * p.scale + p.offsetX, p.offsetY - (lat - p.minLat) * p.scale];
  }

  function flattenCoords(geom) {
    const result = [];
    if (geom.type === 'Polygon') {
      geom.coordinates.filter(hasRealExtent).forEach(ring => ring.forEach(c => result.push(c)));
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach(poly => {
        poly.filter(hasRealExtent).forEach(ring => ring.forEach(c => result.push(c)));
      });
    }
    return result;
  }

  function hasRealExtent(ring) {
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const c of ring) {
      if (c[0] < minLon) minLon = c[0]; if (c[0] > maxLon) maxLon = c[0];
      if (c[1] < minLat) minLat = c[1]; if (c[1] > maxLat) maxLat = c[1];
    }
    return (maxLon - minLon) > 0.01 && (maxLat - minLat) > 0.01;
  }

  function getValidRings(geom) {
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
    if (pts.length === 0) return [0, 0];
    let sumLon = 0, sumLat = 0;
    pts.forEach(([lon, lat]) => { sumLon += lon; sumLat += lat; });
    return [sumLon / pts.length, sumLat / pts.length];
  }

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // ---- state mappings ----
  const STATE_ABBR = {
    'Jammu and Kashmir':'JK','Himachal Pradesh':'HP','Punjab':'PB','Chandigarh':'CH',
    'Uttarakhand':'UT','Haryana':'HR','Delhi':'DL','Rajasthan':'RJ','Uttar Pradesh':'UP',
    'Bihar':'BR','Sikkim':'SK','Arunachal Pradesh':'AR','Nagaland':'NL','Manipur':'MN',
    'Mizoram':'MZ','Tripura':'TR','Meghalaya':'ML','Assam':'AS','West Bengal':'WB',
    'Jharkhand':'JH','Odisha':'OD','Chhattisgarh':'CG','Madhya Pradesh':'MP',
    'Gujarat':'GJ','Maharashtra':'MH','Andhra Pradesh':'AP','Karnataka':'KA',
    'Goa':'GA','Kerala':'KL','Tamil Nadu':'TN','Puducherry':'PY',
    'Andaman and Nicobar':'AN','Telangana':'TS','Lakshadweep':'LD',
    'Dadra and Nagar Haveli':'DN','Daman and Diu':'DD',
  };
  const ABBR_TO_NAME = Object.fromEntries(Object.entries(STATE_ABBR).map(([k,v]) => [v,k]));

  // ---- SVG creation ----
  function buildSVG() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('xmlns', ns);
    svg.setAttribute('viewBox', '0 0 1000 800');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.id = 'map-svg';
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'India map showing vacancy counts');

    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = '<filter id="state-glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
    svg.appendChild(defs);

    const g = document.createElementNS(ns, 'g');
    g.id = 'map-group';
    svg.appendChild(g);

    return svg;
  }

  // ---- rendering ----
  function clearMap() {
    const mapSvg = document.getElementById('map-svg');
    if (mapSvg) {
      while (mapSvg.firstChild) mapSvg.removeChild(mapSvg.firstChild);
      // Re-add defs
      const ns = 'http://www.w3.org/2000/svg';
      const defs = document.createElementNS(ns, 'defs');
      defs.innerHTML = '<filter id="state-glow"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>';
      mapSvg.appendChild(defs);
      const g = document.createElementNS(ns, 'g');
      g.id = 'map-group';
      mapSvg.appendChild(g);
    }
  }

  function renderNationalMap(data) {
    viewMode = 'national';
    selectedAbbr = null;
    selectedDistrict = null;
    clearMap();

    if (!geoData) return;

    computeProjection(geoData.features);
    applyZoomTransform();

    const mapSvg = document.getElementById('map-svg');
    const g = mapSvg?.querySelector('#map-group');
    if (!g) return;

    geoData.features.forEach((feat, idx) => {
      const name = feat.properties.NAME_1;
      const abbr = STATE_ABBR[name] || null;
      if (!abbr) return;

      const d = projectCoords(feat.geometry);
      if (!d) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `${d} Z`);
      path.setAttribute('class', 'ad-state');
      path.setAttribute('data-abbr', abbr);
      path.setAttribute('data-name', name);
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', '0');
      path.setAttribute('aria-label', `${name}: ${data.stateCounts[abbr] || 0} vacancies`);

      const count = data.stateCounts[abbr] || 0;
      if (count === 0) path.classList.add('empty-state');

      // Entrance: draw-in animation
      path.style.opacity = '0';
      const length = 800;
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
      setTimeout(() => {
        path.style.transition = 'opacity 0.5s ease, stroke-dashoffset 1s ease-out';
        path.style.opacity = '1';
        path.style.strokeDashoffset = '0';
      }, 50 + idx * 30);

      path.addEventListener('mouseenter', (e) => showTooltip(e, name, count, abbr));
      path.addEventListener('mousemove', moveTooltip);
      path.addEventListener('mouseleave', hideTooltip);
      path.addEventListener('focus', (e) => showTooltip(e, name, count, abbr));
      path.addEventListener('blur', hideTooltip);
      path.addEventListener('click', () => drillToState(abbr, name));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drillToState(abbr, name); }
      });
      g.appendChild(path);

      // State label
      const [clon, clat] = centroid(feat.geometry);
      const [cx, cy] = project(clon, clat);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', cx);
      label.setAttribute('y', cy - 4);
      label.setAttribute('class', 'ad-state-label');
      label.textContent = abbr;
      g.appendChild(label);

      if (count > 0) {
        const countEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        countEl.setAttribute('x', cx);
        countEl.setAttribute('y', cy + 10);
        countEl.setAttribute('class', 'ad-state-count');
        countEl.textContent = count;
        countEl.style.animationDelay = `${Math.min(idx * 30, 600)}ms`;
        g.appendChild(countEl);
      }
    });

    updateCounter(data);
  }

  // ---- drill-down ----
  async function drillToState(abbr, name) {
    if (viewMode === 'state' && selectedAbbr === abbr) return;

    const gen = ++generation;

    // Load district geometry
    if (!districtsGeo) {
      try {
        const resp = await fetch('prototypes/india-map/geo/india-districts-all.geojson');
        if (resp.ok) districtsGeo = await resp.json();
      } catch (e) {
        console.warn('[map] district geo load failed:', e);
      }
    }
    if (gen !== generation) return;

    // Cinematic zoom
    await cinematicZoom(abbr);
    if (gen !== generation) return;

    renderStateMap(abbr, name);
    selectedAbbr = abbr;
    viewMode = 'state';

    const backBtn = document.getElementById('btn-back');
    if (backBtn) backBtn.hidden = false;
  }

  async function cinematicZoom(abbr) {
    const svg = document.getElementById('map-svg');
    if (!svg) return;

    const vb = svg.viewBox.baseVal;
    if (!vb || vb.width === 0) return;

    // Find state centroid from districts
    const stateFeatures = (districtsGeo?.features || []).filter(f => f.properties.st_code === abbr);
    let cx = 500, cy = 400;
    if (stateFeatures.length > 0) {
      const allCoords = stateFeatures.flatMap(f =>
        f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat().flat() : f.geometry.coordinates[0]
      );
      if (allCoords.length > 0) {
        const proj = allCoords.map(c => project(c[0], c[1]));
        cx = proj.reduce((s, p) => s + p[0], 0) / proj.length;
        cy = proj.reduce((s, p) => s + p[1], 0) / proj.length;
      }
    }

    const targetW = vb.width / 2.2;
    const targetH = vb.height / 2.2;
    const targetVB = {
      x: cx - targetW / 2,
      y: cy - targetH / 2,
      w: targetW,
      h: targetH
    };
    const startVB = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };

    await animateViewBox(svg, startVB, targetVB, 550);
  }

  function animateViewBox(svg, start, target, duration) {
    return new Promise(resolve => {
      const vb = svg.viewBox.baseVal;
      const startTime = performance.now();

      if (zoomAnimFrame) { cancelAnimationFrame(zoomAnimFrame); zoomAnimFrame = null; }

      function frame(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const e = 1 - Math.pow(1 - t, 3);
        vb.x = start.x + (target.x - start.x) * e;
        vb.y = start.y + (target.y - start.y) * e;
        vb.width = start.w + (target.w - start.w) * e;
        vb.height = start.h + (target.h - start.h) * e;
        if (t < 1) {
          zoomAnimFrame = requestAnimationFrame(frame);
        } else {
          zoomAnimFrame = null;
          resolve();
        }
      }
      zoomAnimFrame = requestAnimationFrame(frame);
    });
  }

  function applyZoomTransform() {
    const svg = document.getElementById('map-svg');
    if (!svg) return;
    const vb = svg.viewBox.baseVal;
    if (!vb || vb.width === 0) return;

    const cx = vb.x + vb.width / 2;
    const cy = vb.y + vb.height / 2;
    const newW = 1000 / zoomLevel;
    const newH = 800 / zoomLevel;
    vb.x = cx - newW / 2 + panX;
    vb.y = cy - newH / 2 + panY;
    vb.width = newW;
    vb.height = newH;
  }

  function renderStateMap(abbr, stateName) {
    clearMap();

    const stateFeatures = (districtsGeo?.features || []).filter(f => f.properties.st_code === abbr);

    const mapSvg = document.getElementById('map-svg');
    const g = mapSvg?.querySelector('#map-group');
    if (!g) return;

    stateFeatures.forEach((feat, idx) => {
      const geoName = feat.properties.district || `District ${idx}`;
      const count = getCountForDistrict(abbr, geoName);
      const d = projectCoords(feat.geometry);
      if (!d) return;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `${d} Z`);
      path.setAttribute('class', `ad-district${count === 0 ? ' empty-state' : ''}`);
      path.setAttribute('data-abbr', abbr);
      path.setAttribute('data-district', geoName);
      path.setAttribute('role', 'button');
      path.setAttribute('tabindex', '0');
      path.setAttribute('aria-label', `${geoName}: ${count} vacancies`);

      path.style.opacity = '0';
      setTimeout(() => {
        path.style.transition = 'opacity 0.35s ease';
        path.style.opacity = '1';
      }, 30 + idx * 20);

      path.addEventListener('click', () => onDistrictClick(abbr, geoName, count));
      path.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDistrictClick(abbr, geoName, count); }
      });
      path.addEventListener('mouseenter', (e) => showTooltip(e, geoName, count, abbr));
      path.addEventListener('mousemove', moveTooltip);
      path.addEventListener('mouseleave', hideTooltip);
      g.appendChild(path);

      const [clon, clat] = centroid(feat.geometry);
      const [cx, cy] = project(clon, clat);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', cx);
      label.setAttribute('y', cy + 3);
      label.setAttribute('class', 'ad-district-label');
      label.textContent = geoName;
      label.style.opacity = '0';
      g.appendChild(label);
      setTimeout(() => { label.style.transition = 'opacity 0.3s'; label.style.opacity = '1'; }, 500 + idx * 15);

      if (count > 0) {
        const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badge.setAttribute('x', cx);
        badge.setAttribute('y', cy - 8);
        badge.setAttribute('class', 'ad-count-badge');
        badge.textContent = count;
        badge.style.opacity = '0';
        g.appendChild(badge);
        setTimeout(() => { badge.style.transition = 'opacity 0.3s'; badge.style.opacity = '1'; }, 550 + idx * 15);
      }
    });
  }

  function getCountForDistrict(abbr, districtName) {
    if (window.IndiaMapData) {
      const listings = IndiaMapData.getListingsForDistrict(abbr, districtName);
      const seen = new Set();
      let count = 0;
      listings.forEach(l => { if (!seen.has(l.id)) { seen.add(l.id); count++; } });
      return count;
    }
    return 0;
  }

  function onDistrictClick(abbr, districtName, count) {
    selectedDistrict = districtName;
    viewMode = 'district';

    const listings = window.IndiaMapData
      ? IndiaMapData.getListingsForDistrict(abbr, districtName)
      : [];
    const seen = new Set();
    const unique = listings.filter(l => { if (seen.has(l.id)) return false; seen.add(l.id); return true; });

    // Use production modal
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    const modal = document.getElementById('modal');
    if (modalTitle) modalTitle.textContent = `${unique.length} Vacanc${unique.length !== 1 ? 'ies' : 'y'} in ${districtName}`;
    if (modalBody) {
      modalBody.innerHTML = unique.map((l, i) => `
        <div class="ad-listing-card" style="animation-delay: ${i * 60}ms">
          <div class="ad-listing-card-header">
            <div class="ad-listing-title">${esc(l.title)}</div>
            <span class="ad-listing-badge qualification">${esc(l.functionalGroup || l.qualification || 'Any')}</span>
          </div>
          <div class="ad-listing-meta">
            ${l.ministry ? `<span>${esc(l.ministry)}</span>` : ''}
            ${l.payLevel ? `<span>Pay Level ${esc(l.payLevel)}</span>` : ''}
          </div>
          <div class="ad-listing-card-footer">
            ${l.closingDate ? `<span class="ad-listing-close-date">Closes ${esc(l.closingDate)}</span>` : ''}
            <span class="ad-listing-posts">${l.posts || 1} post${(l.posts || 1) > 1 ? 's' : ''}</span>
          </div>
        </div>
      `).join('') || '<p>No vacancies found.</p>';
    }
    if (modal) modal.showModal();
  }

  // ---- tooltip ----
  function showTooltip(event, name, count, abbr) {
    const tooltip = document.getElementById('mapTooltip');
    if (!tooltip) return;
    const nameEl = document.getElementById('mapTooltipName');
    const countEl = document.getElementById('mapTooltipCount');
    if (nameEl) nameEl.textContent = name;
    if (countEl) countEl.textContent = `${count} vacancy${count !== 1 ? 'ies' : ''}`;
    moveTooltip(event);
    tooltip.hidden = false;
    tooltip.classList.add('visible');
  }

  function moveTooltip(event) {
    const tooltip = document.getElementById('mapTooltip');
    if (!tooltip) return;
    const x = event.clientX || event.pageX || 0;
    const y = event.clientY || event.pageY || 0;
    tooltip.style.left = (x + 16) + 'px';
    tooltip.style.top = (y - 10) + 'px';
  }

  function hideTooltip() {
    const tooltip = document.getElementById('mapTooltip');
    if (tooltip) { tooltip.classList.remove('visible'); tooltip.hidden = true; }
  }

  // ---- navigation ----
  function goBack() {
    if (viewMode === 'district') {
      closeModal();
      if (selectedAbbr) {
        renderStateMap(selectedAbbr, ABBR_TO_NAME[selectedAbbr] || selectedAbbr);
        viewMode = 'state';
      } else {
        resetToNational();
      }
    } else if (viewMode === 'state') {
      resetToNational();
    }
  }

  function resetToNational() {
    const gen = ++generation;
    closeModal();
    const svg = document.getElementById('map-svg');
    if (svg) {
      const vb = svg.viewBox.baseVal;
      const startVB = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
      animateViewBox(svg, startVB, { x: 0, y: 0, w: 1000, h: 800 }, 400).then(() => {
        if (gen !== generation) return;
        renderNationalMap(getData());
        const backBtn = document.getElementById('btn-back');
        if (backBtn) backBtn.hidden = true;
      });
    } else {
      renderNationalMap(getData());
      const backBtn = document.getElementById('btn-back');
      if (backBtn) backBtn.hidden = true;
    }
    selectedAbbr = null;
    viewMode = 'national';
  }

  function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) modal.close();
  }

  // ---- counter ----
  function updateCounter(data) {
    const valEl = document.getElementById('mapCounterValue');
    if (valEl) valEl.textContent = (data?.nationalCount || 0).toLocaleString();
  }

  function getData() {
    if (window.IndiaMapData) {
      return {
        nationalCount: Object.values(IndiaMapData.stateCounts || {}).reduce((s, c) => s + c, 0),
        stateCounts: IndiaMapData.stateCounts || {},
      };
    }
    return { nationalCount: 0, stateCounts: {} };
  }

  // ---- zoom controls ----
  function zoomIn() {
    zoomLevel = Math.min(8, zoomLevel * 1.3);
    applyZoomTransform();
  }

  function zoomOut() {
    zoomLevel = Math.max(0.5, zoomLevel / 1.3);
    applyZoomTransform();
  }

  function zoomReset() {
    zoomLevel = 1.0;
    panX = 0; panY = 0;
    const svg = document.getElementById('map-svg');
    if (svg) {
      const vb = svg.viewBox.baseVal;
      vb.x = 0; vb.y = 0; vb.width = 1000; vb.height = 800;
    }
  }

  // ---- filters ----
  function applyFilter(filterType) {
    const mapSvg = document.getElementById('map-svg');
    if (!mapSvg) return;
    const paths = mapSvg.querySelectorAll('.ad-state');
    paths.forEach(path => {
      const abbr = path.dataset.abbr;
      let visible = true;
      if (filterType === 'functional') {
        const filtered = window.IndiaMapData?.getFiltered(abbr, { functional: 'functional' }) || [];
        visible = filtered.length > 0;
      } else if (filterType === 'education') {
        const filtered = window.IndiaMapData?.getFiltered(abbr, { education: 'education' }) || [];
        visible = filtered.length > 0;
      }
      path.style.opacity = visible ? '1' : '0.1';
    });
  }

  // ---- main init ----
  window.initIndiaMap = async function() {
    if (mapInitialised) return;
    mapInitialised = true;

    const wrap = document.getElementById('mapSvgWrap');
    if (!wrap) return;

    // Create and inject SVG
    const svg = buildSVG();
    wrap.innerHTML = '';
    wrap.appendChild(svg);

    // Load geometry
    try {
      const resp = await fetch('prototypes/india-map/geo/india-states.geojson');
      if (resp.ok) {
        geoData = await resp.json();
      }
    } catch (e) {
      console.error('[map] geometry load failed:', e);
    }

    // Load data
    if (window.IndiaMapData) {
      await IndiaMapData.load();
    }

    // Render
    const data = getData();
    renderNationalMap(data);

    // Wire controls
    const mapBackBtn = document.getElementById('mapBackBtn');
    if (mapBackBtn) {
      mapBackBtn.addEventListener('click', () => {
        if (viewMode === 'state' || viewMode === 'district') {
          resetToNational();
        }
      });
    }

    const backBtn = document.getElementById('btn-back');
    if (backBtn) {
      backBtn.hidden = true;
      backBtn.addEventListener('click', goBack);
    }

    const closeModalBtn = document.getElementById('closeModal');
    if (closeModalBtn) closeModalBtn.addEventListener('click', closeModal);

    const modal = document.getElementById('modal');
    if (modal) {
      modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    }

    // Zoom
    document.getElementById('zoomInBtn')?.addEventListener('click', zoomIn);
    document.getElementById('zoomOutBtn')?.addEventListener('click', zoomOut);
    document.getElementById('zoomResetBtn')?.addEventListener('click', zoomReset);

    // Filters
    document.querySelectorAll('.map-filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.map-filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        applyFilter(btn.dataset.filter);
      });
    });

    // Resize
    window.addEventListener('resize', () => {
      const canvas = document.getElementById('particleCanvas');
      if (canvas) { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
    });
  };
})();
