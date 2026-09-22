// js/app.js — AllDeputations India Map Prototype
// Main application: rendering, navigation, zoom, filters, tooltips

import { init as initProvider, setFilter, clearFilters, getFilters, getData,
         getListingsForState, getListingsForDistrict, getFunctionCounts } from './map-provider.js';
import { STATE_ABBR, ABBR_TO_NAME, STATE_LIST } from './state-geo.js';
import { EXCHANGES, FILTERS } from '../fixtures/mock-data.js';

// ====== DOM REFERENCES ======
const mapSvg = document.getElementById('india-map');
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
const btnCloseResults = document.getElementById('btn-close-results');
const filterOverlay = document.getElementById('filter-overlay');
const filterDrawer = document.getElementById('filter-drawer');
const filterBody = document.getElementById('filter-body');
const btnCloseFilter = document.getElementById('btn-close-filter');
const rightRail = document.querySelector('.ad-right-rail');

// ====== NAVIGATION STATE ======
let view = 'national';     // 'national' | 'state' | 'district'
let selectedState = null;  // state abbreviation
let selectedDistrict = null;
let zoomLevel = 1;
let panX = 0, panY = 0;
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let geoData = null;
let statePaths = {};       // abbr -> SVG path element

// ====== INITIALIZATION ======
async function start() {
  // Load geometry
  try {
    const resp = await fetch('geo/india-states.geojson');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    geoData = await resp.json();
  } catch (err) {
    console.error('Failed to load geometry:', err);
    mapSvg.innerHTML = `<text x="500" y="500" text-anchor="middle" fill="#f5a721" font-size="16">
      Error loading map geometry: ${err.message}</text>`;
    return;
  }

  // Init data provider
  initProvider('populated');

  // Build static UI
  buildFilterDrawer();
  buildExchangeRail();
  updateMap('national');

  // History state
  history.replaceState({ view: 'national' }, '', window.location.pathname);
}

// ====== PROJECTION ======
// Simple equirectangular projection fitting GeoJSON bounds to SVG viewBox
let projBounds = null;

function computeProjection() {
  if (!geoData) return;

  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;

  geoData.features.forEach(f => {
    if (!f.geometry) return;
    const coords = flattenCoords(f.geometry);
    coords.forEach(([lon, lat]) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  });

  const padding = 0.08;
  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;

  // Fit in 900x900 within 1000x1000 viewBox, centered
  const mapW = 900, mapH = 900;
  const scale = Math.min(mapW / lonRange, mapH / latRange);
  const cx = 500, cy = 500;
  const offsetX = cx - (lonRange * scale) / 2;
  const offsetY = cy + (latRange * scale) / 2; // SVG y is inverted

  projBounds = { minLon, maxLon, minLat, maxLat, scale, offsetX, offsetY };
}

function flattenCoords(geom) {
  const result = [];
  if (geom.type === 'Polygon') {
    const valid = geom.coordinates.filter(r => hasRealExtent(r));
    valid.forEach(ring => ring.forEach(c => result.push(c)));
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates.forEach(poly => {
      const valid = poly.filter(r => hasRealExtent(r));
      valid.forEach(ring => ring.forEach(c => result.push(c)));
    });
  }
  return result;
}

function getValidRings(geom) {
  if (geom.type === 'Polygon') {
    return geom.coordinates.filter(r => hasRealExtent(r));
  } else if (geom.type === 'MultiPolygon') {
    const rings = [];
    geom.coordinates.forEach(poly => {
      poly.forEach(r => { if (hasRealExtent(r)) rings.push(r); });
    });
    return rings;
  }
  return [];
}

function projectCoords(geom) {
  if (!geom) return '';
  const rings = getValidRings(geom);
  if (rings.length === 0) return '';
  return rings.map(ring => projectRing(ring)).join(' ');
}

function project(lon, lat) {
  if (!projBounds) return [0, 0];
  const x = (lon - projBounds.minLon) * projBounds.scale + projBounds.offsetX;
  const y = projBounds.offsetY - (lat - projBounds.minLat) * projBounds.scale;
  return [x, y];
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

function projectRing(ring) {
  const pts = ring.map(([lon, lat]) => {
    const [x, y] = project(lon, lat);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  if (pts.length < 2) return `M ${pts[0] || '0,0'}`;
  return `M ${pts[0]} L ${pts.slice(1).join(' L ')}`;
}

function centroid(geom) {
  const pts = flattenCoords(geom);
  let sumLon = 0, sumLat = 0;
  pts.forEach(([lon, lat]) => { sumLon += lon; sumLat += lat; });
  return [sumLon / pts.length, sumLat / pts.length];
}

// ====== RENDERING ======
function renderNationalMap(data) {
  computeProjection();
  const g = createSvgGroup('map-group');
  mapSvg.appendChild(g);

  // State paths
  geoData.features.forEach(feat => {
    const name = feat.properties.NAME_1;
    const abbr = STATE_ABBR[name] || null;
    if (!abbr) return;

    const d = projectCoords(feat.geometry);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `${d} Z`);
    path.setAttribute('class', 'ad-state');
    path.setAttribute('data-abbr', abbr);
    path.setAttribute('data-name', name);
    path.setAttribute('role', 'button');
    path.setAttribute('tabindex', '0');
    path.setAttribute('aria-label', `${name}: ${data.stateCounts[abbr] || 0} jobs`);

    const count = data.stateCounts[abbr] || 0;
    if (count === 0) path.classList.add('zero');

    // Interactions
    path.addEventListener('mouseenter', e => showTooltip(e, name, count));
    path.addEventListener('mousemove', moveTooltip);
    path.addEventListener('mouseleave', hideTooltip);
    path.addEventListener('focus', e => showTooltip(e, name, count));
    path.addEventListener('blur', hideTooltip);
    path.addEventListener('click', () => drillToState(abbr, name));
    path.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        drillToState(abbr, name);
      }
    });

    g.appendChild(path);
    statePaths[abbr] = path;

    // Labels
    const [clon, clat] = centroid(feat.geometry);
    const [cx, cy] = project(clon, clat);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', cx);
    label.setAttribute('y', cy - 4);
    label.setAttribute('class', 'ad-state-label');
    label.textContent = abbr;
    g.appendChild(label);

    const countEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    countEl.setAttribute('x', cx);
    countEl.setAttribute('y', cy + 8);
    countEl.setAttribute('class', 'ad-state-count');
    countEl.textContent = count;
    g.appendChild(countEl);
  });

  updateSummary('All India Jobs', data.nationalCount);
}

function renderStateMap(stateAbbr, stateName, data) {
  // For district view, we need district geometry. We'll load it on demand.
  loadDistrictGeometry(stateAbbr, stateName, data);
}

async function loadDistrictGeometry(stateAbbr, stateName, data) {
  const districtFile = `districts/${stateAbbr}.geojson`;

  try {
    const resp = await fetch(districtFile);
    if (!resp.ok) throw new Error(`District geometry not available for ${stateName}`);

    const distData = await resp.json();
    renderDistrictMap(distData, stateAbbr, stateName, data);
  } catch (err) {
    // Fallback: show state detail view with listing cards
    console.warn('District geometry unavailable, showing state listing:', err.message);
    showStateListView(stateAbbr, stateName, data);
  }
}

function renderDistrictMap(distData, stateAbbr, stateName, data) {
  clearMap();

  const g = createSvgGroup('map-group');
  mapSvg.appendChild(g);

  // Compute projection for district data
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  distData.features.forEach(f => {
    if (!f.geometry) return;
    const coords = flattenCoords(f.geometry);
    coords.forEach(([lon, lat]) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  });

  const lonRange = maxLon - minLon || 1;
  const latRange = maxLat - minLat || 1;
  const scale = Math.min(900 / lonRange, 900 / latRange);
  const cx = 500, cy = 500;
  const offsetX = cx - (lonRange * scale) / 2;
  const offsetY = cy + (latRange * scale) / 2;

  // Store for district click
  const districtProjection = { minLon, maxLon, minLat, maxLat, scale, offsetX, offsetY };

  const projPt = (lon, lat) => [
    (lon - minLon) * scale + offsetX,
    offsetY - (lat - minLat) * scale
  ];

  function projRing(ring) {
    const pts = ring.map(([lon, lat]) => {
      const [x, y] = projPt(lon, lat);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    if (pts.length < 2) return `M ${pts[0] || '0,0'}`;
    return `M ${pts[0]} L ${pts.slice(1).join(' L ')}`;
  }

  statePaths = {};

  distData.features.forEach(feat => {
    const distName = feat.properties.district || feat.properties.NAME_2 || feat.properties.name || 'Unknown';
    const count = data.districtCounts[`${stateAbbr}::${distName}`] || 0;

    let d = '';
    if (feat.geometry.type === 'Polygon') {
      d += `${projRing(feat.geometry.coordinates[0])} Z`;
      for (let i = 1; i < feat.geometry.coordinates.length; i++) {
        d += ` M ${projRing(feat.geometry.coordinates[i])} Z`;
      }
    } else if (feat.geometry.type === 'MultiPolygon') {
      feat.geometry.coordinates.forEach(poly => {
        d += ` M ${projRing(poly[0])} Z`;
        for (let i = 1; i < poly.length; i++) {
          d += ` M ${projRing(poly[i])} Z`;
        }
      });
    }

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('class', 'ad-state');
    path.setAttribute('data-district', distName);
    path.setAttribute('data-state', stateAbbr);
    path.setAttribute('role', 'button');
    path.setAttribute('tabindex', '0');
    path.setAttribute('aria-label', `${distName}, ${stateName}: ${count} jobs`);

    if (count === 0) path.classList.add('zero');

    path.addEventListener('mouseenter', e => showTooltip(e, `${distName}, ${stateName}`, count));
    path.addEventListener('mousemove', moveTooltip);
    path.addEventListener('mouseleave', hideTooltip);
    path.addEventListener('focus', e => showTooltip(e, `${distName}, ${stateName}`, count));
    path.addEventListener('blur', hideTooltip);
    path.addEventListener('click', () => drillToDistrict(stateAbbr, distName, data));
    path.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        drillToDistrict(stateAbbr, distName, data);
      }
    });

    g.appendChild(path);
  });

  // District labels (centroids)
  distData.features.forEach(feat => {
    const distName = feat.properties.district || feat.properties.NAME_2 || feat.properties.name || 'Unknown';
    let cLon, cLat;
    if (feat.properties.centroid_lon !== undefined) {
      cLon = feat.properties.centroid_lon;
      cLat = feat.properties.centroid_lat;
    } else {
      const pts = flattenCoords(feat.geometry);
      cLon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      cLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    }
    const [cx, cy] = projPt(cLon, cLat);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', cx);
    label.setAttribute('y', cy);
    label.setAttribute('class', 'ad-state-label');
    label.textContent = distName.length > 12 ? distName.slice(0, 12) + '…' : distName;
    label.style.fontSize = '7px';
    g.appendChild(label);
  });

  updateSummary(`${stateName.toUpperCase()} JOBS`, data.stateCounts[stateAbbr] || 0);
  btnBack.hidden = false;
  view = 'state';
}

// Fallback when district geometry not available — show listing cards
function showStateListView(stateAbbr, stateName, data) {
  clearMap();
  mapSvg.innerHTML = `<text x="500" y="500" text-anchor="middle" fill="#8b92a5" font-size="14">
    District geometry not yet available for ${stateName}. Showing listings below.</text>`;

  btnBack.hidden = false;
  view = 'state';

  showResults({
    title: `${stateName} Jobs`,
    breadcrumb: [`<a href="#" data-nav="national">India</a> <span>›</span> ${stateName}`],
    listings: getListingsForState(stateAbbr)
  });
}

// ====== NAVIGATION ======
function drillToState(abbr, name) {
  selectedState = abbr;
  selectedDistrict = null;
  view = 'state';

  const data = getData();
  updateMap('state', abbr, name, data);

  // Update applied filters
  updateAppliedFilters();
  history.pushState({ view: 'state', state: abbr }, '', `?state=${abbr}`);
}

function drillToDistrict(stateAbbr, districtName, data) {
  selectedDistrict = districtName;
  view = 'district';

  showResults({
    title: `${districtName} Jobs`,
    breadcrumb: [
      `<a href="#" data-nav="national">India</a> <span>›</span> `,
      `<a href="#" data-nav="state">${ABBR_TO_NAME[stateAbbr] || stateAbbr}</a> <span>›</span> ${districtName}`
    ],
    listings: getListingsForDistrict(stateAbbr, districtName)
  });

  // Highlight selected district in map
  document.querySelectorAll('.ad-state[data-district]').forEach(p => p.classList.remove('active'));
  const selected = document.querySelector(`.ad-state[data-district="${CSS.escape(districtName)}"]`);
  if (selected) selected.classList.add('active');

  updateAppliedFilters();
  history.pushState(
    { view: 'district', state: stateAbbr, district: districtName },
    '', `?state=${stateAbbr}&district=${encodeURIComponent(districtName)}`
  );
}

function goBack() {
  if (view === 'district') {
    // Go back to state view
    selectedDistrict = null;
    view = 'state';
    closeResults();
    updateMap('state', selectedState, ABBR_TO_NAME[selectedState], getData());
    updateAppliedFilters();
    history.pushState({ view: 'state', state: selectedState }, '', `?state=${selectedState}`);
  } else if (view === 'state') {
    goNational();
  }
}

function goNational() {
  selectedState = null;
  selectedDistrict = null;
  view = 'national';
  closeResults();
  btnBack.hidden = true;
  updateMap('national');
  updateAppliedFilters();
  history.pushState({ view: 'national' }, '', window.location.pathname);
}

function updateMap(mode, stateAbbr, stateName, data) {
  if (mode === 'national') {
    renderNationalMap(data || getData());
  } else if (mode === 'state') {
    renderStateMap(stateAbbr, stateName, data);
  }
}

// ====== MAP HELPERS ======
function clearMap() {
  // Remove all SVG children except tooltip-related (tooltip is outside SVG)
  while (mapSvg.firstChild) {
    mapSvg.removeChild(mapSvg.firstChild);
  }
  statePaths = {};
}

function createSvgGroup(id) {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  if (id) g.id = id;
  return g;
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

  // Keep within viewport
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

  // Geography chips
  if (view === 'state' && selectedState) {
    chips.push({ label: ABBR_TO_NAME[selectedState] || selectedState, type: 'state' });
  }
  if (view === 'district' && selectedDistrict) {
    chips.push({ label: selectedDistrict, type: 'district' });
  }

  // Filter chips
  Object.entries(filters).forEach(([key, val]) => {
    if (val && val !== 'all' && val !== 'Any') {
      chips.push({ label: val, type: key });
    }
  });

  if (chips.length === 0) {
    appliedFilters.hidden = true;
  } else {
    appliedFilters.hidden = false;
    filterChips.innerHTML = chips.map(c =>
      `<span class="ad-filter-chip">${c.label}<button data-chip="${c.type}" aria-label="Remove ${c.label}">×</button></span>`
    ).join('');
  }
}

// ====== RESULTS PANEL ======
function showResults({ title, breadcrumb, listings: items }) {
  resultsTitle.textContent = title;
  resultsBreadcrumb.innerHTML = breadcrumb.join('');

  if (items.length === 0) {
    resultsList.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--ad-text-muted)">
      No listings found matching your criteria.</div>`;
  } else {
    resultsList.innerHTML = items.map(item => `
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

  resultsPanel.hidden = false;

  // Wire breadcrumb links
  resultsBreadcrumb.querySelectorAll('[data-nav]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const nav = link.dataset.nav;
      if (nav === 'national') goNational();
      else if (nav === 'state') goBack();
    });
    link.style.color = 'var(--ad-accent)';
    link.style.cursor = 'pointer';
    link.style.textDecoration = 'underline';
  });
}

function closeResults() {
  resultsPanel.hidden = true;
  resultsList.innerHTML = '';
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

  // Wire change events
  filterBody.querySelectorAll('.filter-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.filterKey;
      const val = sel.value;
      setFilter(key, val);
      refreshAfterFilter();
    });
  });
}

function refreshAfterFilter() {
  const data = getData();
  if (view === 'national') {
    updateMap('national');
  } else if (view === 'state' && selectedState) {
    updateMap('state', selectedState, ABBR_TO_NAME[selectedState], data);
  }
  updateAppliedFilters();
}

function openFilterDrawer() {
  filterDrawer.hidden = false;
  filterOverlay.hidden = false;
  requestAnimationFrame(() => {
    filterDrawer.classList.add('open');
  });
  btnFilter.setAttribute('aria-expanded', 'true');
  // Sync selects
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
      const exId = btn.dataset.exchange;
      setFilter('exchange', exId);
      // Update active state
      rightRail.querySelectorAll('.exchange-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      refreshAfterFilter();
    });
  });
}

// ====== ZOOM ======
function setZoom(newLevel) {
  zoomLevel = Math.max(0.8, Math.min(6, newLevel));
  applyZoom();
}

function applyZoom() {
  const mapGroup = document.getElementById('map-group');
  if (mapGroup) {
    mapGroup.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoomLevel})`);
  }
}

// ====== EVENT WIRING ======
function wireEvents() {
  // Filter drawer
  btnFilter.addEventListener('click', openFilterDrawer);
  btnCloseFilter.addEventListener('click', closeFilterDrawer);
  filterOverlay.addEventListener('click', closeFilterDrawer);

  // Clear all
  btnClearAll.addEventListener('click', () => {
    clearFilters();
    buildFilterDrawer(); // reset selects
    refreshAfterFilter();
  });

  // Filter chips
  filterChips.addEventListener('click', e => {
    const btn = e.target.closest('button[data-chip]');
    if (!btn) return;
    const chipType = btn.dataset.chip;
    if (chipType === 'state') {
      goNational();
    } else if (chipType === 'district') {
      goBack();
    } else {
      setFilter(chipType, 'Any');
      const sel = document.getElementById(`filter-${chipType}`);
      if (sel) sel.value = 'Any';
      refreshAfterFilter();
    }
  });

  // Back button
  btnBack.addEventListener('click', goBack);

  // Close results
  btnCloseResults.addEventListener('click', closeResults);

  // Zoom controls
  btnZoomIn.addEventListener('click', () => setZoom(zoomLevel * 1.3));
  btnZoomOut.addEventListener('click', () => setZoom(zoomLevel / 1.3));
  btnZoomReset.addEventListener('click', () => { zoomLevel = 1; panX = 0; panY = 0; applyZoom(); });

  // Map drag (pan)
  mapSvg.addEventListener('mousedown', e => {
    isDragging = true;
    dragStart = { x: e.clientX - panX, y: e.clientY - panY };
    mapSvg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    panX = e.clientX - dragStart.x;
    panY = e.clientY - dragStart.y;
    applyZoom();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
    mapSvg.style.cursor = '';
  });

  // Keyboard: Escape closes drawers
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!filterDrawer.hidden && filterDrawer.classList.contains('open')) {
        closeFilterDrawer();
      }
      if (!resultsPanel.hidden) {
        closeResults();
      }
    }
  });

  // Browser back/forward
  window.addEventListener('popstate', e => {
    if (e.state && e.state.view) {
      if (e.state.view === 'national') goNational();
      else if (e.state.view === 'state') {
        selectedState = e.state.state;
        selectedDistrict = null;
        view = 'state';
        closeResults();
        updateMap('state', selectedState, ABBR_TO_NAME[selectedState], getData());
        updateAppliedFilters();
        btnBack.hidden = false;
      }
    }
  });

  // Login button (prototype — unavailable)
  document.getElementById('btn-login').addEventListener('click', () => {
    alert('Login is unavailable in this local prototype.');
  });

  // Menu button (prototype — unavailable)
  document.getElementById('btn-menu').addEventListener('click', () => {
    alert('Menu is unavailable in this local prototype.');
  });
}

// ====== START ======
document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  start().catch(err => {
    console.error('Prototype startup failed:', err);
    mapSvg.innerHTML = `<text x="500" y="500" text-anchor="middle" fill="#f5a721" font-size="16">
      Failed to start: ${err.message}</text>`;
  });
});
