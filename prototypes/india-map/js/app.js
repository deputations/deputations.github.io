// js/app.js — AllDeputations India Map Prototype
// Main application: rendering, navigation, filters, tooltips, particles

import { init as initProvider, setFilter, clearFilters, getFilters, getData,
         getListingsForState, getListingsForDistrict } from './map-provider.js';
import { STATE_ABBR, ABBR_TO_NAME, STATE_LIST, DISTRICT_GEOJSON_TO_FIXTURE, fixtureDistrictToGeoJSON } from './state-geo.js';
import { EXCHANGES, FILTERS } from '../fixtures/mock-data.js';
import { initParticles } from './india-map/particles.js';

// ====== DOM REFERENCES (let — goNational() rebuilds them after Delhi view) ======
let mapSvg = document.getElementById('india-map');
let mapContainer = document.getElementById('map-container');
let tooltip = document.getElementById('tooltip');
let tooltipName = document.getElementById('tooltip-name');
let tooltipCount = document.getElementById('tooltip-count');
let summaryTitle = document.getElementById('summary-title');
let summaryCount = document.getElementById('summary-count');
let summaryCard = document.getElementById('summary-card');
let appliedFilters = document.getElementById('applied-filters');
let filterChips = document.getElementById('filter-chips');
let btnClearAll = document.getElementById('btn-clear-all');
let btnFilter = document.getElementById('btn-filter');
let btnBack = document.getElementById('btn-back');
let btnZoomIn = document.getElementById('btn-zoom-in');
let btnZoomOut = document.getElementById('btn-zoom-out');
let btnZoomReset = document.getElementById('btn-zoom-reset');
let particleCanvas = document.getElementById('particle-canvas');
let particles = null;
let resultsPanel = document.getElementById('results-panel');
let resultsTitle = document.getElementById('results-title');
let resultsBreadcrumb = document.getElementById('results-breadcrumb');
let resultsList = document.getElementById('results-list');
let sheetOverlay = document.getElementById('sheet-overlay');
let btnCloseResults = document.getElementById('btn-close-results');
let filterOverlay = document.getElementById('filter-overlay');
let filterDrawer = document.getElementById('filter-drawer');
let filterBody = document.getElementById('filter-body');
let btnCloseFilter = document.getElementById('btn-close-filter');
let rightRail = null; // removed from UI — reference kept for compatibility

// ====== STATE ======
let view = 'national';
let selectedState = null;
let selectedDistrict = null;
let geoData = null;
let stateDistrictMap = null;  // stateAbbr → [{ name, geojsonName }] from GeoJSON
let currentProjection = null;
let currentGeneration = 0;

// Zoom state (incremental, animated)
let zoomLevel = 1.0;
let targetZoomLevel = 1.0;
let zoomAnimFrame = null;
const ZOOM_MIN = 0.5, ZOOM_MAX = 8.0, ZOOM_STEP = 1.3;

// Pan state (for fly-to camera)
let panX = 0, panY = 0;       // current animated offset
let targetPanX = 0, targetPanY = 0;
let panAnimFrame = null;

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

// Build stateAbbr → [{name, geojsonName}] from the all-districts GeoJSON.
// Cached so tooltips never trigger geometry fetches.
function buildStateDistrictMap(distData) {
  stateDistrictMap = {};
  if (!distData || !distData.features) return;
  distData.features.forEach(f => {
    const stNm = f.properties.st_nm;
    const abbr = STATE_ABBR[stNm];
    if (!abbr) return;
    const dName = f.properties.district;
    if (!dName) return;
    if (!stateDistrictMap[abbr]) stateDistrictMap[abbr] = [];
    stateDistrictMap[abbr].push({ name: dName, geojsonName: dName });
  });
}

// Get district names for a state (from precomputed map or GeoJSON fallback)
function getDistrictList(stateAbbr) {
  if (stateDistrictMap && stateDistrictMap[stateAbbr]) {
    return stateDistrictMap[stateAbbr].map(d => d.name);
  }
  // Fallback: extract from states GeoJSON (has NAME_1 only, no districts)
  if (!geoData) return [];
  const stateName = ABBR_TO_NAME[stateAbbr];
  if (!stateName) return [];
  const feat = geoData.features.find(f => f.properties.NAME_1 === stateName);
  if (!feat) return [];
  const districts = feat.properties.districts || [];
  return districts.map(d => d.NAME_2).filter(Boolean);
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
    path.setAttribute('aria-label', `${name}: ${data.stateCounts[abbr] || 0} deputations`);

    const count = data.stateCounts[abbr] || 0;
    if (count === 0) path.classList.add('zero');

    path.addEventListener('mouseenter', e => showTooltip(e, name, count, abbr, data));
    path.addEventListener('mousemove', moveTooltip);
    path.addEventListener('mouseleave', hideTooltip);
    path.addEventListener('focus', e => showTooltip(e, name, count, abbr, data));
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

  updateSummary('All India Deputations', data.nationalCount);
}

function renderStateMap(stateAbbr, stateName, data) {
  if (stateAbbr === 'DL') {
    renderDelhiImageMap(stateAbbr, stateName, data);
    return;
  }
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

// ====== DELHI IMAGE-MAP (colored district photos) ======

// Delhi district hotspot definitions (image-relative % boxes matching the
// colored overview `img/delhi/delhi-coloured.jpg`).
// Each entry: { name, left, top, width, height, image } where values are
// percentages of the rendered image dimensions.
const DELHI_DISTRICTS = [
  // Calibrated against 1472×1344 image; tight boxes matching district shapes
  { name: 'North',            left: 42, top: 2,  width: 24, height: 20, image: 'd7-north.png' },
  { name: 'North West',       left: 28, top: 16, width: 20, height: 22, image: 'd8-north_west.png' },
  { name: 'West',             left: 26, top: 38, width: 20, height: 20, image: 'd5-west.png' },
  { name: 'South West',       left: 16, top: 60, width: 26, height: 22, image: 'd3-south_west.png' },
  { name: 'North East',       left: 68, top: 4,  width: 20, height: 28, image: 'd10-north_east.png' },
  { name: 'Shahdara',         left: 70, top: 24, width: 18, height: 20, image: 'd9-shahadara.png' },
  { name: 'East',             left: 76, top: 42, width: 16, height: 20, image: 'd6-east.png' },
  { name: 'Central',          left: 62, top: 28, width: 14, height: 14, image: 'd11-central.png' },
  { name: 'New Delhi',        left: 44, top: 52, width: 20, height: 24, image: 'd2-new_delhi.png' },
  { name: 'South East',       left: 72, top: 62, width: 18, height: 22, image: 'd04-south_east.jpg' },
  { name: 'South',            left: 40, top: 78, width: 22, height: 18, image: 'd1-south.png' }
];

function renderDelhiImageMap(stateAbbr, stateName, data, initialDistrict = null) {
  clearMap();
  mapSvg.innerHTML = '';
  btnBack.hidden = false;
  view = 'state';

  const districtEntries = DELHI_DISTRICTS.map(d => ({
    name: d.name,
    count: data.districtCounts[`${stateAbbr}::${d.name}`] || 0,
    image: d.image
  }));

  const hotspots = DELHI_DISTRICTS.map(d => {
    const entry = districtEntries.find(e => e.name === d.name);
    const count = entry ? entry.count : 0;
    const zeroAttr = count === 0 ? ' data-zero="true"' : '';
    const countDisplay = count > 0 ? `<span class="ad-delhi-count">${count}</span>` : '';
    return `<button class="ad-delhi-hotspot"${zeroAttr}
      style="left:${d.left}%;top:${d.top}%;width:${d.width}%;height:${d.height}%"
      data-district="${d.name}"
      data-image="${d.image}"
      aria-label="${d.name}: ${count} listings">
      ${countDisplay}
    </button>`;
  }).join('');

  // Replace SVG with image-map inside map-container
  const mapArea = mapContainer.querySelector('.ad-map-area') || mapContainer;
  mapArea.innerHTML = `
    <div class="ad-delhi-map-wrap">
      <img src="img/delhi/delhi-coloured.jpg" alt="Delhi district map" class="ad-delhi-map-img" draggable="false">
      <img src="" alt="District preview" class="ad-delhi-preview-img" draggable="false" aria-hidden="true">
      <div class="ad-delhi-hotspots">${hotspots}</div>
    </div>
  `;

  const hotspotsContainer = mapArea.querySelector('.ad-delhi-hotspots');
  hotspotsContainer.querySelectorAll('.ad-delhi-hotspot').forEach(btn => {
    btn.addEventListener('click', () => {
      showDelhiDistrict(stateAbbr, btn.dataset.district, btn.dataset.image, data);
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
      if (previewImg) {
        previewImg.classList.remove('visible');
      }
    });
  });

  if (initialDistrict) {
    const dist = DELHI_DISTRICTS.find(d => d.name === initialDistrict);
    if (dist) {
      showDelhiDistrict(stateAbbr, initialDistrict, dist.image, data, true);
      return;
    }
  }

  showResults({
    title: `${stateName} Deputations`,
    breadcrumb: [`<a href="#" data-nav="national">India</a> <span>›</span> ${stateName}`],
    listings: getListingsForState(stateAbbr)
  });

  updateAppliedFilters();
  syncExchangeRail(data);
  history.pushState({ view: 'state', state: stateAbbr }, '', `?state=${stateAbbr}`);
}

function showDelhiDistrict(stateAbbr, districtName, imageFile, data, skipPush = false) {
  selectedDistrict = districtName;
  view = 'district';

  const mapArea = mapContainer.querySelector('.ad-map-area') || mapContainer;
  mapArea.innerHTML = `
    <div class="ad-delhi-district-view">
      <img src="img/delhi/${imageFile}" alt="${districtName}" class="ad-delhi-district-img" draggable="false">
      <button class="ad-delhi-back-btn" data-nav="state" aria-label="Back to Delhi overview">← Delhi overview</button>
    </div>
  `;
  mapArea.querySelector('.ad-delhi-back-btn').addEventListener('click', () => {
    renderDelhiImageMap(stateAbbr, 'Delhi', data);
  });

  mapContainer.querySelectorAll('.ad-delhi-hotspot').forEach(b => b.classList.remove('active'));
  const activeHotspot = mapContainer.querySelector(`.ad-delhi-hotspot[data-district="${CSS.escape(districtName)}"]`);
  if (activeHotspot) activeHotspot.classList.add('active');

  showResults({
    title: `${districtName} Deputations`,
    breadcrumb: [
      `<a href="#" data-nav="national">India</a> <span>›</span> `,
      `<a href="#" data-nav="state">Delhi</a> <span>›</span> ${districtName}`
    ],
    listings: getListingsForDistrict(stateAbbr, districtName)
  });

  updateAppliedFilters();
  syncExchangeRail(data);
  if (!skipPush) {
    history.pushState(
      { view: 'district', state: stateAbbr, district: districtName },
      '', `?state=${stateAbbr}&district=${encodeURIComponent(districtName)}`
    );
  }
}

function renderDistrictMap(distData, stateAbbr, stateName, data) {
  computeProjection(distData.features);
  applyZoomTransform();

  // Camera fly-to: fit state bbox in viewport (runs after render completes)
  // Use 2x rAF to ensure the map-group element is in the DOM
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      try {
        const g = document.getElementById('map-group');
        if (!g) return; // map was replaced
        const feat = geoData?.features?.find(f => STATE_ABBR[f.properties.NAME_1] === stateAbbr);
        if (feat) {
          const pts = flattenCoords(feat.geometry).map(([lon, lat]) => project(lon, lat));
          if (pts.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            pts.forEach(([x, y]) => {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            });
            flyToBounds(minX, minY, maxX, maxY, 0.2);
          }
        }
      } catch (err) {
        console.error('Fly-to rAF error:', err);
      }
    });
  });

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
    path.setAttribute('aria-label', `${fixtureName}, ${stateName}: ${count} deputations`);

    if (count === 0) path.classList.add('zero');

    path.addEventListener('mouseenter', e => showTooltip(e, `${fixtureName}, ${stateName}`, count, null, null));
    path.addEventListener('mousemove', moveTooltip);
    path.addEventListener('mouseleave', hideTooltip);
    path.addEventListener('focus', e => showTooltip(e, `${fixtureName}, ${stateName}`, count, null, null));
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

  updateSummary(`${stateName.toUpperCase()} DEPUTATIONS`, data.stateCounts[stateAbbr] || 0);
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
    title: `${stateName} Deputations`,
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
    title: `${districtName} Deputations`,
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
  btnBack.hidden = false;
}

function goBack() {
  try {
    if (view === 'district' && selectedState) {
      // District → State
      const data = getData();
      view = 'state';
      selectedDistrict = null;
      closeResults();
      renderStateMap(selectedState, ABBR_TO_NAME[selectedState] || selectedState, data);
      updateSummary(`${(ABBR_TO_NAME[selectedState] || selectedState).toUpperCase()} DEPUTATIONS`, data.stateCounts[selectedState] || 0);
      updateAppliedFilters();
      syncExchangeRail(data);
      history.pushState({ view: 'state', state: selectedState }, '', `?state=${selectedState}`);
      btnBack.hidden = false;
    } else if (view === 'state') {
      // State → National
      goNational();
    }
  } catch (err) {
    console.error('goBack error:', err);
  }
}

// goBackToState is no longer needed — history.back() handles it via popstate

function goNational() {
  ++currentGeneration;
  selectedState = null;
  selectedDistrict = null;
  view = 'national';
  closeResults();
  btnBack.hidden = true;

  // Reset camera
  panX = 0; panY = 0; targetPanX = 0; targetPanY = 0;
  setZoom(1.0);

  const mapArea = document.querySelector('.ad-map-area');
  if (mapArea) {
    mapArea.innerHTML = `
      <div class="ad-map-container" id="map-container">
        <svg id="india-map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"
             preserveAspectRatio="xMidYMid meet" role="img" aria-label="India map showing deputation counts by state">
        </svg>
        <canvas id="particle-canvas" aria-hidden="true"></canvas>
        <div class="ad-tooltip" id="tooltip" role="tooltip" aria-hidden="true">
          <span class="ad-tooltip-name" id="tooltip-name"></span>
          <span class="ad-tooltip-count" id="tooltip-count"></span>
        </div>
      </div>
    `;
    mapContainer = document.getElementById('map-container');
  }
  mapSvg = document.getElementById('india-map');
  tooltip = document.getElementById('tooltip');
  tooltipName = document.getElementById('tooltip-name');
  tooltipCount = document.getElementById('tooltip-count');

  const data = getData();
  renderNationalMap(data);
  updateSummary('ALL INDIA DEPUTATIONS', data.nationalCount);
  updateAppliedFilters();
  syncExchangeRail(data);
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
function showTooltip(event, name, count, abbr, data) {
  tooltipName.textContent = name;
  if (count === 0 && abbr && stateDistrictMap && stateDistrictMap[abbr]) {
    // Show district count preview for zero-count states
    const districts = stateDistrictMap[abbr].map(d => d.name);
    tooltipCount.innerHTML = districts.length > 0
      ? `${districts.length} districts (no deputations)`
      : '0 deputations';
  } else {
    tooltipCount.textContent = count;
  }
  tooltip.classList.add('visible');
  tooltip.setAttribute('aria-hidden', 'false');
  moveTooltip(event);
}

// ====== TOOLTIP MOVEMENT ======
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

// ====== PARTICLES ======
function spawnParticlesAtClick(e) {
  if (!particles) return;
  const rect = mapContainer.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  particles.spawn(x, y, 70);
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

  const defaultVals = { category: 'Any', qualification: 'Any', experience: 'Any',
                         jobType: 'Any', jobTime: 'Any', jobShift: 'Any' };
  const filterDefs = {
    category: { Any:'All Deputations', govt:'Government', private:'Private', internship:'Internship', manpower:'Manpower' },
    jobType: { Any:'Any', 'Full-time':'Full-time', 'Part-time':'Part-time', 'Contract':'Contract', 'Temporary':'Temporary' },
    jobShift: { Any:'Any', 'On-site':'On-site', 'Remote':'Remote', 'Hybrid':'Hybrid' },
    jobTime: { Any:'Any', 'Day Shift':'Day Shift', 'Night Shift':'Night Shift', 'Flexible':'Flexible' }
  };
  const displayChip = (c) => {
    const map = filterDefs[c.type] || {};
    return map[c.label] || c.label;
  };

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
      `<span class="ad-filter-chip" style="animation-delay:${i * 60}ms">${displayChip(c)}<button data-chip="${c.type}" aria-label="Remove ${displayChip(c)}">×</button></span>`
    ).join('');
  }
}

function syncExchangeRail(data) {
  // Exchange rail removed — no-op.
}

// ====== CARD-GRID VIEWS (Functional / Industrial) ======
const cardView = document.getElementById('card-view');
const cardViewTitle = document.getElementById('card-view-title');
const cardViewSubtitle = document.getElementById('card-view-subtitle');
const cardGrid = document.getElementById('card-grid');
const cardListings = document.getElementById('card-listings');
const listingCards = document.getElementById('listing-cards');
const btnCardBack = document.getElementById('btn-card-back');

function showCardView(viewType) {
  view = viewType; // 'functional' or 'industrial'

  // Hide map-related elements, show card view
  mapContainer.hidden = true;
  summaryCard.hidden = true;
  if (rightRail) rightRail.hidden = true;
  cardView.hidden = false;
  btnBack.hidden = true;

  const data = getData();
  const listings = getListingsForState(null); // all filtered listings

  if (viewType === 'functional') {
    cardViewTitle.textContent = 'Functional Categories';
    cardViewSubtitle.textContent = 'Browse listings by functional area';
  } else {
    cardViewTitle.textContent = 'Qualification Groups';
    cardViewSubtitle.textContent = 'Browse listings by qualification';
  }

  // Group listings
  const groupKey = viewType === 'functional' ? 'function' : 'qualificationGroup';
  const groups = {};
  for (const l of listings) {
    const key = l[groupKey] || 'Other';
    if (!groups[key]) groups[key] = [];
    groups[key].push(l);
  }

  // Render category cards
  const categoryIcons = {
    'Executive & Leadership': 'ph-crown',
    'Information Technology (IT)': 'ph-desktop',
    'Marketing & Communications': 'ph-megaphone',
    'Operations & Supply Chain': 'ph-gear',
    'Sales & Business Development': 'ph-currency-inr',
    'Administrative': 'ph-clipboard-text',
    'Technical': 'ph-wrench',
    'Defence': 'ph-shield',
    'Police': 'ph-shield-check',
    'Vigilance': 'ph-eye',
    'Education': 'ph-graduation-cap',
    'Healthcare': 'ph-heartbeat',
    'Finance': 'ph-currency-circle-dollar',
    'Engineering': 'ph-fan',
    'Teaching': 'ph-chalkboard-teacher',
    'Legal': 'ph-scales',
    'General': 'ph-users'
  };

  cardGrid.innerHTML = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
    .map(([name, items]) => {
      const icon = categoryIcons[name] || 'ph-folder';
      return `<button class="ad-category-card" data-category="${name}" data-group="${groupKey}">
        <i class="ph ${icon} ad-category-icon"></i>
        <span class="ad-category-name">${name}</span>
        <span class="ad-category-count">${items.length}</span>
      </button>`;
    }).join('');

  // Wire card clicks
  cardGrid.querySelectorAll('.ad-category-card').forEach(card => {
    card.addEventListener('click', () => {
      const catName = card.dataset.category;
      showCardCategoryListings(viewType, catName, groupKey, groups[catName] || []);
    });
  });

  // Show grid, hide listings
  cardGrid.hidden = false;
  cardListings.hidden = true;
  cardViewTitle.hidden = false;
  cardViewSubtitle.hidden = false;

  history.pushState({ view: viewType }, '', `?view=${viewType}`);
}

function showCardCategoryListings(viewType, category, groupKey, items) {
  cardGrid.hidden = true;
  cardListings.hidden = false;
  cardViewTitle.hidden = false;
  cardViewSubtitle.hidden = false;

  const groupLabel = viewType === 'functional' ? 'Functional Area' : 'Qualification';
  cardViewTitle.textContent = category;
  cardViewSubtitle.textContent = `${items.length} listings · ${groupLabel}`;

  listingCards.innerHTML = items.map(item => `
    <div class="ad-listing-card" tabindex="0" role="article" aria-label="${item.title}">
      <div class="ad-listing-header">
        <h3 class="ad-listing-title">${item.title}</h3>
        <span class="ad-listing-state">${item.state} · ${item.district}</span>
      </div>
      <div class="ad-listing-meta">
        <span class="ad-listing-badge ad-badge-${item.category}">${item.category}</span>
        <span class="ad-listing-qual">${item.qualification}</span>
        <span class="ad-listing-exp">${item.experience}</span>
      </div>
      <div class="ad-listing-footer">
        <span class="ad-listing-date">Closes: ${item.closingDate}</span>
        <span class="ad-listing-posts">${item.posts} post${item.posts > 1 ? 's' : ''}</span>
      </div>
    </div>
  `).join('');

  btnCardBack.onclick = () => showCardView(viewType);

  history.pushState({ view: viewType, category }, '', `?view=${viewType}&category=${encodeURIComponent(category)}`);
}

function showMapView() {
  view = 'national';
  mapContainer.hidden = false;
  if (typeof summaryCard !== 'undefined' && summaryCard) summaryCard.hidden = false;
  if (rightRail) rightRail.hidden = false;
  cardView.hidden = true;
  btnBack.hidden = true;
  selectedState = null;
  selectedDistrict = null;
  closeResults();
  renderNationalMap(getData());
  updateAppliedFilters();
  syncExchangeRail(getData());
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
  // Build "category" options — values match listing.category
  const categoryValues = ['Any', 'govt', 'private', 'internship', 'manpower'];
  const categoryLabels = { 'Any':'All Deputations','govt':'Government','private':'Private',
    'internship':'Internship','manpower':'Manpower' };
  const filters = [
    { key: 'category', label: 'DEPUTATION TYPE', icon: 'ph-briefcase', options: categoryValues,
      displayLabels: categoryLabels },
    { key: 'qualification', label: 'MINIMUM QUALIFICATION', icon: 'ph-graduation-cap', options: FILTERS.qualification },
    { key: 'experience', label: 'EXPERIENCE RANGE', icon: 'ph-clock', options: FILTERS.experience },
    { key: 'jobType', label: 'EMPLOYMENT TYPE', icon: 'ph-sun', options: FILTERS.jobType },
    { key: 'jobShift', label: 'WORK MODE', icon: 'ph-gear', options: FILTERS.jobShift }
  ];

  filterBody.innerHTML = filters.map(f => `
    <div class="filter-group">
      <label class="filter-group-label" for="filter-${f.key}">
        <i class="ph ${f.icon}"></i> ${f.label}
      </label>
      <select class="filter-select" id="filter-${f.key}" data-filter-key="${f.key}">
        ${f.options.map(o => {
          const label = (f.displayLabels && f.displayLabels[o]) ? f.displayLabels[o] : o;
          return `<option value="${o}">${label}</option>`;
        }).join('')}
      </select>
    </div>
  `).join('') + `
    <div class="filter-footer">
      <button class="ad-clear-all-btn" id="btn-clear-all-drawer">Clear All Filters</button>
    </div>
  `;

  // Clear All inside drawer
  const clearBtn = filterBody.querySelector('#btn-clear-all-drawer');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      clearFilters();
      refreshAfterFilter();
      updateAppliedFilters();
      closeFilterDrawer();
    });
  }

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
      title: `${selectedDistrict} Deputations`,
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

// ====== EXCHANGE RAIL (removed) ======
function buildExchangeRail() {
  // Exchange rail removed — was job-centric; filtering is via the filter drawer only.
}

// ====== ZOOM (incremental, animated) ======
function applyZoomTransform(level = zoomLevel) {
  const mapGroup = document.getElementById('map-group');
  if (!mapGroup) return;
  if (level === 1.0 && panX === 0 && panY === 0) {
    mapGroup.removeAttribute('transform');
    return;
  }
  // SVG viewBox "0 0 1000 800" mapped to container with preserveAspectRatio="xMidYMid meet".
  // The SVG center (500, 400) is always at container center.
  // We scale around (500, 400) then translate by panX,panY in viewport units.
  // To express this as SVG transform: scale(level) means scale around (0,0).
  // To scale around (500, 400): translate(-500, -400), scale, translate(500, 400).
  // Then translate the whole thing by (panX, panY) in SVG units.
  const t = `translate(${panX}, ${panY}) translate(500, 400) scale(${level}) translate(-500, -400)`;
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

// ====== CAMERA FLY-TO ======
// Smooth pan + zoom to a target SVG coordinate (e.g. state centroid).
function flyTo(targetSvgX, targetSvgY, targetZoom = 1.8) {
  targetZoomLevel = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, targetZoom));
  targetPanX = targetZoomLevel * (500 - targetSvgX);
  targetPanY = targetZoomLevel * (400 - targetSvgY);

  if (zoomAnimFrame) cancelAnimationFrame(zoomAnimFrame);
  if (panAnimFrame) cancelAnimationFrame(panAnimFrame);
  panAnimFrame = requestAnimationFrame(animatePanZoom);
}

// Fit a bounding box (in projected SVG coords) to the viewport with padding.
// Transform: translate(panX, panY) translate(500, 400) scale(z) translate(-500, -400)
// A point P maps to: P' = (panX + z*(Px-500) + 500, panY + z*(Py-400) + 400)
// For the bbox center (cx, cy) to land at SVG center (500, 400):
//   panX = 500 - z*cx + 500*(z-1) = 500*(2-z) - z*(cx-500)...
//   Simpler: panX + z*(cx-500) + 500 = 500  =>  panX = z*(500-cx)
//   Same for panY = z*(400-cy)
// Fill fraction: bbox occupies fill of viewport in each axis, z = 1000/(bw/fill)
function flyToBounds(minX, minY, maxX, maxY, padFrac = 0.25) {
  const bw = maxX - minX || 1;
  const bh = maxY - minY || 1;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // State should fill 1/(1+2*padFrac) of viewport
  const fill = 1.0 / (1.0 + 2 * padFrac);
  const zx = 1000 / (bw * fill);
  const zy = 800 / (bh * fill);
  const targetZ = Math.max(1.0, Math.min(4.0, Math.min(zx, zy)));

  targetZoomLevel = targetZ;
  // Center the bbox in the viewport
  targetPanX = targetZ * (500 - cx);
  targetPanY = targetZ * (400 - cy);

  if (zoomAnimFrame) cancelAnimationFrame(zoomAnimFrame);
  if (panAnimFrame) cancelAnimationFrame(panAnimFrame);
  panAnimFrame = requestAnimationFrame(animatePanZoom);
}

function animatePanZoom() {
  const zdiff = targetZoomLevel - zoomLevel;
  const xdiff = targetPanX - panX;
  const ydiff = targetPanY - panY;

  if (Math.abs(zdiff) < 0.001 && Math.abs(xdiff) < 0.1 && Math.abs(ydiff) < 0.1) {
    zoomLevel = targetZoomLevel;
    panX = targetPanX;
    panY = targetPanY;
    applyZoomTransform(zoomLevel);
    zoomAnimFrame = null;
    panAnimFrame = null;
    // Spawn particles AFTER fly-to completes — burst at viewport center
    if (particles && window.__flyToOrigin) {
      try {
        const rect = mapContainer?.getBoundingClientRect();
        if (rect) {
          const cx = rect.width / 2;
          const cy = rect.height / 2;
          particles.spawn(cx, cy, 80);
        }
      } catch (e) { /* ignore if container gone */ }
      window.__flyToOrigin = null;
    }
    return;
  }

  // Abort if map was replaced (national view)
  if (!document.getElementById('map-group')) {
    zoomAnimFrame = null;
    panAnimFrame = null;
    return;
  }

  zoomLevel += zdiff * 0.12;
  panX += xdiff * 0.12;
  panY += ydiff * 0.12;
  applyZoomTransform(zoomLevel);
  panAnimFrame = requestAnimationFrame(animatePanZoom);
}

// ====== HUD AUTO-HIDE ======
let hudTimeout = null;

function showHUD() {
  document.querySelector('.ad-bottom-controls')?.classList.remove('ad-hud-hidden');
  document.getElementById('btn-filter')?.classList.remove('ad-hud-hidden');
  resetHudTimeout();
}

function hideHUD() {
  if (view === 'district') return; // keep HUD visible in district results view
  document.querySelector('.ad-bottom-controls')?.classList.add('ad-hud-hidden');
  document.getElementById('btn-filter')?.classList.add('ad-hud-hidden');
}

function resetHudTimeout() {
  if (hudTimeout) clearTimeout(hudTimeout);
  hudTimeout = setTimeout(hideHUD, 4000);
}

function initHudAutoHide() {
  // Show on mouse-move near bottom 120px of viewport
  document.addEventListener('mousemove', e => {
    if (e.clientY > window.innerHeight - 120) showHUD();
  });

  // Touch devices: always show HUD on touch
  document.addEventListener('touchstart', () => showHUD(), { passive: true });

  // Back button: both navigates AND shows HUD
  document.getElementById('btn-back')?.addEventListener('click', showHUD);

  resetHudTimeout();
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
    } else if (chipType === 'category') {
      setFilter('category', 'Any');
      const sel = document.getElementById('filter-category');
      if (sel) sel.value = 'Any';
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

  // Wire view-toggle buttons (Map / Functional / Industrial)
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const viewType = btn.dataset.view;
      document.querySelectorAll('.view-btn').forEach(b => {
        const active = b.dataset.view === viewType;
        b.classList.toggle('active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      if (viewType === 'map') {
        showMapView();
      } else {
        showCardView(viewType);
      }
    });
  });

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

    if (state?.view === 'district') {
      selectedState = state.state;
      selectedDistrict = state.district;
      view = 'district';
      closeResults();
      const data = getData();
      renderStateMap(selectedState, ABBR_TO_NAME[selectedState], data);
      setTimeout(() => {
        showResults({
          title: `${state.district} Deputations`,
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
      syncExchangeRail(data);
      btnBack.hidden = false;
    } else if (state?.view === 'state') {
      selectedState = state.state;
      selectedDistrict = null;
      view = 'state';
      closeResults();
      const data = getData();
      renderStateMap(selectedState, ABBR_TO_NAME[selectedState], data);
      updateSummary(`${(ABBR_TO_NAME[selectedState] || state.state).toUpperCase()} DEPUTATIONS`, data.stateCounts[state.state] || 0);
      updateAppliedFilters();
      syncExchangeRail(data);
      btnBack.hidden = false;
    } else {
      // null state = initial page load = national view
      if (view === 'national') return; // already there
      selectedState = null;
      selectedDistrict = null;
      view = 'national';
      closeResults();
      btnBack.hidden = true;
      const mapArea = document.querySelector('.ad-map-area');
      if (mapArea) {
        mapArea.innerHTML = `
          <div class="ad-map-container" id="map-container">
            <svg id="india-map" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 800"
                 preserveAspectRatio="xMidYMid meet" role="img" aria-label="India map showing deputation counts by state">
            </svg>
            <canvas id="particle-canvas" aria-hidden="true"></canvas>
            <div class="ad-tooltip" id="tooltip" role="tooltip" aria-hidden="true">
              <span class="ad-tooltip-name" id="tooltip-name"></span>
              <span class="ad-tooltip-count" id="tooltip-count"></span>
            </div>
          </div>
        `;
        mapContainer = document.getElementById('map-container');
        mapSvg = document.getElementById('india-map');
        tooltip = document.getElementById('tooltip');
        tooltipName = document.getElementById('tooltip-name');
        tooltipCount = document.getElementById('tooltip-count');
        const data = getData();
        renderNationalMap(data);
        updateSummary('ALL INDIA DEPUTATIONS', data.nationalCount);
        updateAppliedFilters();
        syncExchangeRail(data);
      }
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
          title: `${selectedDistrict} Deputations`,
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

  // Ensure the initial history entry always has a state object
  if (!history.state) {
    history.replaceState({ view: 'national' }, '', window.location.href);
  }

  try {
    const resp = await fetch('geo/india-states.geojson');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    geoData = await resp.json();

    // Load district GeoJSON for zero-count tooltip previews
    try {
      const dResp = await fetch('geo/india-districts-all.geojson');
      if (dResp.ok) {
        const distData = await dResp.json();
        buildStateDistrictMap(distData);
      }
    } catch { /* districts optional */ }

    initProvider(scenario);
    buildFilterDrawer();
    buildExchangeRail();

    // Init particle system
    if (particleCanvas && mapContainer) {
      particles = initParticles(particleCanvas, mapContainer);
    }

    // Test bridge — expose filter + render functions on window for headless tests.
    // The change event listener on filter selects works in real browsers but Playwright's
    // selectOption emits 'input' without always firing 'change' reliably across versions.
    window.__app = {
      setFilter, clearFilters, getFilters,
      refreshAfterFilter, updateAppliedFilters, renderNationalMap, renderStateMap,
      drillToDistrict, drillToState, goBack, goNational, showResults, closeResults,
      get view() { return view; },
      get selectedState() { return selectedState; },
      get selectedDistrict() { return selectedDistrict; },
      getData
    };

  const restored = restoreFromURL();
  if (!restored) {
    renderNationalMap(getData());
    history.replaceState({ view: 'national' }, '', window.location.pathname);
  }
  } catch (err) {
    console.error('Failed to load geometry:', err);
    mapSvg.innerHTML = `<text x="500" y="400" text-anchor="middle" fill="#f5a721" font-size="16">
      Error loading map geometry: ${err.message}</text>`;
    return;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  wireEvents();
  start().then(() => {
    initHudAutoHide();
  }).catch(err => {
    console.error('Prototype startup failed:', err);
    mapSvg.innerHTML = `<text x="500" y="400" text-anchor="middle" fill="#f5a721" font-size="16">
      Failed to start: ${err.message}</text>`;
  });
});
