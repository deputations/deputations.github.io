// js/app.js — AllDeputations India Map Prototype
// Main application: rendering, navigation, filters, tooltips

import { init as initProvider, setFilter, clearFilters, getFilters, getData,
         getListingsForState, getListingsForDistrict } from './map-provider.js';
import { STATE_ABBR, ABBR_TO_NAME, STATE_LIST, DISTRICT_GEOJSON_TO_FIXTURE, fixtureDistrictToGeoJSON } from './state-geo.js';
import { EXCHANGES, FILTERS } from '../fixtures/mock-data.js';

// ====== DOM REFERENCES ======
const mapSvg = document.getElementById('india-map');
const mapContainer = document.getElementById('map-container');
const tooltip = document.getElementById('tooltip');
const tooltipName = document.getElementById('tooltip-name');
const tooltipCount = document.getElementById('tooltip-count');
const summaryTitle = document.getElementById('summary-title');
const summaryCount = document.getElementById('summary-count');
const appliedFilters = document.getElementById('applied-filters');
const filterChips = document.getElementById('filter-chips');
const btnClearAll = document.getElementById('btn-clear-all');
const btnFilter = document.getElementById('btn-filter');
const btnBack = document.getElementById('btn-back');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const resultsPanel = document.getElementById('results-panel');
const resultsTitle = document.getElementById('results-title');
const resultsBreadcrumb = document.getElementById('results-breadcrumb');
const resultsList = document.getElementById('results-list');
const sheetOverlay = document.getElementById('sheet-overlay');
const btnCloseResults = document.getElementById('btn-close-results');
const filterOverlay = document.getElementById('filter-overlay');
const filterDrawer = document.getElementById('filter-drawer');
const filterBody = document.getElementById('filter-body');
const btnCloseFilter = document.getElementById('btn-close-filter');
const rightRail = document.querySelector('.ad-right-rail');

// ====== STATE ======
let view = 'national';
let selectedState = null;
let selectedDistrict = null;
let geoData = null;
let currentProjection = null;
let currentGeneration = 0;

// Zoom state (incremental, animated)
let zoomLevel = 1.0;
let targetZoomLevel = 1.0;
let zoomAnimFrame = null;
const ZOOM_MIN = 0.5, ZOOM_MAX = 8.0, ZOOM_STEP = 1.3;

// ====== PROJECTION ======
// Equirectangular projection fitting features to SVG viewBox "0 0 1000 800"

function computeProjection(features) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  features.forEach(f => {
    if (!f.geometry) return;
    const coords = flattenCoords(f.geometry);
    coords.forEach(([lon, lat]) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  });

  if (!isFinite(minLon)) {
    minLon = 68.0; maxLon = 97.0; minLat = 6.0; maxLat = 36.0;
  }

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
  return [
    (lon - p.minLon) * p.scale + p.offsetX,
    p.offsetY - (lat - p.minLat) * p.scale
  ];
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

function getValidRings(geom) {
  if (geom.type === 'Polygon') return geom.coordinates.filter(hasRealExtent);
  if (geom.type === 'MultiPolygon') {
    const rings = [];
    geom.coordinates.forEach(poly => poly.forEach(r => { if (hasRealExtent(r)) rings.push(r); }));
    return rings;
  }
  return [];
}

function projectCoords(geom) {
  if (!geom) return '';
  return getValidRings(geom).map(projectRing).join(' ');
}

function projectRing(ring) {
  const pts = ring.map(([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (pts.length < 2) return `M ${pts[0] || '0,0'}`;
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')}`;
}

function ringExtent(ring) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const c of ring) {
    if (c[0] < minLon) minLon = c[0];
    if (c[0] > maxLon) maxLon = c[0];
    if (c[1] < minLat) minLat = c[1];
    if (c[1] > maxLat) maxLat = c[1];
  }
  return { minLon, maxLon, minLat, maxLat, rangeLon: maxLon - minLon, rangeLat: maxLat - minLat };
}

function hasRealExtent(ring) {
  const ext = ringExtent(ring);
  return ext.rangeLon > 0.01 && ext.rangeLat > 0.01;
}

function centroid(geom) {
  const pts = flattenCoords(geom);
  if (pts.length === 0) return [0, 0];
  let sumLon = 0, sumLat = 0;
  pts.forEach(([lon, lat]) => { sumLon += lon; sumLat += lat; });
  return [sumLon / pts.length, sumLat / pts.length];
}

// ====== RENDERING ======
let _shapeId = 0;
function nextShapeId() { return `shape-${++_shapeId}`; }

function clearMap() {
  while (mapSvg.firstChild) mapSvg.removeChild(mapSvg.firstChild);
  _shapeId = 0;
}

function renderNationalMap(data) {
  clearMap();

  computeProjection(geoData.features);
  applyZoomTransform();

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'map-group';
  mapSvg.appendChild(g);

  geoData.features.forEach((feat, idx) => {
    const name = feat.properties.NAME_1;
    const abbr = STATE_ABBR[name] || null;
    if (!abbr) return;

    const d = projectCoords(feat.geometry);
    if (!d) return;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `${d} Z`);
    path.setAttribute('id', nextShapeId());
    path.setAttribute('class', 'ad-state');
    path.setAttribute('data-abbr', abbr);
    path.setAttribute('data-name', name);
    path.setAttribute('role', 'button');
    path.setAttribute('tabindex', '0');
    path.setAttribute('aria-label', `${name}: ${data.stateCounts[abbr] || 0} jobs`);

    const count = data.stateCounts[abbr] || 0;
    if (count === 0) path.classList.add('zero');

    path.addEventListener('mouseenter', e => showTooltip(e, name, count));
    path.addEventListener('mousemove', moveTooltip);
    path.addEventListener('mouseleave', hideTooltip);
    path.addEventListener('focus', e => showTooltip(e, name, count));
    path.addEventListener('blur', hideTooltip);
    path.addEventListener('click', () => drillToState(abbr, name));
    path.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drillToState(abbr, name); }
    });

    g.appendChild(path);

    const [clon, clat] = centroid(feat.geometry);
    const [cx, cy] = project(clon, clat);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', cx);
    label.setAttribute('y', cy - 5);
    label.setAttribute('class', 'ad-state-label');
    label.textContent = abbr;
    g.appendChild(label);

    if (count > 0) {
      const countEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      countEl.setAttribute('x', cx);
      countEl.setAttribute('y', cy + 9);
      countEl.setAttribute('class', 'ad-state-count');
      countEl.textContent = count;
      // Staggered pop-in: 30ms per shape, capped at 600ms
      countEl.style.animationDelay = `${Math.min(idx * 30, 600)}ms`;
      g.appendChild(countEl);
    }
  });

  updateSummary('All India Jobs', data.nationalCount);
}

function renderStateMap(stateAbbr, stateName, data) {
  loadDistrictGeometry(stateAbbr, stateName, data);
}

  async function loadDistrictGeometry(stateAbbr, stateName, data) {
  const myGeneration = ++currentGeneration;
  clearMap();

  // Show loading
  mapSvg.innerHTML = '';

  const districtFile = `districts/${stateAbbr}.geojson`;

  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    const resp = await fetch(districtFile);
    if (!resp.ok) throw new Error(`District geometry not available for ${stateName}`);
    const distData = await resp.json();

    if (myGeneration !== currentGeneration) return; // Stale — discard
    renderDistrictMap(distData, stateAbbr, stateName, data);
  } catch (err) {
    if (myGeneration !== currentGeneration) return;
    console.warn('District geometry unavailable:', err.message);
    showStateListView(stateAbbr, stateName, data);
  }
}

function renderDistrictMap(distData, stateAbbr, stateName, data) {
  computeProjection(distData.features);
  applyZoomTransform();

  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  g.id = 'map-group';
  mapSvg.appendChild(g);

  distData.features.forEach((feat, idx) => {
    const geoName = feat.properties.district;
    if (!geoName) return;

    const fixtureNames = DISTRICT_GEOJSON_TO_FIXTURE[stateAbbr]?.[geoName] || [geoName];
    const fixtureName = Array.isArray(fixtureNames) ? fixtureNames[0] : fixtureNames;

    // Sum counts from all fixture names that map to this GeoJSON feature
    let count = 0;
    const names = Array.isArray(fixtureNames) ? fixtureNames : [fixtureNames];
    for (const fn of names) {
      count += data.districtCounts[`${stateAbbr}::${fn}`] || 0;
    }

    const d = projectCoords(feat.geometry);
    if (!d) return;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('id', nextShapeId());
    path.setAttribute('class', 'ad-state');
    path.setAttribute('data-district', fixtureName);
    path.setAttribute('data-state', stateAbbr);
    path.setAttribute('role', 'button');
    path.setAttribute('tabindex', '0');
    path.setAttribute('aria-label', `${fixtureName}, ${stateName}: ${count} jobs`);

    if (count === 0) path.classList.add('zero');

    path.addEventListener('mouseenter', e => showTooltip(e, `${fixtureName}, ${stateName}`, count));
    path.addEventListener('mousemove', moveTooltip);
    path.addEventListener('mouseleave', hideTooltip);
    path.addEventListener('focus', e => showTooltip(e, `${fixtureName}, ${stateName}`, count));
    path.addEventListener('blur', hideTooltip);
    path.addEventListener('click', () => drillToDistrict(stateAbbr, fixtureName));
    path.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drillToDistrict(stateAbbr, fixtureName); }
    });

    g.appendChild(path);
  });

  // District labels and count badges (staggered)
  distData.features.forEach((feat, idx) => {
    const geoName = feat.properties.district;
    if (!geoName) return;

    const fixtureNames = DISTRICT_GEOJSON_TO_FIXTURE[stateAbbr]?.[geoName] || [geoName];
    const fixtureName = Array.isArray(fixtureNames) ? fixtureNames[0] : fixtureNames;

    let count = 0;
    const names = Array.isArray(fixtureNames) ? fixtureNames : [fixtureNames];
    for (const fn of names) {
      count += data.districtCounts[`${stateAbbr}::${fn}`] || 0;
    }

    let cLon = feat.properties.centroid_lon;
    let cLat = feat.properties.centroid_lat;
    if (cLon === undefined) {
      [cLon, cLat] = centroid(feat.geometry);
    }
    const [px, py] = project(cLon, cLat);

    // District name and count rendered side-by-side on the same baseline
    const labelText = fixtureName.length > 14 ? fixtureName.slice(0, 14) + '…' : fixtureName;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', count > 0 ? px - 4 : px);
    label.setAttribute('y', py);
    label.setAttribute('text-anchor', count > 0 ? 'end' : 'middle');
    label.setAttribute('class', 'ad-state-label');
    label.textContent = labelText;
    label.style.fontSize = '7px';
    g.appendChild(label);

    if (count > 0) {
      const countEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      countEl.setAttribute('x', px + 4);
      countEl.setAttribute('y', py);
      countEl.setAttribute('text-anchor', 'start');
      countEl.setAttribute('class', 'ad-state-count');
      countEl.textContent = count;
      countEl.style.fontSize = '7px';
      countEl.style.fill = '#f5a721';
      countEl.style.fontWeight = '600';
      // Staggered pop-in: 25ms per district, capped at 500ms
      countEl.style.animationDelay = `${Math.min(idx * 25, 500)}ms`;
      g.appendChild(countEl);
    }
  });

  updateSummary(`${stateName.toUpperCase()} JOBS`, data.stateCounts[stateAbbr] || 0);
  btnBack.hidden = false;
  view = 'state';
}

function showStateListView(stateAbbr, stateName, data, reason = 'District geometry not available') {
  clearMap();
  mapSvg.innerHTML = '';

  // Show "approximate geometry" banner in map area
  mapContainer.insertAdjacentHTML('afterbegin', `
    <div class="ad-geometry-notice" role="alert">
      <i class="ph-fill ph-warning-circle"></i>
      ${reason} — showing district list instead.
      <button onclick="this.parentElement.remove()" aria-label="Dismiss">&times;</button>
    </div>
  `);

  btnBack.hidden = false;
  view = 'state';

  // Build district breakdown list from data
  const districtEntries = Object.entries(data.districtCounts)
    .filter(([k]) => k.startsWith(`${stateAbbr}::`))
    .map(([k, count]) => {
      const dName = k.split('::')[1];
      return { name: dName, count };
    })
    .sort((a, b) => b.count - a.count);

  showResults({
    title: `${stateName} Jobs`,
    breadcrumb: [`<a href="#" data-nav="national">India</a> <span>›</span> ${stateName}`],
    listings: getListingsForState(stateAbbr),
    districtBreakdown: districtEntries
  });
}

// ====== NAVIGATION ======
function drillToState(abbr, name) {
  selectedState = abbr;
  selectedDistrict = null;
  view = 'state';

  const data = getData();
  renderStateMap(abbr, name, data);
  updateAppliedFilters();
  syncExchangeRail(data);
  history.pushState({ view: 'state', state: abbr }, '', `?state=${abbr}`);
}

function drillToDistrict(stateAbbr, districtName) {
  selectedDistrict = districtName;
  view = 'district';

  const data = getData();

  showResults({
    title: `${districtName} Jobs`,
    breadcrumb: [
      `<a href="#" data-nav="national">India</a> <span>›</span> `,
      `<a href="#" data-nav="state">${ABBR_TO_NAME[stateAbbr] || stateAbbr}</a> <span>›</span> ${districtName}`
    ],
    listings: getListingsForDistrict(stateAbbr, districtName)
  });

  document.querySelectorAll('.ad-state[data-district]').forEach(p => p.classList.remove('active'));
  const selected = document.querySelector(`.ad-state[data-district="${CSS.escape(districtName)}"]`);
  if (selected) selected.classList.add('active');

  updateAppliedFilters();
  syncExchangeRail(data);
  history.pushState(
    { view: 'district', state: stateAbbr, district: districtName },
    '', `?state=${stateAbbr}&district=${encodeURIComponent(districtName)}`
  );
}

function goBack() {
  history.back();
}

function goNational() {
  ++currentGeneration; // invalidate any in-flight geometry
  selectedState = null;
  selectedDistrict = null;
  view = 'national';
  closeResults();
  btnBack.hidden = true;
  renderNationalMap(getData());
  updateAppliedFilters();
  syncExchangeRail(getData());
  history.pushState({ view: 'national' }, '', window.location.pathname);
}

function updateMap(mode, stateAbbr, stateName, data) {
  if (mode === 'national') {
    renderNationalMap(data || getData());
  } else if (mode === 'state') {
    renderStateMap(stateAbbr, stateName, data);
  }
}

// ====== TOOLTIP ======
function showTooltip(event, name, count) {
  tooltipName.textContent = name;
  tooltipCount.textContent = count;
  tooltip.classList.add('visible');
  tooltip.setAttribute('aria-hidden', 'false');
  moveTooltip(event);
}

function moveTooltip(event) {
  const rect = mapSvg.getBoundingClientRect();
  let x = event.clientX - rect.left + 12;
  let y = event.clientY - rect.top - 12;

  const ttRect = tooltip.getBoundingClientRect();
  if (x + ttRect.width > window.innerWidth - 10) x = x - ttRect.width - 24;
  if (y + ttRect.height > window.innerHeight - 10) y = y - ttRect.height - 24;
  if (y < 10) y = 10;

  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

function hideTooltip() {
  tooltip.classList.remove('visible');
  tooltip.setAttribute('aria-hidden', 'true');
}

// ====== SUMMARY ======
function updateSummary(title, count) {
  summaryTitle.textContent = title;
  summaryCount.textContent = count !== undefined ? count : '—';
}

// ====== APPLIED FILTERS ======
function updateAppliedFilters() {
  const data = getData();
  const filters = getFilters();
  const chips = [];

  if (view === 'state' && selectedState) {
    chips.push({ label: ABBR_TO_NAME[selectedState] || selectedState, type: 'state' });
  }
  if (view === 'district' && selectedDistrict) {
    chips.push({ label: selectedDistrict, type: 'district' });
  }

  const defaultVals = { exchange: 'all', qualification: 'Any', experience: 'Any',
                         jobType: 'Any', jobTime: 'Any', jobShift: 'Any' };
  Object.entries(filters).forEach(([key, val]) => {
    if (val !== defaultVals[key]) {
      chips.push({ label: val, type: key });
    }
  });

  if (chips.length === 0) {
    appliedFilters.hidden = true;
    filterChips.innerHTML = '';
  } else {
    appliedFilters.hidden = false;
    filterChips.innerHTML = chips.map((c, i) =>
      `<span class="ad-filter-chip" style="animation-delay:${i * 60}ms">${c.label}<button data-chip="${c.type}" aria-label="Remove ${c.label}">×</button></span>`
    ).join('');
  }
}

function syncExchangeRail(data) {
  const filters = getFilters();
  const activeExchange = filters.exchange || 'all';
  rightRail.querySelectorAll('.exchange-btn').forEach(btn => {
    const isActive = btn.dataset.exchange === activeExchange;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

// ====== RESULTS PANEL ======
let sheetCloseTimer = null;

function showResults({ title, breadcrumb, listings: items, districtBreakdown = null }) {
  resultsTitle.textContent = title;
  resultsBreadcrumb.innerHTML = breadcrumb.join('');

  let cardsHTML = '';

  // District breakdown list (shown above result cards when available)
  if (districtBreakdown && districtBreakdown.length > 0) {
    const districtList = districtBreakdown.map(({ name, count }) => `
      <button class="ad-district-item" data-district="${name}" data-state="${selectedState || ''}"
              aria-label="View ${count} listings in ${name}">
        <span class="ad-district-name">${name}</span>
        <span class="ad-district-count">${count}</span>
      </button>
    `).join('');
    cardsHTML += `<div class="ad-district-list">${districtList}</div>`;
  }

  if (items.length === 0) {
    if (!districtBreakdown || districtBreakdown.length === 0) {
      cardsHTML += `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--ad-text-muted)">
        No listings found matching your criteria.</div>`;
    }
  } else {
    cardsHTML += items.map(item => `
      <article class="ad-result-card" tabindex="0" aria-label="${item.title}">
        <div class="ad-result-title">${item.title}</div>
        <div class="ad-result-meta">
          <span class="ad-result-tag">${item.qualification}</span>
          <span class="ad-result-tag">${item.experience}</span>
          <span class="ad-result-tag">${item.jobType}</span>
        </div>
        <div class="ad-result-meta" style="margin-top:4px">
          <span class="ad-result-tag"><i class="ph ph-map-pin"></i> ${item.city || item.district || item.state || 'Remote'}</span>
          <span class="ad-result-tag"><i class="ph ph-calendar"></i> Closes ${item.closingDate}</span>
        </div>
        <div class="ad-result-posts">${item.posts} post${item.posts > 1 ? 's' : ''}</div>
      </article>
    `).join('');
  }

  resultsList.innerHTML = cardsHTML;

  // Wire up district-item clicks
  resultsList.querySelectorAll('.ad-district-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const dName = btn.dataset.district;
      const sAbbr = btn.dataset.state;
      drillToDistrict(sAbbr, dName);
    });
  });

  // Clear geometry notice if present
  const notice = mapContainer.querySelector('.ad-geometry-notice');
  if (notice) notice.remove();

  resultsPanel.hidden = false;
  sheetOverlay.hidden = false;
  clearTimeout(sheetCloseTimer);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resultsPanel.classList.add('open');
      sheetOverlay.classList.add('open');
    });
  });

  resultsBreadcrumb.querySelectorAll('[data-nav]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      if (link.dataset.nav === 'national') goNational();
      else if (link.dataset.nav === 'state') goBack();
    });
    link.style.color = 'var(--ad-accent)';
    link.style.cursor = 'pointer';
    link.style.textDecoration = 'underline';
  });
}

function closeResults() {
  resultsPanel.classList.remove('open');
  sheetOverlay.classList.remove('open');
  clearTimeout(sheetCloseTimer);
  sheetCloseTimer = setTimeout(() => {
    resultsPanel.hidden = true;
    sheetOverlay.hidden = true;
  }, 320);
}

// ====== FILTER DRAWER ======
function buildFilterDrawer() {
  const filters = [
    { key: 'qualification', label: 'MINIMUM QUALIFICATION', icon: 'ph-graduation-cap', options: FILTERS.qualification },
    { key: 'experience', label: 'EXPERIENCE RANGE', icon: 'ph-clock', options: FILTERS.experience },
    { key: 'jobType', label: 'JOB TYPE', icon: 'ph-briefcase', options: FILTERS.jobType },
    { key: 'jobTime', label: 'JOB TIME', icon: 'ph-sun', options: FILTERS.jobTime },
    { key: 'jobShift', label: 'JOB SHIFT', icon: 'ph-gear', options: FILTERS.jobShift }
  ];

  filterBody.innerHTML = filters.map(f => `
    <div class="filter-group">
      <label class="filter-group-label" for="filter-${f.key}">
        <i class="ph ${f.icon}"></i> ${f.label}
      </label>
      <select class="filter-select" id="filter-${f.key}" data-filter-key="${f.key}">
        ${f.options.map(o => `<option value="${o}">${o}</option>`).join('')}
      </select>
    </div>
  `).join('');

  filterBody.querySelectorAll('.filter-select').forEach(sel => {
    sel.addEventListener('change', () => {
      setFilter(sel.dataset.filterKey, sel.value);
      refreshAfterFilter();
    });
  });
}

function refreshAfterFilter() {
  const data = getData();

  if (view === 'district' && selectedDistrict) {
    showResults({
      title: `${selectedDistrict} Jobs`,
      breadcrumb: [
        `<a href="#" data-nav="national">India</a> <span>›</span> `,
        `<a href="#" data-nav="state">${ABBR_TO_NAME[selectedState] || selectedState}</a> <span>›</span> ${selectedDistrict}`
      ],
      listings: getListingsForDistrict(selectedState, selectedDistrict)
    });
  } else if (view === 'national') {
    renderNationalMap(data);
  } else if (view === 'state' && selectedState) {
    renderStateMap(selectedState, ABBR_TO_NAME[selectedState], data);
  }

  updateAppliedFilters();
  syncExchangeRail(data);
}

function openFilterDrawer() {
  filterDrawer.hidden = false;
  filterOverlay.hidden = false;
  requestAnimationFrame(() => filterDrawer.classList.add('open'));
  btnFilter.setAttribute('aria-expanded', 'true');
  const filters = getFilters();
  Object.entries(filters).forEach(([key, val]) => {
    const sel = document.getElementById(`filter-${key}`);
    if (sel) sel.value = val;
  });
}

function closeFilterDrawer() {
  filterDrawer.classList.remove('open');
  filterOverlay.hidden = true;
  btnFilter.setAttribute('aria-expanded', 'false');
  setTimeout(() => { if (!filterDrawer.classList.contains('open')) filterDrawer.hidden = true; }, 250);
}

// ====== EXCHANGE RAIL ======
function buildExchangeRail() {
  rightRail.innerHTML = EXCHANGES.map(ex => `
    <button class="exchange-btn ${ex.id === 'all' ? 'active' : ''}"
            data-exchange="${ex.id}"
            ${!ex.available ? 'disabled title="Prototype — not yet implemented"' : ''}
            aria-pressed="${ex.id === 'all'}">
      <i class="ph ph-${ex.icon}" style="font-size:16px;display:block"></i>
      ${ex.label}
    </button>
  `).join('');

  rightRail.querySelectorAll('.exchange-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setFilter('exchange', btn.dataset.exchange);
      refreshAfterFilter();
    });
  });
}

// ====== ZOOM (incremental, animated) ======
function applyZoomTransform(level = zoomLevel) {
  const mapGroup = document.getElementById('map-group');
  if (!mapGroup) return;
  if (level === 1.0) {
    mapGroup.removeAttribute('transform');
    return;
  }
  const t = `translate(500,400) scale(${level}) translate(-500,-400)`;
  mapGroup.setAttribute('transform', t);
}

function animateZoom() {
  const diff = targetZoomLevel - zoomLevel;
  if (Math.abs(diff) < 0.001) {
    zoomLevel = targetZoomLevel;
    applyZoomTransform(zoomLevel);
    zoomAnimFrame = null;
    return;
  }
  zoomLevel += diff * 0.4; // smooth ease-out, converges in ~12 frames (~200ms)
  applyZoomTransform(zoomLevel);
  zoomAnimFrame = requestAnimationFrame(animateZoom);
}

function setZoom(newLevel) {
  targetZoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newLevel));
  if (zoomAnimFrame) cancelAnimationFrame(zoomAnimFrame);
  zoomAnimFrame = requestAnimationFrame(animateZoom);
}

// ====== EVENT WIRING ======
function wireEvents() {
  btnFilter.addEventListener('click', openFilterDrawer);
  btnCloseFilter.addEventListener('click', closeFilterDrawer);
  filterOverlay.addEventListener('click', closeFilterDrawer);

  btnClearAll.addEventListener('click', () => {
    clearFilters();
    buildFilterDrawer();
    setZoom(1.0);

    if (view !== 'national') {
      goNational();
    } else {
      refreshAfterFilter();
    }
  });

  filterChips.addEventListener('click', e => {
    const btn = e.target.closest('button[data-chip]');
    if (!btn) return;
    const chipType = btn.dataset.chip;
    if (chipType === 'state') {
      goNational();
    } else if (chipType === 'district') {
      goBack();
    } else if (chipType === 'exchange') {
      setFilter('exchange', 'all');
      const sel = document.getElementById('filter-exchange');
      if (sel) sel.value = 'all';
      refreshAfterFilter();
    } else {
      setFilter(chipType, 'Any');
      const sel = document.getElementById(`filter-${chipType}`);
      if (sel) sel.value = 'Any';
      refreshAfterFilter();
    }
  }, true); // capture phase so it works even when drawer overlay is on top

  btnBack.addEventListener('click', goBack);
  btnCloseResults.addEventListener('click', closeResults);

  btnZoomIn.addEventListener('click', () => setZoom(zoomLevel * ZOOM_STEP));
  btnZoomOut.addEventListener('click', () => setZoom(zoomLevel / ZOOM_STEP));
  btnZoomReset.addEventListener('click', () => {
    setZoom(1.0);
    panX = 0; panY = 0;
    applyPan();
  });

  let isDragging = false;
  let dragStart = { x: 0, y: 0 };
  let panX = 0, panY = 0;

  function applyPan() {
    const container = document.getElementById('map-container');
    if (container) {
      container.dataset.pan = `${panX},${panY}`;
      container.style.transform = `translate(${panX}px, ${panY}px)`;
    }
  }

  mapSvg.addEventListener('mousedown', e => {
    isDragging = true;
    dragStart = { x: e.clientX - panX, y: e.clientY - panY };
    mapSvg.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    panX = e.clientX - dragStart.x;
    panY = e.clientY - dragStart.y;
    applyPan();
  });

  window.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    mapSvg.style.cursor = '';
  });

  let touchStart = null;
  mapSvg.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      touchStart = { x: e.touches[0].clientX - panX, y: e.touches[0].clientY - panY };
    }
  }, { passive: true });

  mapSvg.addEventListener('touchmove', e => {
    if (!touchStart || e.touches.length !== 1) return;
    panX = e.touches[0].clientX - touchStart.x;
    panY = e.touches[0].clientY - touchStart.y;
    applyPan();
  }, { passive: true });

  mapSvg.addEventListener('touchend', () => { touchStart = null; });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!filterDrawer.hidden && filterDrawer.classList.contains('open')) closeFilterDrawer();
      if (!resultsPanel.hidden || resultsPanel.classList.contains('open')) closeResults();
    }
  });

  sheetOverlay.addEventListener('click', () => closeResults());

  window.addEventListener('popstate', e => {
    const state = e.state;
    if (!state || !state.view) return;

    if (state.view === 'national') {
      selectedState = null;
      selectedDistrict = null;
      view = 'national';
      closeResults();
      btnBack.hidden = true;
      renderNationalMap(getData());
      updateAppliedFilters();
      syncExchangeRail(getData());
    } else if (state.view === 'state') {
      selectedState = state.state;
      selectedDistrict = null;
      view = 'state';
      closeResults();
      renderStateMap(selectedState, ABBR_TO_NAME[selectedState], getData());
      updateAppliedFilters();
      syncExchangeRail(getData());
      btnBack.hidden = false;
    } else if (state.view === 'district') {
      selectedState = state.state;
      selectedDistrict = state.district;
      view = 'district';
      closeResults();
      renderStateMap(selectedState, ABBR_TO_NAME[selectedState], getData());
      setTimeout(() => {
        showResults({
          title: `${state.district} Jobs`,
          breadcrumb: [
            `<a href="#" data-nav="national">India</a> <span>›</span> `,
            `<a href="#" data-nav="state">${ABBR_TO_NAME[state.state] || state.state}</a> <span>›</span> ${state.district}`
          ],
          listings: getListingsForDistrict(state.state, state.district)
        });
        document.querySelectorAll('.ad-state[data-district]').forEach(p => p.classList.remove('active'));
        const sel = document.querySelector(`.ad-state[data-district="${CSS.escape(state.district)}"]`);
        if (sel) sel.classList.add('active');
      }, 100);
      updateAppliedFilters();
      syncExchangeRail(getData());
      btnBack.hidden = false;
    }
  });

  document.getElementById('btn-login').addEventListener('click', () => {
    alert('Login is unavailable in this local prototype.');
  });
  document.getElementById('btn-menu').addEventListener('click', () => {
    alert('Menu is unavailable in this local prototype.');
  });
}

// ====== URL RESTORATION ON STARTUP ======
function restoreFromURL() {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  const district = params.get('district');

  if (state && (STATE_ABBR[state] || ABBR_TO_NAME[state])) {
    const abbr = STATE_ABBR[state] || state;
    selectedState = abbr;
    if (district) {
      selectedDistrict = decodeURIComponent(district);
      view = 'district';
      btnBack.hidden = false;
      const data = getData();
      renderStateMap(abbr, ABBR_TO_NAME[abbr], data);
      setTimeout(() => {
        showResults({
          title: `${selectedDistrict} Jobs`,
          breadcrumb: [
            `<a href="#" data-nav="national">India</a> <span>›</span> `,
            `<a href="#" data-nav="state">${ABBR_TO_NAME[abbr] || abbr}</a> <span>›</span> ${selectedDistrict}`
          ],
          listings: getListingsForDistrict(abbr, selectedDistrict)
        });
        const sel = document.querySelector(`.ad-state[data-district="${CSS.escape(selectedDistrict)}"]`);
        if (sel) sel.classList.add('active');
      }, 100);
      updateAppliedFilters();
      syncExchangeRail(data);
      history.replaceState({ view: 'district', state: abbr, district: selectedDistrict }, '', window.location.href);
    } else {
      view = 'state';
      btnBack.hidden = false;
      renderStateMap(abbr, ABBR_TO_NAME[abbr], getData());
      updateAppliedFilters();
      syncExchangeRail(getData());
      history.replaceState({ view: 'state', state: abbr }, '', window.location.href);
    }
    return true;
  }
  return false;
}

// ====== START ======
async function start() {
  const params = new URLSearchParams(window.location.search);
  const scenario = params.get('scenario') === 'empty' ? 'empty' : 'populated';

  try {
    const resp = await fetch('geo/india-states.geojson');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    geoData = await resp.json();
  } catch (err) {
    console.error('Failed to load geometry:', err);
    mapSvg.innerHTML = `<text x="500" y="400" text-anchor="middle" fill="#f5a721" font-size="16">
      Error loading map geometry: ${err.message}</text>`;
    return;
  }

  initProvider(scenario);
  buildFilterDrawer();
  buildExchangeRail();

  const restored = restoreFromURL();
  if (!restored) {
    renderNationalMap(getData());
    history.replaceState({ view: 'national' }, '', window.location.pathname);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  start().catch(err => {
    console.error('Prototype startup failed:', err);
    mapSvg.innerHTML = `<text x="500" y="400" text-anchor="middle" fill="#f5a721" font-size="16">
      Failed to start: ${err.message}</text>`;
  });
});
