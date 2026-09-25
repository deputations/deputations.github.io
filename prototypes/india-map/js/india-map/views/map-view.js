// js/india-map/views/map-view.js
// Map view — SVG rendering, state/district drill-down, cinematic transitions.

import { getData, getListingsForDistrict, getFilters } from '../../map-provider.js';
import { GEOJSON_TO_CANONICAL, CANONICAL_TO_FIXTURES } from '../../state-geo.js';
import { ParticleSystem } from '../particles.js';

let mapContainer, particleCanvas, particles;
let hudCtrl = null;
let statesGeo = null;
let districtsGeo = null;
let viewState = 'national';
let selectedStateAbbr = null;
let selectedDistrictName = null;
let generation = 0;
let currentView = 'map';

// Projection bounds (India lat/lon extent with padding)
const GEO_BOUNDS = { minLon: 68.1, maxLon: 97.5, minLat: 6.7, maxLat: 37.1 };
const VB_W = 1000, VB_H = 800;
const VB_PAD = 40;

function project(lon, lat) {
  const x = ((lon - GEO_BOUNDS.minLon) / (GEO_BOUNDS.maxLon - GEO_BOUNDS.minLon)) * (VB_W - VB_PAD * 2) + VB_PAD;
  const y = ((GEO_BOUNDS.maxLat - lat) / (GEO_BOUNDS.maxLat - GEO_BOUNDS.minLat)) * (VB_H - VB_PAD * 2) + VB_PAD;
  return [x, y];
}

// State code → name mapping (from census data)
const CODE_TO_NAME = { '01': 'J&K', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '25': 'Daman and Diu', '26': 'Dadra and Nagar Haveli', '27': 'Maharashtra', '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar', '36': 'Telangana', '37': 'Andhra Pradesh (New)' };

// Abbreviation mapping (our code → census code)
const ABBR_TO_CODE = { 'JK': '01', 'HP': '02', 'PB': '03', 'CH': '04', 'UT': '05', 'HR': '06', 'DL': '07', 'RJ': '08', 'UP': '09', 'BR': '10', 'SK': '11', 'AR': '12', 'NL': '13', 'MN': '14', 'MZ': '15', 'TR': '16', 'ML': '17', 'AS': '18', 'WB': '19', 'JH': '20', 'OD': '21', 'CG': '22', 'MP': '23', 'GJ': '24', 'DD': '25', 'DN': '26', 'MH': '27', 'AP': '28', 'KA': '29', 'GA': '30', 'LD': '31', 'KL': '32', 'TN': '33', 'PY': '34', 'AN': '35', 'TS': '36' };

// ====== INIT ======
export async function initMapView({ canvas, hud }) {
  hudCtrl = hud;
  mapContainer = document.getElementById('map-container');
  particleCanvas = canvas;
  particles = new ParticleSystem(canvas);

  const svgContainer = document.getElementById('india-map-svg');
  svgContainer.innerHTML = buildSVG();

  await loadGeometry();
}

function buildSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"
    preserveAspectRatio="xMidYMid meet" id="map-svg" role="img" aria-label="India map showing job counts">
    <defs>
      <filter id="glow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <g id="map-group">
      <g id="shapes-layer"></g>
      <g id="labels-layer"></g>
    </g>
  </svg>`;
}

// ====== GEOMETRY LOADING ======
async function loadGeometry() {
  try {
    const [statesResp, districtsResp] = await Promise.all([
      fetch('geo/india-states.geojson'),
      fetch('geo/india-districts-all.geojson')
    ]);

    if (!statesResp.ok) throw new Error(`States HTTP ${statesResp.status}`);
    statesGeo = await statesResp.json();

    if (districtsResp.ok) {
      districtsGeo = await districtsResp.json();
    }

    renderNationalMap();
    checkEmptyState();
  } catch (err) {
    const svg = document.getElementById('map-svg');
    if (svg) svg.innerHTML = `<text x="500" y="400" text-anchor="middle" fill="#f5a721" font-size="16">Error: ${err.message}</text>`;
  }
}

function checkEmptyState() {
  const data = getData();
  const emptyEl = document.getElementById('empty-state');
  if (data.nationalCount === 0) {
    emptyEl.classList.add('visible');
  } else {
    emptyEl.classList.remove('visible');
  }
}

// ====== NATIONAL MAP ======
function renderNationalMap() {
  viewState = 'national';
  selectedStateAbbr = null;
  selectedDistrictName = null;

  resetViewBox();
  const shapesLayer = getShapesLayer();
  const labelsLayer = getLabelsLayer();
  shapesLayer.innerHTML = '';
  labelsLayer.innerHTML = '';

  if (!statesGeo) return;

  const data = getData();

  statesGeo.features.forEach(feature => {
    const name = feature.properties.NAME_1 || '';
    const abbr = feature.properties.abbr || '';
    const count = data.stateCounts[abbr] || 0;

    const path = createPath(feature, `ad-state ${count === 0 ? 'empty-state' : ''}`, abbr, count, `${name}: ${count} jobs`);
    path.addEventListener('click', (e) => onStateClick(abbr, name, e));
    path.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onStateClick(abbr, name, e);
    });
    shapesLayer.appendChild(path);

    // Label
    const centroid = getCentroid(feature.geometry);
    if (centroid && abbr.length <= 3) {
      const text = createText(centroid.x, centroid.y, abbr, 'ad-state-label');
      labelsLayer.appendChild(text);
    }
  });

  updateSummary();
}

// ====== STATE DRILL-DOWN ======
function onStateClick(abbr, name, event) {
  if (viewState === 'state' && selectedStateAbbr === abbr) return;

  const gen = ++generation;

  // Particle burst at click point
  const rect = mapContainer.getBoundingClientRect();
  particles.burst(event.clientX - rect.left, event.clientY - rect.top, 70);

  loadStateAndDrill(abbr, name, event.clientX, event.clientY, gen);
}

async function loadStateAndDrill(abbr, name, clickX, clickY, gen) {
  try {
    if (!districtsGeo) {
      const resp = await fetch('geo/india-districts-all.geojson');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      districtsGeo = await resp.json();
    }

    if (gen !== generation) return;

    const svg = document.getElementById('map-svg');
    const pt = svg.createSVGPoint();
    pt.x = clickX;
    pt.y = clickY;
    const ctm = svg.getScreenCTM().inverse();
    const svgCoords = pt.matrixTransform(ctm);

    await cinematicTransition(abbr, svgCoords.x, svgCoords.y);

    if (gen !== generation) return;

    renderStateMapFromDistricts(abbr, name);
    selectedStateAbbr = abbr;
    viewState = 'state';
    document.getElementById('btn-back').hidden = false;
    pushURL('state', abbr, null);
    updateSummary();

  } catch (err) {
    console.error(`Failed to load ${abbr}:`, err);
  }
}

// ====== CINEMATIC TRANSITION ======
function cinematicTransition(abbr, svgX, svgY) {
  return new Promise(resolve => {
    const svg = document.getElementById('map-svg');
    const vb = svg.viewBox.baseVal;

    // Calculate centroid from districts for this state
    const stateCode = ABBR_TO_CODE[abbr] || abbr;
    const stateDistricts = (districtsGeo?.features || []).filter(f => f.properties.st_code === stateCode);
    let centroid = { x: 500, y: 400 };

    if (stateDistricts.length > 0) {
      const allCoords = stateDistricts.flatMap(f =>
        f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat().flat() : f.geometry.coordinates[0]
      );
      centroid = getPolygonCentroid(allCoords);
    }

    const targetW = vb.width / 2.5;
    const targetH = vb.height / 2.5;
    const targetVB = {
      x: centroid.x - targetW / 2,
      y: centroid.y - targetH / 2,
      w: targetW,
      h: targetH
    };

    const startVB = { x: vb.x, y: vb.y, w: vb.width, h: vb.height };
    const startTime = performance.now();
    const duration = 600;

    function animateVB(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const e = easeOutCubic(t);

      vb.x = startVB.x + (targetVB.x - startVB.x) * e;
      vb.y = startVB.y + (targetVB.y - startVB.y) * e;
      vb.width = startVB.w + (targetVB.w - startVB.w) * e;
      vb.height = startVB.h + (targetVB.h - startVB.h) * e;

      if (t < 1) {
        requestAnimationFrame(animateVB);
      } else {
        resolve();
      }
    }
    requestAnimationFrame(animateVB);
  });
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

// ====== STATE MAP (districts from districts-all) ======
function renderStateMapFromDistricts(abbr, name) {
  const shapesLayer = getShapesLayer();
  const labelsLayer = getLabelsLayer();
  shapesLayer.innerHTML = '';
  labelsLayer.innerHTML = '';

  const stateCode = ABBR_TO_CODE[abbr] || abbr;
  const fixtureMap = CANONICAL_TO_FIXTURES[abbr] || {};
  const canonicalMap = GEOJSON_TO_CANONICAL[abbr] || {};

  const stateFeatures = (districtsGeo?.features || []).filter(f => f.properties.st_code === stateCode);
  const data = getData();

  stateFeatures.forEach((feature, idx) => {
    const geoName = feature.properties.district || `District ${idx}`;
    const fixtureNames = fixtureMap[geoName] || canonicalMap[geoName] || [geoName];
    const count = countDistrictListings(abbr, fixtureNames);

    const path = createPath(feature, `ad-district ${count === 0 ? 'empty-state' : ''}`, fixtureNames[0], count, geoName);
    path.addEventListener('click', (e) => onDistrictClick(abbr, fixtureNames[0], geoName, count, e, path));
    path.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') onDistrictClick(abbr, fixtureNames[0], geoName, count, e, path);
    });
    shapesLayer.appendChild(path);

    const centroid = getCentroid(feature.geometry);
    if (centroid) {
      const text = createText(centroid.x, centroid.y + 3, geoName, 'ad-district-label');
      text.dataset.district = fixtureNames[0];
      labelsLayer.appendChild(text);

      if (count > 0) {
        const badge = createText(centroid.x, centroid.y - 8, String(count), 'ad-count-badge');
        badge.dataset.district = fixtureNames[0];
        labelsLayer.appendChild(badge);
      }
    }
  });

  const allLabels = labelsLayer.querySelectorAll('.ad-district-label, .ad-count-badge');
  allLabels.forEach((el, i) => {
    el.style.opacity = '0';
    setTimeout(() => el.classList.add('visible'), 500 + i * 25);
  });
}

// ====== DISTRICT CLICK ======
function onDistrictClick(stateAbbr, districtName, geoName, count, event, pathEl) {
  if (viewState === 'district' && selectedDistrictName === districtName) {
    openResultsSheet(stateAbbr, districtName);
    return;
  }

  // Pulse animation
  pathEl.style.animation = 'none';
  pathEl.offsetHeight;
  pathEl.style.animation = 'ad-pulse-ring 0.6s ease-out';

  selectedDistrictName = districtName;
  viewState = 'district';
  pushURL('district', stateAbbr, districtName);

  setTimeout(() => openResultsSheet(stateAbbr, districtName), 250);
}

// ====== RESULTS SHEET ======
function openResultsSheet(stateAbbr, districtName) {
  const listings = getListingsForDistrict(stateAbbr, districtName);
  const sheet = document.getElementById('results-sheet');
  const overlay = document.getElementById('sheet-overlay');
  const title = document.getElementById('sheet-title');
  const breadcrumb = document.getElementById('sheet-breadcrumb');
  const body = document.getElementById('sheet-body');

  title.textContent = listings.length === 1 ? '1 Job' : `${listings.length} Jobs`;
  breadcrumb.innerHTML = `
    <a data-nav="national">India</a> <span class="sep">&rsaquo;</span>
    <a data-nav="state">${esc(stateAbbr)}</a> <span class="sep">&rsaquo;</span>
    <span class="current">${esc(districtName)}</span>
  `;

  body.innerHTML = listings.map((l, i) => `
    <div class="ad-listing-card" style="animation-delay: ${i * 60}ms">
      <div class="ad-listing-card-header">
        <div class="ad-listing-title">${esc(l.title)}</div>
        <span class="ad-listing-badge qualification">${esc(l.qualification || 'Any')}</span>
      </div>
      <div class="ad-listing-meta">
        ${l.experience ? `<span><i class="ph ph-clock"></i> ${esc(l.experience)}</span>` : ''}
        ${l.jobType ? `<span><i class="ph ph-briefcase"></i> ${esc(l.jobType)}</span>` : ''}
        ${l.jobShift ? `<span><i class="ph ph-sun"></i> ${esc(l.jobShift)}</span>` : ''}
      </div>
      <div class="ad-listing-footer">
        <span class="ad-listing-close-date ${isUrgent(l.closingDate) ? 'urgent' : ''}">
          <i class="ph ph-calendar"></i> Closes ${esc(l.closingDate || 'TBD')}
        </span>
        <span class="ad-listing-posts">${l.posts || 1} post${(l.posts || 1) > 1 ? 's' : ''}</span>
      </div>
    </div>
  `).join('');

  sheet.hidden = false;
  overlay.classList.add('open');
  sheet.classList.add('open');

  const cards = body.querySelectorAll('.ad-listing-card');
  cards.forEach((card, i) => {
    setTimeout(() => card.classList.add('visible'), 400 + i * 60);
  });

  breadcrumb.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      const nav = a.dataset.nav;
      if (nav === 'national') {
        closeSheet();
        resetToNational();
      } else if (nav === 'state') {
        closeSheet();
        drillToState(stateAbbr);
      }
    });
  });

  updateSummary(districtName);
}

function closeSheet() {
  const sheet = document.getElementById('results-sheet');
  const overlay = document.getElementById('sheet-overlay');
  sheet.classList.remove('open');
  overlay.classList.remove('open');
  setTimeout(() => { sheet.hidden = true; }, 400);
}

function isUrgent(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (d - now) / (1000 * 60 * 60 * 24);
  return diff > 0 && diff < 30;
}

// ====== BACK BUTTON ======
export function wireBackButton() {
  document.getElementById('btn-back').addEventListener('click', () => {
    if (viewState === 'district') {
      closeSheet();
      if (selectedStateAbbr) {
        drillToState(selectedStateAbbr);
      } else {
        resetToNational();
      }
    } else if (viewState === 'state') {
      resetToNational();
    }
  });
}

async function resetToNational() {
  const gen = ++generation;
  viewState = 'national';
  selectedStateAbbr = null;
  selectedDistrictName = null;
  document.getElementById('btn-back').hidden = true;

  resetViewBox();
  renderNationalMap();
  checkEmptyState();
  pushURL('national', null, null);
  updateSummary();
}

async function drillToState(abbr) {
  const gen = ++generation;
  try {
    if (!districtsGeo) {
      const resp = await fetch('geo/india-districts-all.geojson');
      if (!resp.ok) return;
      districtsGeo = await resp.json();
    }
    if (gen !== generation) return;

    viewState = 'state';
    selectedDistrictName = null;
    selectedStateAbbr = abbr;

    await cinematicTransition(abbr, 0, 0);
    renderStateMapFromDistricts(abbr, abbr);

    pushURL('state', abbr, null);
    updateSummary();
  } catch (err) {
    console.error(`Failed to drill to ${abbr}:`, err);
  }
}

// ====== SUMMARY ======
function updateSummary(districtName) {
  const data = getData();
  const titleEl = document.getElementById('summary-title');
  const countEl = document.getElementById('summary-count');
  const labelEl = document.getElementById('summary-label');

  if (districtName) {
    titleEl.textContent = districtName;
    countEl.textContent = data.nationalCount;
    labelEl.textContent = 'jobs here';
  } else if (selectedStateAbbr) {
    titleEl.textContent = selectedStateAbbr;
    countEl.textContent = data.stateCounts[selectedStateAbbr] || 0;
    labelEl.textContent = 'jobs in this state';
  } else {
    titleEl.textContent = 'All India';
    countEl.textContent = data.nationalCount;
    labelEl.textContent = 'active vacancies';
  }
}

// ====== URL ======
function pushURL(view, state, district) {
  const params = new URLSearchParams();
  params.set('view', 'map');
  if (view === 'state') params.set('state', state);
  if (view === 'district') { params.set('state', state); params.set('district', district); }
  history.pushState({ view, state, district }, '', `?${params.toString()}`);
}

export function restoreFromURL(params) {
  const view = params.get('view') || 'map';
  const state = params.get('state');
  const district = params.get('district');

  if (view === 'map' && state) {
    selectedStateAbbr = state;
    const gen = ++generation;
    // Districts are already loaded
    if (gen !== generation) return;

    viewState = district ? 'district' : 'state';
    if (district) selectedDistrictName = district;
    document.getElementById('btn-back').hidden = false;

    // Set viewBox to state
    const stateCode = ABBR_TO_CODE[state] || state;
    const stateFeatures = (districtsGeo?.features || []).filter(f => f.properties.st_code === stateCode);
    if (stateFeatures.length > 0) {
      const allCoords = stateFeatures.flatMap(f =>
        f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.flat().flat() : f.geometry.coordinates[0]
      );
      const centroid = getPolygonCentroid(allCoords);
      const svg = document.getElementById('map-svg');
      const vb = svg.viewBox.baseVal;
      const tw = vb.width / 2.5;
      const th = vb.height / 2.5;
      vb.x = centroid.x - tw / 2;
      vb.y = centroid.y - th / 2;
      vb.width = tw;
      vb.height = th;
    }

    renderStateMapFromDistricts(state, state);
    updateSummary(district || null);
    checkEmptyState();

    if (district) {
      setTimeout(() => openResultsSheet(state, district), 300);
    }
    return true;
  }
  return false;
}

// ====== REFRESH (after filter change) ======
export function refreshMapData() {
  const data = getData();
  if (viewState === 'national') {
    renderNationalMap();
    checkEmptyState();
  } else if (viewState === 'state' && selectedStateAbbr) {
    renderStateMapFromDistricts(selectedStateAbbr, selectedStateAbbr);
  }
  updateSummary(selectedDistrictName);
}

// ====== ZOOM ======
export function zoomIn() {
  const vb = getVB();
  const cx = vb.x + vb.width / 2;
  const cy = vb.y + vb.height / 2;
  setVB(cx - (vb.width / ZOOM_FACTOR) / 2, cy - (vb.height / ZOOM_FACTOR) / 2, vb.width / ZOOM_FACTOR, vb.height / ZOOM_FACTOR);
}

export function zoomOut() {
  const vb = getVB();
  const cx = vb.x + vb.width / 2;
  const cy = vb.y + vb.height / 2;
  setVB(cx - (vb.width * ZOOM_FACTOR) / 2, cy - (vb.height * ZOOM_FACTOR) / 2, vb.width * ZOOM_FACTOR, vb.height * ZOOM_FACTOR);
}

export function zoomReset() {
  resetViewBox();
}

function getVB() {
  const vb = document.getElementById('map-svg')?.viewBox?.baseVal;
  return vb ? { x: vb.x, y: vb.y, width: vb.width, height: vb.height } : { x: 0, y: 0, width: 1000, height: 800 };
}

function setVB(x, y, w, h) {
  const vb = document.getElementById('map-svg')?.viewBox?.baseVal;
  if (vb) { vb.x = x; vb.y = y; vb.width = w; vb.height = h; }
}

function resetViewBox() {
  const svg = document.getElementById('map-svg');
  if (svg) {
    svg.viewBox.baseVal.x = 0;
    svg.viewBox.baseVal.y = 0;
    svg.viewBox.baseVal.width = 1000;
    svg.viewBox.baseVal.height = 800;
  }
}

// ====== SVG HELPERS ======
function getShapesLayer() { return document.getElementById('shapes-layer'); }
function getLabelsLayer() { return document.getElementById('labels-layer'); }

function createPath(feature, className, id, count, ariaLabel) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const d = feature.geometry.type === 'MultiPolygon'
    ? multiPolygonToPath(feature.geometry.coordinates)
    : polygonToPath(feature.geometry.coordinates);
  path.setAttribute('d', d);
  path.setAttribute('class', className);
  path.dataset.count = count;
  path.setAttribute('role', 'button');
  path.setAttribute('aria-label', ariaLabel || '');
  path.setAttribute('tabindex', '0');
  return path;
}

function createText(x, y, content, className) {
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', x);
  text.setAttribute('y', y);
  text.setAttribute('class', className);
  text.setAttribute('text-anchor', 'middle');
  text.textContent = content;
  return text;
}

function countDistrictListings(stateAbbr, fixtureNames) {
  const seen = new Set();
  let count = 0;
  fixtureNames.forEach(fn => {
    getListingsForDistrict(stateAbbr, fn).forEach(l => {
      if (!seen.has(l.id)) { seen.add(l.id); count++; }
    });
  });
  return count;
}

function polygonToPath(coords) {
  return 'M ' + coords.map(c => { const p = project(c[0], c[1]); return `${p[0]},${p[1]}`; }).join(' L ') + ' Z';
}

function multiPolygonToPath(coords) {
  return coords.map(poly => 'M ' + poly[0].map(c => { const p = project(c[0], c[1]); return `${p[0]},${p[1]}`; }).join(' L ') + ' Z').join(' ');
}

function getCentroid(geometry) {
  const coords = geometry.type === 'MultiPolygon'
    ? geometry.coordinates.flat().flat()
    : geometry.coordinates[0];
  return { x: avgProjected(coords, 0), y: avgProjected(coords, 1) };
}

function getPolygonCentroid(rings) {
  const coords = Array.isArray(rings[0]?.[0]) ? rings[0] : rings;
  return { x: avgProjected(coords, 0), y: avgProjected(coords, 1) };
}

function avgProjected(arr, idx) {
  const proj = arr.map(c => project(c[0], c[1]));
  return proj.reduce((s, p) => s + p[idx], 0) / Math.max(proj.length, 1);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
