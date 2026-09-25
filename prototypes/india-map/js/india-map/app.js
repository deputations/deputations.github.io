// js/india-map/app.js — Bootstrap + view router + filter drawer + URL handling
// Entry point: india-map.html loads this module.

import { init as initProvider, setFilter, clearFilters as resetAllFilters, getFilters, getData } from '../map-provider.js';
import { initMapView, refreshMapData, restoreFromURL as restoreMapFromURL, wireBackButton, zoomIn, zoomOut, zoomReset } from './views/map-view.js';
import { initFunctionalView } from './views/functional-view.js';
import { initEducationView } from './views/education-view.js';
import { initHUD } from './hud.js';

let currentView = 'map';
let functionalViewCtrl = null;
let educationViewCtrl = null;
let hudCtrl = null;
let viewRestoredFromURL = false;

const FILTER_GROUPS = [
  { key: 'exchange', label: 'Exchange', options: ['all', 'govt', 'private', 'internship', 'manpower', 'campus', 'entrance'] },
  { key: 'qualification', label: 'Qualification', options: ['Any', 'Graduate', 'Post Graduate', 'Doctorate', 'Diploma', '12th Pass', '10th Pass'] },
  { key: 'experience', label: 'Experience', options: ['Any', 'Fresher', '1-2 years', '3-5 years', '5+ years'] },
  { key: 'jobType', label: 'Job Type', options: ['Any', 'Full-time', 'Part-time', 'Contract', 'Temporary'] },
  { key: 'jobTime', label: 'Shift', options: ['Any', 'Day Shift', 'Night Shift', 'Flexible'] },
  { key: 'jobShift', label: 'Work Mode', options: ['Any', 'On-site', 'Remote', 'Hybrid'] },
];

async function start() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view') || 'map';

  initProvider('populated');

  // Initialize map view (sets up SVG + back button)
  await initMapView({
    canvas: document.getElementById('particle-canvas'),
    hud: document.getElementById('hud'),
  });
  wireBackButton();

  functionalViewCtrl = initFunctionalView('functional-view', 'functional-grid');
  educationViewCtrl = initEducationView('education-view', 'education-grid');

  hudCtrl = initHUD({
    onViewChange: (v) => switchView(v),
    onFilterOpen: () => openFilterDrawer(),
    onZoomIn: () => zoomIn(),
    onZoomOut: () => zoomOut(),
    onZoomReset: () => zoomReset(),
  });

  buildFilterDrawer();
  wireSheetClose();
  wirePopstate();

  // Restore from URL
  if (view === 'functional' || view === 'education') {
    switchView(view);
    viewRestoredFromURL = true;
  } else if (view === 'map' && params.get('state')) {
    restoreMapFromURL(params);
    viewRestoredFromURL = true;
  } else {
    switchView('map');
    viewRestoredFromURL = true;
  }
}

function switchView(view) {
  currentView = view;
  hudCtrl.setActiveView(view);

  const mapSvg = document.getElementById('india-map-svg');
  const functionalView = document.getElementById('functional-view');
  const educationView = document.getElementById('education-view');
  const resultsSheet = document.getElementById('results-sheet');
  const backBtn = document.getElementById('btn-back');

  // Close any open sheet
  resultsSheet.classList.remove('open');
  document.getElementById('sheet-overlay').classList.remove('open');
  setTimeout(() => { resultsSheet.hidden = true; }, 400);

  if (view === 'map') {
    mapSvg.style.display = '';
    functionalView.classList.remove('active');
    educationView.classList.remove('active');
    backBtn.hidden = true;
    refreshMapData();
  } else if (view === 'functional') {
    mapSvg.style.display = 'none';
    functionalView.classList.add('active');
    educationView.classList.remove('active');
    backBtn.hidden = false;
    functionalViewCtrl.render();
  } else if (view === 'education') {
    mapSvg.style.display = 'none';
    functionalView.classList.remove('active');
    educationView.classList.add('active');
    backBtn.hidden = false;
    educationViewCtrl.render();
  }

  updateURLForView(view);
}

// ====== FILTER DRAWER ======
function buildFilterDrawer() {
  const body = document.getElementById('filter-body');
  body.innerHTML = '';
  const currentFilters = getFilters();

  FILTER_GROUPS.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'ad-filter-group';
    groupEl.innerHTML = `<div class="ad-filter-group-label">${group.label}</div>`;

    const chipsEl = document.createElement('div');
    chipsEl.className = 'ad-filter-chips';

    group.options.forEach(opt => {
      const chip = document.createElement('button');
      chip.className = 'ad-filter-chip';
      const currentVal = currentFilters[group.key];
      if ((currentVal && currentVal === opt) || (!currentVal && opt === group.options[0])) {
        chip.classList.add('active');
      }
      chip.textContent = opt;
      chip.dataset.key = group.key;
      chip.dataset.value = opt;
      chip.addEventListener('click', () => {
        chipsEl.querySelectorAll('.ad-filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
      });
      chipsEl.appendChild(chip);
    });

    groupEl.appendChild(chipsEl);
    body.appendChild(groupEl);
  });

  document.getElementById('btn-apply-filters').addEventListener('click', applyFilters);
  document.getElementById('btn-clear-filters').addEventListener('click', clearAllDrawerFilters);
}

function applyFilters() {
  const drawer = document.getElementById('filter-drawer');
  FILTER_GROUPS.forEach(group => {
    const active = drawer.querySelector(`.ad-filter-chip[data-key="${group.key}"].active`);
    setFilter(group.key, active ? active.dataset.value : group.options[0]);
  });

  closeFilterDrawer();
  updateActiveFilterChips();
  refreshCurrentView();
}

function clearAllDrawerFilters() {
  resetAllFilters();
  const drawer = document.getElementById('filter-drawer');
  FILTER_GROUPS.forEach(group => {
    const chips = drawer.querySelectorAll(`.ad-filter-chip[data-key="${group.key}"]`);
    chips.forEach(c => {
      const isDefault = c.dataset.value === group.options[0];
      c.classList.toggle('active', isDefault);
    });
  });
  closeFilterDrawer();
  updateActiveFilterChips();
  refreshCurrentView();
}

function updateActiveFilterChips() {
  const filters = getFilters();
  const filterBtn = document.getElementById('btn-filter');

  const chips = [];
  FILTER_GROUPS.forEach(group => {
    const val = filters[group.key];
    if (val && val !== group.options[0]) {
      chips.push({
        key: group.key,
        label: `${group.label}: ${val}`,
        onRemove: () => {
          setFilter(group.key, group.options[0]);
          // Update drawer chip
          document.querySelectorAll(`#filter-drawer .ad-filter-chip[data-key="${group.key}"]`).forEach(c => {
            c.classList.toggle('active', c.dataset.value === group.options[0]);
          });
          updateActiveFilterChips();
          refreshCurrentView();
        }
      });
    }
  });

  hudCtrl.setActiveFilters(chips);
  hudCtrl.updateFilterIndicator(chips.length > 0);
}

function refreshCurrentView() {
  if (currentView === 'map') {
    refreshMapData();
  } else if (currentView === 'functional') {
    functionalViewCtrl.render();
  } else if (currentView === 'education') {
    educationViewCtrl.render();
  }
}

function openFilterDrawer() {
  const drawer = document.getElementById('filter-drawer');
  drawer.classList.add('open');
}

function closeFilterDrawer() {
  const drawer = document.getElementById('filter-drawer');
  drawer.classList.remove('open');
}

function wireSheetClose() {
  document.getElementById('btn-sheet-close').addEventListener('click', () => {
    const sheet = document.getElementById('results-sheet');
    const overlay = document.getElementById('sheet-overlay');
    sheet.classList.remove('open');
    overlay.classList.remove('open');
    setTimeout(() => { sheet.hidden = true; }, 400);
  });

  document.getElementById('sheet-overlay').addEventListener('click', () => {
    const sheet = document.getElementById('results-sheet');
    const overlay = document.getElementById('sheet-overlay');
    sheet.classList.remove('open');
    overlay.classList.remove('open');
    setTimeout(() => { sheet.hidden = true; }, 400);
  });

  document.getElementById('btn-close-filter').addEventListener('click', closeFilterDrawer);
}

function wirePopstate() {
  window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view') || 'map';
    if (view === 'functional' || view === 'education') {
      switchView(view);
    } else if (view === 'map' && params.get('state')) {
      restoreMapFromURL(params);
    } else {
      switchView('map');
    }
  });
}

function updateURLForView(view) {
  const params = new URLSearchParams();
  params.set('view', view);
  if (view === 'map') {
    const current = new URLSearchParams(window.location.search);
    const state = current.get('state');
    const district = current.get('district');
    if (state) params.set('state', state);
    if (district) params.set('district', district);
  }
  history.replaceState({ view }, '', `?${params.toString()}`);
}

document.addEventListener('DOMContentLoaded', () => {
  start().catch(err => {
    console.error('India Map startup failed:', err);
    const stage = document.getElementById('map-stage');
    stage.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f5a721;font-size:16px;">
      Failed to start: ${err.message}</div>`;
  });
});
