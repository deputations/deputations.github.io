// js/india-map/hud.js
// Bottom HUD bar — auto-hide, view toggle, filter button, zoom controls.

const IDLE_TIMEOUT = 4000; // ms before hiding
let hideTimer = null;
let isHUDVisible = true;

export function initHUD({ onViewChange, onFilterOpen, onZoomIn, onZoomOut, onZoomReset }) {
  const hud = document.getElementById('hud');
  const viewBtns = hud.querySelectorAll('.ad-view-btn');
  const filterBtn = document.getElementById('btn-filter');
  const zoomInBtn = document.getElementById('btn-zoom-in');
  const zoomOutBtn = document.getElementById('btn-zoom-out');
  const zoomResetBtn = document.getElementById('btn-zoom-reset');
  const activeFiltersBar = document.getElementById('active-filters-bar');

  // View toggle
  viewBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      viewBtns.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
      onViewChange(btn.dataset.view);
    });
  });

  // Filter
  filterBtn.addEventListener('click', () => {
    onFilterOpen();
  });

  // Zoom
  zoomInBtn.addEventListener('click', onZoomIn);
  zoomOutBtn.addEventListener('click', onZoomOut);
  zoomResetBtn.addEventListener('click', onZoomReset);

  // Auto-hide on mouse inactivity (desktop only)
  const stage = document.getElementById('map-stage');
  stage.addEventListener('mousemove', resetHideTimer);
  stage.addEventListener('mouseleave', () => scheduleHide());
  stage.addEventListener('mouseenter', showHUD);

  // Touch: always show
  stage.addEventListener('touchstart', showHUD, { passive: true });

  // Show HUD initially
  showHUD();

  return {
    setActiveView(view) {
      viewBtns.forEach(b => {
        const isActive = b.dataset.view === view;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    },
    showHUD,
    hideHUD: scheduleHide,
    updateFilterIndicator(hasFilters) {
      filterBtn.classList.toggle('has-filters', hasFilters);
    },
    setActiveFilters(filters) {
      const bar = activeFiltersBar;
      bar.hidden = filters.length === 0;
      bar.innerHTML = filters.map(f => `
        <span class="ad-active-chip">
          ${escapeHTML(f.label)}
          <button data-filter-key="${escapeHTML(f.key)}" aria-label="Remove ${escapeHTML(f.label)}">&times;</button>
        </span>
      `).join('');

      bar.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.filterKey;
          const filter = filters.find(f => f.key === key);
          if (filter && filter.onRemove) filter.onRemove();
        });
      });
    },
    clearActiveFilters() {
      activeFiltersBar.hidden = true;
      activeFiltersBar.innerHTML = '';
    }
  };
}

function showHUD() {
  isHUDVisible = true;
  const hud = document.getElementById('hud');
  hud.classList.remove('hidden');
  hud.classList.add('visible');
  scheduleHide();
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    isHUDVisible = false;
    const hud = document.getElementById('hud');
    hud.classList.remove('visible');
    hud.classList.add('hidden');
  }, IDLE_TIMEOUT);
}

function resetHideTimer() {
  if (!isHUDVisible) showHUD();
  else scheduleHide();
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
