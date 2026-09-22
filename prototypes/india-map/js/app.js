// js/app.js — AllDeputations India Map Prototype
// Main application: rendering, navigation, filters, tooltips

import { init as initProvider, setFilter, clearFilters, getFilters, getData,
         getListingsForState, getListingsForDistrict } from './map-provider.js';
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

// ====== STATE ======
let view = 'national';
let selectedState = null;
let selectedDistrict = null;
let geoData = null;
let currentProjection = null;

// ====== PROJECTION ======
// Equirectangular projection — fits features to the SVG viewBox (1000×800)
// viewBox is "0 0 1000 800"

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
    minLon = 68; minLon2 = 97; minLat = 6; maxLat = 36; // India bounds fallback
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
function renderNationalMap(data) {
  computeProjection(geoData.features);
  const g = createSvgGroup('map-group');
  mapSvg.appendChild(g);

  geoData.features.forEach(feat => {
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
    path.setAttribute('aria-label', `${name}: ${data.stateCounts[abbr] || 0} jobs`);

    if ((data.stateCounts[abbr] || 0) === 0) path.classList.add('zero');

    path.addEventListener('mouseenter', e => showTooltip(e, name, data.stateCounts[abbr] || 0));
    path.addEventListener('mousemove', moveTooltip);
    path.addEventListener('mouseleave', hideTooltip);
    path.addEventListener('focus', e => showTooltip(e, name, data.stateCounts[abbr] || 0));
    path.addEventListener('blur', hideTooltip);
    path.addEventListener('click', () => drillToState(abbr, name));
    path.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drillToState(abbr, name); }
    });

    g.appendChild(path);

    // Labels
    const [clon, clat] = centroid(feat.geometry);
    const [cx, cy] = project(clon, clat);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', cx);
    label.setAttribute('y', cy - 3);
    label.setAttribute('class', 'ad-state-label');
    label.textContent = abbr;
    g.appendChild(label);

    const countEl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    countEl.setAttribute('x', cx);
    countEl.setAttribute('y', cy + 7);
    countEl.setAttribute('class', 'ad-state-count');
    countEl.textContent = data.stateCounts[abbr] || 0;
    g.appendChild(countEl);
  });

  updateSummary('All India Jobs', data.nationalCount);
}

function renderStateMap(stateAbbr, stateName, data) {
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
    console.warn('District geometry unavailable, showing state listing:', err.message);
    showStateListView(stateAbbr, stateName, data);
  }
}

function renderDistrictMap(distData, stateAbbr, stateName, data) {
  clearMap();
  const g = createSvgGroup('map-group');
  mapSvg.appendChild(g);

  computeProjection(distData.features);

  distData.features.forEach(feat => {
    const distName = feat.properties.district;
    if (!distName) return; // skip fallback features without names
    const count = data.districtCounts[`${stateAbbr}::${distName}`] || 0;

    const d = projectCoords(feat.geometry);
    if (!d) return;

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
    path.addEventListener('click', () => drillToDistrict(stateAbbr, distName));
    path.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drillToDistrict(stateAbbr, distName); }
    });

    g.appendChild(path);
  });

  // District labels using centroid from properties or computed
  distData.features.forEach(feat => {
    const distName = feat.properties.district;
    if (!distName) return;
    let cLon = feat.properties.centroid_lon;
    let cLat = feat.properties.centroid_lat;
    if (cLon === undefined) {
      [cLon, cLat] = centroid(feat.geometry);
    }
    const [px, py] = project(cLon, cLat);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', px);
    label.setAttribute('y', py);
    label.setAttribute('class', 'ad-state-label');
    label.textContent = distName.length > 14 ? distName.slice(0, 14) + '…' : distName;
    label.style.fontSize = '7px';
    g.appendChild(label);
  });

  updateSummary(`${stateName.toUpperCase()} JOBS`, data.stateCounts[stateAbbr] || 0);
  btnBack.hidden = false;
  view = 'state';
}

function showStateListView(stateAbbr, stateName, data) {
  clearMap();
  mapSvg.innerHTML = `<text x="500" y="400" text-anchor="middle" fill="#8b92a5" font-size="16">
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

  // Highlight selected state on the map
  document.querySelectorAll('.ad-state').forEach(p => p.classList.remove('drill-highlight'));
  const stateEl = document.querySelector(`.ad-state[data-abbr="${abbr}"]`);
  if (stateEl) stateEl.classList.add('drill-highlight');

  updateMap('state', abbr, name, data);
  updateAppliedFilters();
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
  history.pushState(
    { view: 'district', state: stateAbbr, district: districtName },
    '', `?state=${stateAbbr}&district=${encodeURIComponent(districtName)}`
  );
}

function goBack() {
  if (view === 'district') {
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
  while (mapSvg.firstChild) mapSvg.removeChild(mapSvg.firstChild);
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

  // Filter chips — only show non-default values
  const defaultVals = { exchange: 'all', qualification: 'Any', experience: 'Any', jobType: 'Any', jobTime: 'Any', jobShift: 'Any' };
  Object.entries(filters).forEach(([key, val]) => {
    if (val !== defaultVals[key]) {
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

  filterBody.querySelectorAll('.filter-select').forEach(sel => {
    sel.addEventListener('change', () => {
      setFilter(sel.dataset.filterKey, sel.value);
      refreshAfterFilter();
    });
  });
}

function refreshAfterFilter() {
  const data = getData();
  if (view === 'national') {
    renderNationalMap(data);
  } else if (view === 'state' && selectedState) {
    renderStateMap(selectedState, ABBR_TO_NAME[selectedState], data);
  }
  updateAppliedFilters();
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
  const mapGroup = document.getElementById('map-group');
  if (!mapGroup) return;
  const clamped = Math.max(0.5, Math.min(8, newLevel));
  mapGroup.setAttribute('transform', `translate(500,400) scale(${clamped}) translate(-500,-400)`);
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
    buildFilterDrawer();
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
  });

  // Back button
  btnBack.addEventListener('click', goBack);

  // Close results
  btnCloseResults.addEventListener('click', closeResults);

  // Zoom controls
  btnZoomIn.addEventListener('click', () => setZoom(2.0));
  btnZoomOut.addEventListener('click', () => setZoom(0.8));
  btnZoomReset.addEventListener('click', () => {
    const mapGroup = document.getElementById('map-group');
    if (mapGroup) mapGroup.removeAttribute('transform');
  });

  // Keyboard: Escape closes drawers
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!filterDrawer.hidden && filterDrawer.classList.contains('open')) closeFilterDrawer();
      if (!resultsPanel.hidden) closeResults();
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

  // Login / Menu buttons (prototype — unavailable)
  document.getElementById('btn-login').addEventListener('click', () => {
    alert('Login is unavailable in this local prototype.');
  });
  document.getElementById('btn-menu').addEventListener('click', () => {
    alert('Menu is unavailable in this local prototype.');
  });
}

// ====== START ======
async function start() {
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

  initProvider('populated');
  buildFilterDrawer();
  buildExchangeRail();
  updateMap('national');
  history.replaceState({ view: 'national' }, '', window.location.pathname);
}

document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  start().catch(err => {
    console.error('Prototype startup failed:', err);
    mapSvg.innerHTML = `<text x="500" y="400" text-anchor="middle" fill="#f5a721" font-size="16">
      Failed to start: ${err.message}</text>`;
  });
});
