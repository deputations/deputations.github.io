// Shared open/close positioning for the filter dropdowns.
//  • elevates the (sticky → own stacking context) sidebar so the open panel
//    paints OVER the page content and the visitor counter, not behind them;
//  • flips the panel upward when there isn't room below (desktop only).
function flipIfNeeded(root, trigger, panel) {
  const desktop = window.innerWidth > 768;
  const sb = root && root.closest && root.closest('.filters-sidebar');
  if (sb && desktop) sb.classList.add('ms-elevated');
  if (!desktop) { panel.classList.remove('ms-open-up'); return; }
  const tr = trigger.getBoundingClientRect();
  const ph = panel.getBoundingClientRect().height;
  const spaceBelow = window.innerHeight - tr.bottom;
  panel.classList.toggle('ms-open-up', spaceBelow < ph + 12 && tr.top > spaceBelow);
}
function dropElevation() {
  // remove elevation once nothing is open (defer so the just-closed panel counts as hidden)
  setTimeout(() => {
    if (!document.querySelector('.ms-panel:not([hidden])')) {
      document.querySelectorAll('.filters-sidebar.ms-elevated')
        .forEach(s => s.classList.remove('ms-elevated'));
    }
  }, 0);
}

// Inline SVG sprite reference (symbols live in index.html — no icon CDN).
function svgIcon(name, cls = '') {
  return `<svg class="icon${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

// ----- Multi-select widget (popover + checkbox list) ---------------------
// Returns a controller that mirrors enough of a <select>'s surface area
// (`.value`, `.value = ''`, `addEventListener('change', …)`) plus multi-value
// helpers (`.values`, `.setValues(arr)`, `.populate(arr)`).
function createMultiSelect(root, opts = {}) {
  const trigger = root.querySelector('.ms-trigger');
  const label   = root.querySelector('.ms-trigger-label');
  const panel   = root.querySelector('.ms-panel');
  const search  = root.querySelector('.ms-search');
  const list    = root.querySelector('.ms-list');
  const empty   = root.querySelector('.ms-empty');
  const noneBtn = root.querySelector('[data-ms-none]');
  const doneBtns = root.querySelectorAll('[data-ms-done]');
  const countEl = root.querySelector('[data-ms-count]');

  const placeholder    = opts.placeholder || 'All';
  const singularPattern = opts.singularPattern || ((v) => v);
  const multiPattern    = opts.multiPattern    || ((n) => `${n} selected`);
  const changeListeners = [];

  let items = [];
  let selected = new Set();
  let countMap = {};   // optional { value: number } → renders a gradient "(N)"

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
  }
  function countHTML(v) {
    const c = countMap[v];
    return c == null ? '' : `<span class="ss-opt-count">(${c})</span>`;
  }

  function renderList(filter = '') {
    const f = filter.trim().toLowerCase();
    const visible = f ? items.filter(i => i.toLowerCase().includes(f)) : items;
    if (!visible.length) {
      list.innerHTML = '';
      empty.hidden = false;
    } else {
      empty.hidden = true;
      list.innerHTML = visible.map(v => `
        <li><button type="button" class="ms-opt ${selected.has(v) ? 'is-selected' : ''}"
              role="option" aria-selected="${selected.has(v)}" data-value="${esc(v)}">
          <span class="ms-opt-check" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </span>
          <span class="ms-opt-label">${esc(v)}</span>${countHTML(v)}
        </button></li>`).join('');
    }
    syncCount();
  }

  function syncCount() {
    if (!countEl) return;
    const n = selected.size;
    countEl.textContent = n === 0 ? 'None selected' : (n === 1 ? '1 selected' : `${n} selected`);
    countEl.setAttribute('data-active', n > 0 ? 'true' : 'false');
  }

  function syncTrigger() {
    if (!selected.size) {
      label.textContent = placeholder;
      trigger.classList.remove('ms-trigger--active');
    } else if (selected.size === 1) {
      label.textContent = singularPattern([...selected][0]);
      trigger.classList.add('ms-trigger--active');
    } else {
      label.textContent = multiPattern(selected.size);
      trigger.classList.add('ms-trigger--active');
    }
  }

  function emitChange() {
    changeListeners.forEach(fn => {
      try { fn({ type: 'change', target: api }); } catch (e) { console.warn(e); }
    });
  }

  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    search.value = ''; renderList();
    flipIfNeeded(root, trigger, panel);
    setTimeout(() => search.focus(), 0);
  }
  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    dropElevation();
  }

  trigger.addEventListener('click', () => panel.hidden ? open() : close());
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target) && !panel.hidden) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) { close(); trigger.focus(); }
  });

  search.addEventListener('input', () => renderList(search.value));

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.ms-opt');
    if (!btn) return;
    const v = btn.dataset.value;
    if (selected.has(v)) selected.delete(v); else selected.add(v);
    // Animate just this row, don't full-rerender (preserves scroll position)
    const nowSelected = selected.has(v);
    btn.classList.toggle('is-selected', nowSelected);
    btn.setAttribute('aria-selected', String(nowSelected));
    syncCount(); syncTrigger(); emitChange();
  });

  noneBtn.addEventListener('click', () => {
    selected.clear();
    renderList(search.value); syncTrigger(); emitChange();
  });
  doneBtns.forEach(b => b.addEventListener('click', close));

  const api = {
    populate(arr, counts) {
      items = (arr || []).slice();
      countMap = counts || {};
      // drop selections that are no longer present
      [...selected].forEach(v => { if (!items.includes(v)) selected.delete(v); });
      renderList(); syncTrigger();
    },
    get values() { return [...selected]; },
    setValues(arr) {
      selected = new Set((arr || []).filter(v => items.includes(v)));
      renderList(search.value); syncTrigger();
    },
    // Compatibility shims so legacy `.value`/`.value = ''` code keeps working.
    get value() { return selected.size === 1 ? [...selected][0] : ''; },
    set value(v) {
      if (!v) { selected.clear(); }
      else { selected = new Set([v]); }
      renderList(search.value); syncTrigger();
    },
    addEventListener(name, fn) {
      if (name === 'change') changeListeners.push(fn);
    },
    isEmpty() { return selected.size === 0; },
    has(v) { return selected.has(v); },
  };
  return api;
}

/* Themed single-select dropdown (used for Pay Level). Reuses the .ms-* panel
   styling but renders each option as a name + a gradient-coloured "(N …)"
   count. Exposes the same `.value` / change shims as a native <select>. */
function createSingleSelect(root, opts = {}) {
  const trigger = root.querySelector('.ms-trigger');
  const label   = root.querySelector('.ms-trigger-label');
  const panel   = root.querySelector('.ms-panel');
  const list    = root.querySelector('.ms-list');
  let placeholder = opts.placeholder || 'All';
  const fmtCount = opts.countFormat || ((n) => String(n));   // text inside "(…)"
  const changeListeners = [];

  let items = [];   // [{ value, name, count }]  (count null = no count shown)
  let selected = '';
  let disabled = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
  }
  function countHTML(it) {
    if (it.count == null) return '';
    return `<span class="ss-opt-count">(${esc(fmtCount(it.count))})</span>`;
  }
  function renderList() {
    list.innerHTML = items.map(it => {
      const sel = it.value === selected;
      return `<li><button type="button" class="ms-opt ss-opt${sel ? ' is-selected' : ''}"
            role="option" aria-selected="${sel}" data-value="${esc(it.value)}">
          <span class="ss-opt-name">${esc(it.name)}</span>${countHTML(it)}
        </button></li>`;
    }).join('');
  }
  function syncTrigger() {
    const it = items.find(i => i.value === selected);
    if (!selected) {
      // Empty = the "All / Any" default → show the placeholder, no active glow.
      label.innerHTML = esc(placeholder);
      trigger.classList.remove('ms-trigger--active');
    } else if (!it) {
      label.innerHTML = esc(selected);
      trigger.classList.add('ms-trigger--active');
    } else {
      label.innerHTML = `${esc(it.name)}${countHTML(it)}`;
      trigger.classList.add('ms-trigger--active');
    }
  }
  function emitChange() {
    changeListeners.forEach(fn => { try { fn({ type: 'change', target: api }); } catch (e) { console.warn(e); } });
  }
  function open() {
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    flipIfNeeded(root, trigger, panel);
  }
  function close() { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); dropElevation(); }

  trigger.addEventListener('click', () => { if (disabled) return; panel.hidden ? open() : close(); });
  document.addEventListener('click', (e) => { if (!root.contains(e.target) && !panel.hidden) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { close(); trigger.focus(); } });
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.ss-opt');
    if (!btn) return;
    selected = btn.dataset.value;
    renderList(); syncTrigger(); close(); emitChange();
  });

  const api = {
    populate(arr) {
      items = (arr || []).slice();
      if (selected && !items.some(i => i.value === selected)) selected = '';
      renderList(); syncTrigger();
    },
    get value() { return selected; },
    set value(v) { selected = v || ''; renderList(); syncTrigger(); },
    addEventListener(name, fn) { if (name === 'change') changeListeners.push(fn); },
    // Native-<select> compatibility shims used by legacy call-sites.
    get options() { return items.map(it => ({ value: it.value, textContent: it.name })); },
    dispatchEvent(evt) { if (evt && evt.type === 'change') emitChange(); return true; },
    has(v) { return items.some(it => it.value === v); },
    get disabled() { return disabled; },
    set disabled(b) {
      disabled = !!b;
      trigger.classList.toggle('ms-trigger--disabled', disabled);
      trigger.setAttribute('aria-disabled', String(disabled));
      if (disabled) close();
    },
    setPlaceholder(p) { placeholder = p; if (!selected) syncTrigger(); },
  };
  return api;
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Deputation dashboard started');

    const WATCHLIST_KEY = 'deputationWatchlist';

    const kpiGrid = document.getElementById('kpiGrid');
    const resultsCount = document.getElementById('resultsCount');
    const dataContainer = document.getElementById('dataContainer');
    const activeFilters = document.getElementById('activeFilters');
    const dashboardContent = document.querySelector('.dashboard-content');
    const filtersSidebar = document.querySelector('.filters-sidebar');

    const themeToggle = document.getElementById('themeToggle');
    const THEME_KEY = 'deputation_theme_v1';

    const searchPost = document.getElementById('searchPost');
    const filterMyPayLevel = createSingleSelect(document.getElementById('filterMyPayLevelSS'), {
      placeholder: 'Your Pay Level',
    });
    const filterExperience = createSingleSelect(document.getElementById('filterExperienceSS'), {
      placeholder: 'Any',
    });
    const filterLevel = createSingleSelect(document.getElementById('filterLevelSS'), {
      placeholder: 'All Levels',
      countFormat: (n) => `${n} ${n === 1 ? 'vacancy' : 'vacancies'}`,
    });
    const filterMinistry = createSingleSelect(document.getElementById('filterMinistrySS'), {
      placeholder: 'All Ministries',
    });
    const filterOrgType = createSingleSelect(document.getElementById('filterOrgTypeSS'), {
      placeholder: 'All Types',
    });
    const filterRegion = createSingleSelect(document.getElementById('filterRegionSS'), {
      placeholder: 'All Regions',
    });
    const filterLocation = createMultiSelect(document.getElementById('filterLocationMS'), {
      placeholder: 'All Locations',
      singularPattern: (v) => v,
      multiPattern: (n) => `${n} locations`,
    });
    const filterStatus = createSingleSelect(document.getElementById('filterStatusSS'), {
      placeholder: 'All',
    });

    // Card-view sort dropdown (toolbar). Reuses the themed single-select and
    // maps straight onto the existing sortState used by the table headers.
    const CARD_SORTS = {
      closing: { key: 'Days_Left', direction: 'asc', name: 'Closing soon' },
      newest: { key: 'Notification_Date', direction: 'desc', name: 'Newest first' },
      level: { key: 'Level_Text', direction: 'desc', name: 'Highest level' },
      post: { key: 'Post_Name', direction: 'asc', name: 'Post name A–Z' },
    };
    const cardSortRoot = document.getElementById('cardSortSS');
    const cardSort = cardSortRoot ? createSingleSelect(cardSortRoot, { placeholder: 'Sort' }) : null;
    if (cardSort) {
      cardSort.populate(Object.entries(CARD_SORTS).map(([value, s]) => ({ value, name: s.name, count: null })));
      cardSort.value = 'closing';
      cardSort.addEventListener('change', () => {
        const s = CARD_SORTS[cardSort.value] || CARD_SORTS.closing;
        sortState.key = s.key;
        sortState.direction = s.direction;
        pagination.currentPage = 1;
        pagination.pagesShown = 1;
        vtDiscrete = true;
        renderDashboard();
      });
    }

    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const btnTableView = document.getElementById('btnTableView');
    const btnCardView = document.getElementById('btnCardView');

    const favBtn = document.getElementById('favBtn');
    const favCount = document.getElementById('favCount');

    const modal = document.getElementById('modal');
    const closeModalBtn = document.getElementById('closeModal');
    const modalBody = document.getElementById('modalBody');

    let previousKpiSnapshot = null;
    let rawData = [];
    let currentView = 'table';
    let watchlist = loadWatchlist();
    let showWatchlistOnly = false;
    let kpiFilter = 'all';

   let sortState = {
  key: 'Notification_Date',
  direction: 'desc'
};

    let pagination = {
        currentPage: 1,
        pageSize: 10,
        pagesShown: 1          // card view "Load more" window
    };

    // Card view groups sibling posts; remember which groups the user expanded
    // so heart-toggle re-renders don't collapse them.
    let expandedGroups = new Set();

    // One-shot flag: the next renderDashboard came from a discrete click
    // (view toggle / sort / quick filter / load-more) → animate via the
    // View Transitions API. Never set for search keystrokes.
    let vtDiscrete = false;

    let quickFilters = {
        newOnly: false,
        closing7: false,
        delhiNcr: false,
        closingToday: false
    };

    let searchSuggestions = [];
    let searchDatalist = null;
    let quickFiltersBar = null;

    // EXPERIMENT: automatic link preview. Vacancy_ID -> pre-rendered thumbnail
    // path for the Official_Notification_Link (data/link_previews.json, built by
    // scripts/build_link_previews.py). Empty when the manifest is missing.
    let linkPreviews = {};

   initializeEnhancements();
initializeMobileFilterAccordion();
initDesktopFilterCollapse();
setupScrollProgress();
initializeModal();
updateWatchlistUI();
setLoadingUI();
initializeTheme();

if (themeToggle && !themeToggle.dataset.bound) {
  themeToggle.addEventListener('click', toggleTheme);
  themeToggle.dataset.bound = 'true';
}

loadDataFromJSON();

// Prefill My Pay Level from the saved deputation profile (if present).
// Runs on every fresh page load. Doesn't clobber a value the user already
// picked (URL param or in-session selection). The toast is suppressed only
// after the user explicitly dismisses it once in the session.
function autoselectPayLevelFromProfile() {
  try {
    const raw = localStorage.getItem('dep_profile_v1');
    if (!raw) return;
    const profile = JSON.parse(raw);
    const lvl = String(profile && profile.payLevel || '').trim();
    if (!lvl) return;

    // Only set if the dropdown is currently empty.
    if (!filterMyPayLevel.value) {
      if (![...filterMyPayLevel.options].some(o => o.value === lvl)) return;
      filterMyPayLevel.value = lvl;
      // Make sure renders downstream see the new value.
      filterMyPayLevel.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Mirror years-at-current-level from the profile, if set.
    const yrs = String(profile && profile.yearsAtCurrentLevel || '').trim();
    if (filterExperience && yrs && !filterExperience.value) {
      const capped = Math.min(10, parseInt(yrs, 10) || 0);
      if ([...filterExperience.options].some(o => o.value === String(capped))) {
        filterExperience.value = String(capped);
        filterExperience.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    if (sessionStorage.getItem('payLevelToastDismissed') === '1') return;
    showHomeToast(`Pay Level <strong>${lvl}</strong> auto-selected from your <a href="/my-deputation.html#profile">profile</a>.`);
  } catch (e) {
    console.warn('payLevel autoselect skipped:', e);
  }
}

function showHomeToast(html) {
  let t = document.getElementById('homeToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'homeToast';
    t.className = 'home-toast';
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    // Manual popover → renders in the top layer, so toasts stay visible above
    // the open <dialog> (plain z-index always loses to the top layer).
    if (typeof t.showPopover === 'function') t.setAttribute('popover', 'manual');
    t.innerHTML = `
      <span class="home-toast-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
      </span>
      <span class="home-toast-msg"></span>
      <button type="button" class="home-toast-close" aria-label="Dismiss">×</button>`;
    document.body.appendChild(t);
    t.querySelector('.home-toast-close').addEventListener('click', () => {
      hideToastEl(t);
      try { sessionStorage.setItem('payLevelToastDismissed', '1'); } catch (e) {}
    });
  }
  t.querySelector('.home-toast-msg').innerHTML = html;
  try { if (t.hasAttribute('popover') && !t.matches(':popover-open')) t.showPopover(); } catch (e) {}
  // Allow the element to be in the DOM before transitioning.
  setTimeout(() => t.classList.add('show'), 30);
  clearTimeout(t.__hideTimer);
  t.__hideTimer = setTimeout(() => hideToastEl(t), 6500);
}

function hideToastEl(t) {
  t.classList.remove('show');
  setTimeout(() => { try { if (t.hasAttribute('popover')) t.hidePopover(); } catch (e) {} }, 280);
}

 function getCurrentPageSize() {
  return currentView === 'card' ? 9 : 10;
}   

function loadDataFromJSON() {
    Promise.all([fetchVacancies(), loadLinkPreviews(), loadMeta()])
        .then(([data, previews, meta]) => {
            rawData = data;
            linkPreviews = previews;

            reconcileWatchlistWithData();
            populateFilters();
            hydrateFiltersFromUrl();
            autoselectPayLevelFromProfile();
            buildSearchSuggestions();
            bindEvents();
            updateQuickFiltersBar();
            applyMobileDefaultView();
            renderDashboard();
            openVacancyFromUrl();
            injectJsonLd();
            initLinkPreview();
            setDataUpdated(meta);

            console.log('✅ Loaded', rawData.length, 'vacancies');
        })
        .catch(err => {
            console.error('❌ Data load failed:', err);
            dataContainer.innerHTML = `
                <div class="empty-state">
                    Failed to load data.
                </div>
            `;
        });
}

// Source of truth = data/vacancies.json (committed, served same-origin from
// GitHub Pages). Supabase is an OPTIONAL live enhancement: if reachable and
// returns rows, they merge in (Supabase wins on conflict). This is the order
// because (a) the JSON is committed at build time so it's always available,
// (b) it's same-origin over GitHub Pages TLS which survives NIC-network
// SSL interceptors, and (c) Supabase REST is cross-origin and frequently
// fails on NIC networks with ERR_SSL_PROTOCOL_ERROR. Both paths run through
// the shared enrich.js so the rendered records have identical derived fields.
function fetchVacancies() {
    const enrich = (rows) =>
        (window.DepEnrich ? window.DepEnrich.enrichAll(rows) : rows);

    // Primary: static JSON, same origin, no firewall surprises.
    const jsonPromise = fetch('data/vacancies.json')
        .then(res => (res.ok ? res.json() : []))
        .catch(() => []);

    // Enhancement: Supabase REST with a 4s timeout. On NIC networks this will
    // typically reject with ERR_SSL_PROTOCOL_ERROR — the .catch swallows it
    // and we keep the JSON rows.
    //
    // P3-7 PR 1: gate on ensureSupabaseAvailable() so we don't even attempt
    // the cross-origin REST call when a one-time TLS probe has already
    // confirmed Supabase is unreachable from this network. Saves the 4s
    // wait + console noise on every page load inside NIC.
    let sbPromise = Promise.resolve(null);
    if (window.SUPABASE_READY && window.SUPABASE_READY()) {
        sbPromise = window.ensureSupabaseAvailable().then(available => {
            if (!available) return null;
            const url = `${window.SUPABASE_URL}/rest/v1/vacancies?status=eq.approved&select=*`;
            return Promise.race([
                fetch(url, {
                    headers: {
                        apikey: window.SUPABASE_ANON_KEY,
                        Authorization: `Bearer ${window.SUPABASE_ANON_KEY}`,
                    },
                }).then(res => (res.ok ? res.json() : null))
                  .catch(() => null),
                new Promise(resolve => setTimeout(() => resolve(null), 4000)),
            ]);
        });
    }

    return Promise.all([jsonPromise, sbPromise]).then(([jsonRows, sbRows]) => {
        const json = Array.isArray(jsonRows) ? jsonRows : [];
        // build_data.py fills most derived fields at cron time, but two fields
        // are NOT computed there: Region (left blank by the source spreadsheet,
        // expected to be derived from Location_State) and eligibility_tiers
        // (left as the legacy eligibility_rules blob). backfillDerived fills
        // those two for Title_Case JSON rows so the Region + Pay Level filters
        // see correct data. Idempotent; safe on already-enriched rows.
        // MUST run on JSON rows in BOTH branches (merged/SB-only and JSON-only)
        // because the merge path keeps JSON rows as-is and the filter pipeline
        // skips them when eligibility_tiers is empty.
        if (window.DepEnrich && typeof window.DepEnrich.backfillDerived === 'function') {
            json.forEach(r => window.DepEnrich.backfillDerived(r));
        }
        if (sbRows && sbRows.length) {
            // Merge strategy:
            //   • JSON rows are already enriched (Title_Case + derived fields).
            //   • Supabase rows are snake_case; their Title_Case fields would
            //     be empty if passed through enrich.js's enrichAll() unchanged,
            //     because that function reads from snake_case keys.
            //   • For Vacancy_IDs present in BOTH, prefer the JSON row — it has
            //     the most up-to-date derived fields from the last cron dump.
            //   • For Supabase-only IDs (rare), enrich the snake_case row to
            //     Title_Case via enrichRecord so the rest of the pipeline works.
            //   • After all rows are uniform Title_Case, recompute Status from
            //     last_date_to_apply — JSON's Status field becomes stale as
            //     days tick by, and the dashboard should always show truth.
            const jsonIds = new Set(json.map(r => r.Vacancy_ID));
            const sbOnly = sbRows.filter(r => r.Vacancy_ID && !jsonIds.has(r.Vacancy_ID));
            const sbOnlyEnriched = sbOnly.map(r =>
                window.DepEnrich ? window.DepEnrich.enrichRecord(r) : r
            );
            const merged = [...json, ...sbOnlyEnriched];
            console.log('📡 Source: Supabase live + JSON merged',
                sbRows.length, 'live,', json.length, 'json,',
                sbOnly.length, 'sb-only enriched');
            return recomputeStatus(merged);
        }
        console.log('📄 Source: data/vacancies.json (Supabase unavailable / empty)');
        return recomputeStatus(json);
    });
}

// Status in the JSON is computed by build_data.py at dump time (days_left
// relative to that moment). By the time the dashboard renders, several days
// may have passed and rows that were "Active" then are now expired. Recompute
// Status from last_date_to_apply for every row so the active filter and the
// KPI cards always reflect reality.
function recomputeStatus(rows) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return rows.map(r => {
        const iso = String(r.Last_Date_To_Apply || '').trim();
        let status = 'Unknown';
        let daysLeft = '';
        if (iso) {
            const d = new Date(iso + 'T00:00:00');
            if (!isNaN(d.getTime())) {
                daysLeft = Math.round((d - today) / 86400000);
                status = daysLeft >= 0 ? 'Active' : 'Inactive';
            }
        }
        return { ...r, Status: status, Days_Left: daysLeft };
    });
}

// EXPERIMENT: automatic link preview. Pre-rendered thumbnail manifest. Never
// rejects — a missing/broken manifest just disables previews, nothing breaks.
function loadLinkPreviews() {
    return fetch('data/link_previews.json')
        .then(res => (res.ok ? res.json() : {}))
        .catch(() => ({}));
}

// Build metadata (data/meta.json, written by the daily build). Never rejects;
// a missing file just leaves the "Updated on" chip hidden.
function loadMeta() {
    return fetch('data/meta.json')
        .then(res => (res.ok ? res.json() : null))
        .catch(() => null);
}

// "Updated <date>" chip in the results bar — the daily data-refresh date from
// meta.generated_at_utc. Self-contained (no dependency on the nested date
// helpers) so it can run from the top-level load flow.
function setDataUpdated(meta) {
    if (!meta || !meta.generated_at_utc) return;
    const dt = new Date(meta.generated_at_utc);
    if (Number.isNaN(dt.getTime())) return;
    const text = 'Updated ' + dt.toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric'
    });
    // Show it in the disclaimer footer (bottom-right). That footer is injected by
    // the deferred site-widgets.js, so retry until it exists.
    let tries = 0;
    const place = () => {
        const foot = document.querySelector('.sw-footer');
        if (!foot) return false;
        let span = foot.querySelector('.sw-updated');
        if (!span) {
            span = document.createElement('span');
            span.className = 'sw-updated';   // positioned bottom-right by site-widgets CSS
            foot.appendChild(span);
        }
        span.textContent = text;
        return true;
    };
    if (place()) return;
    const t = setInterval(() => { if (place() || ++tries > 25) clearInterval(t); }, 200);
}

// Returns a data-link-preview="<path>" attribute for an item's notification
// link if a thumbnail exists, else ''. Stamped onto the notification <a> tags.
function notifPreviewAttr(item) {
    const src = linkPreviews[safe(item && item.Vacancy_ID)];
    return src ? ` data-link-preview="${escapeHtml(src)}"` : '';
}

// EXPERIMENT: automatic link preview — a floating thumbnail of the notification
// document that fades in by the cursor on hover and follows it. Fine-pointer
// (desktop) only; touch gets nothing. Revert the whole feature by removing this
// function + its call, the notifPreviewAttr() calls, loadLinkPreviews(), and
// the fenced #linkPreviewCard CSS block.
function initLinkPreview() {
    if (!window.matchMedia || !window.matchMedia('(pointer: fine)').matches) return;
    if (document.getElementById('linkPreviewCard')) return; // run once

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const card = document.createElement('div');
    card.id = 'linkPreviewCard';
    card.setAttribute('aria-hidden', 'true');
    // Inner element carries the reveal/hide animation (scale + slide + fade);
    // the wrapper only ever gets a translate from JS, so follow stays instant.
    const inner = document.createElement('div');
    inner.className = 'lp-inner';
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    const cap = document.createElement('span');
    cap.className = 'lp-cap';
    cap.textContent = 'Official Notification';
    inner.append(img, cap);
    card.appendChild(inner);
    document.body.appendChild(card);

    const OFFSET = 18;   // gap from the cursor
    const DELAY = 120;   // hover dwell before the card appears
    let current = null;  // the <a> currently previewed
    let showTimer = 0;
    let visible = false;
    let lastX = 0, lastY = 0;

    const hide = () => {
        clearTimeout(showTimer);
        showTimer = 0;
        current = null;
        if (!visible) return;
        visible = false;
        card.classList.remove('show');
    };

    const place = (x, y) => {
        const w = card.offsetWidth || 240;
        const h = card.offsetHeight || 180;
        let left = x + OFFSET;
        let top = y + OFFSET;
        if (left + w > window.innerWidth - 8) left = x - OFFSET - w;  // flip left
        if (top + h > window.innerHeight - 8) top = y - OFFSET - h;   // flip up
        card.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
    };

    img.addEventListener('error', hide);                 // 404 / decode fail → no card
    img.addEventListener('load', () => { if (current) place(lastX, lastY); });

    document.addEventListener('pointerover', (e) => {
        const a = e.target.closest && e.target.closest('[data-link-preview]');
        if (!a || a === current) return;
        current = a;
        const src = a.getAttribute('data-link-preview');
        clearTimeout(showTimer);
        showTimer = setTimeout(() => {
            if (current !== a) return;
            if (img.getAttribute('src') !== src) img.src = src;
            place(lastX, lastY);
            visible = true;
            card.classList.add('show');
        }, reduce ? 0 : DELAY);
    });

    document.addEventListener('pointermove', (e) => {
        lastX = e.clientX; lastY = e.clientY;
        if (visible) place(lastX, lastY);
    });

    document.addEventListener('pointerout', (e) => {
        const a = e.target.closest && e.target.closest('[data-link-preview]');
        if (a && a === current && (!e.relatedTarget || !a.contains(e.relatedTarget))) hide();
    });

    window.addEventListener('scroll', hide, { passive: true });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

function hydrateFiltersFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        if (![...params.keys()].length) return;

        const setIfPresent = (param, el) => {
            if (!el) return;
            const val = params.get(param);
            if (val == null) return;
            el.value = val;
        };
        setIfPresent('search', searchPost);
        setIfPresent('myPayLevel', filterMyPayLevel);
        setIfPresent('experience', filterExperience);
        setIfPresent('level', filterLevel);
        setIfPresent('ministry', filterMinistry);
        setIfPresent('orgType', filterOrgType);
        setIfPresent('region', filterRegion);
        // multi-select: ?location=a,b,c
        if (params.has('location')) {
          const arr = (params.get('location') || '').split(',').map(s => s.trim()).filter(Boolean);
          if (arr.length) filterLocation.__pendingValues = arr;
        }
        if (params.has('status')) filterStatus.value = params.get('status');

        const quick = (params.get('quick') || '').split(',').filter(Boolean);
        if (quick.includes('newOnly')) quickFilters.newOnly = true;
        if (quick.includes('closing7')) quickFilters.closing7 = true;
        if (quick.includes('closingToday')) quickFilters.closingToday = true;
        if (quick.includes('delhiNcr')) quickFilters.delhiNcr = true;

        if (params.get('watchlist') === '1') showWatchlistOnly = true;
    } catch (e) {
        console.warn('URL param hydration skipped:', e);
    }
}

/* ---------------- Permalinks (?v=<Vacancy_ID>) ---------------- */

function getUrlVacancyId() {
    try { return new URLSearchParams(window.location.search).get('v') || ''; } catch (e) { return ''; }
}

// Clean canonical share link — never leaks the user's personal filter params.
function buildShareUrl(vacancyId) {
    return `${window.location.origin}/?v=${encodeURIComponent(safe(vacancyId))}`;
}

// Open the detail view for a ?v= deep link on cold load (data just rendered).
function openVacancyFromUrl() {
    const id = getUrlVacancyId();
    if (!id) return;
    if (getItemById(id)) {
        openVacancyModal(id, { push: false });
    } else {
        showHomeToast('That vacancy is no longer listed.');
        const url = new URL(window.location.href);
        url.searchParams.delete('v');
        history.replaceState(null, '', url);
    }
}

// Best-effort structured data for the top active vacancies. Injected client-side,
// which only Google's renderer reliably reads — harmless elsewhere.
function injectJsonLd() {
    try {
        const old = document.getElementById('vxJsonLd');
        if (old) old.remove();
        const items = rawData
            .filter(i => safe(i.Status) === 'Active')
            .slice(0, 25)
            .map((i, idx) => ({
                '@type': 'ListItem',
                position: idx + 1,
                name: `${safe(i.Post_Name)} — ${safe(i.Ministry)}`,
                url: buildShareUrl(i.Vacancy_ID),
            }));
        if (!items.length) return;
        const s = document.createElement('script');
        s.type = 'application/ld+json';
        s.id = 'vxJsonLd';
        s.textContent = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: 'Central Government Deputation Vacancies',
            itemListElement: items,
        });
        document.head.appendChild(s);
    } catch (e) { /* non-fatal */ }
}

/* ---------------- Share helpers ---------------- */

/**
 * Compact "Employment News edition + page" badge used under the Source PDF
 * link in table + card views. Mirrors the modal's "pNN of <edition>" phrasing
 * (see buildModalContent). When Source_Page is missing, falls back to just
 * the edition string so every row that has a Source Category still shows it.
 * Returns '' if neither field is populated.
 */
function formatSourceBadge(item) {
  const cat = safe(item['Source Category']);
  const page = safe(item.Source_Page);
  if (!cat) return '';
  if (page) return `p${page} of ${cat}`;
  return cat;
}

/**
 * Shorter, cell-friendly form of the badge. The full edition string
 * ("Employment News (11-17 Apr 2026)") clips inside the 108 px table cell;
 * the EN- prefix is a stable marker so the tooltip always carries the full
 * title even on rows whose in-cell text already starts with "EN".
 *
 * Returns { short, full } so callers can render the compact text in-cell
 * and use the full `Source Category` (or page + category) as the title=
 * tooltip. Returns null if there's nothing to show.
 */
const _EN_MONTHS = { jan:'Jan', feb:'Feb', mar:'Mar', apr:'Apr', may:'May',
  jun:'Jun', jul:'Jul', aug:'Aug', sep:'Sep', oct:'Oct', nov:'Nov', dec:'Dec' };
function formatSourceBadgeShort(item) {
  const cat = safe(item['Source Category']);
  const page = safe(item.Source_Page);
  if (!cat) return null;
  // Try to extract a day + month + year from the edition string. Works for
  // both shapes present in the dataset: "EN 09-15 May 2026" and
  // "Employment News (11-17 Apr 2026)". The first day number wins (ranges
  // collapse to start day — same trade-off as enrich.js#enIssueCompact).
  const norm = cat.replace(/^employment news\s*/i, '').replace(/^EN\s*/i, '').replace(/[()]/g, '');
  // Day match tolerates ordinal suffixes like "20th-26th" — strip trailing
  // letters before matching so "20th" still extracts as 20.
  const dayMatch = norm.match(/\b(\d{1,2})(?=[a-zA-Z\s-]|$)/);
  const monMatch = norm.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i);
  const yearMatch = norm.match(/\b(\d{4})\b/);
  let compact = '';
  if (dayMatch && monMatch && yearMatch) {
    const day = parseInt(dayMatch[1], 10);
    const mon = _EN_MONTHS[monMatch[1].slice(0, 3).toLowerCase()];
    const yy = yearMatch[1].slice(-2);
    compact = `EN- ${day} ${mon} ${yy}`;
  } else {
    // Fallback: strip the "Employment News" wrapper if any; leave other
    // sources (e.g. "Circular") untouched.
    compact = cat.replace(/^employment news\s*/i, 'EN- ');
  }
  // Tooltip always carries the full edition string (and page if present),
  // matching the modal's phrasing so users see one consistent label.
  const full = page ? `p${page} of ${cat}` : cat;
  return { short: page ? `p${page} of ${compact}` : compact, full };
}

function buildShareText(item) {
    const lines = [`📢 ${safe(item.Post_Name) || 'Deputation vacancy'} — ${withAcronym(item.Ministry) || ''}`.trim()];
    const lvl = safe(item.Level_Text);
    const elig = safe(item.eligibility_tiers_text) || formatEligibility(item);
    if (lvl) lines.push(`Level: ${lvl}${elig && elig !== 'Not specified' ? ` · Eligible: ${elig}` : ''}`);
    const loc = formatLocation(item);
    if (loc) lines.push(`Location: ${loc}`);
    const daysLeft = parseInt(item.Days_Left, 10);
    const closing = formatDisplayDate(safe(item.Last_Date_To_Apply));
    if (closing && closing !== 'Not specified') {
        lines.push(`Closes: ${closing}${!Number.isNaN(daysLeft) && daysLeft >= 0 ? ` (${formatDaysLeft(daysLeft)})` : ''}`);
    }
    lines.push(buildShareUrl(item.Vacancy_ID));
    return lines.join('\n');
}

function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')); }
        catch (e) { reject(e); }
        finally { ta.remove(); }
    });
}

function shareVacancy(vacancyId) {
    const item = getItemById(vacancyId);
    if (!item) return;
    const text = buildShareText(item);
    const url = buildShareUrl(vacancyId);
    if (navigator.share) {
        navigator.share({ title: safe(item.Post_Name), text, url }).catch(() => {});
        return;
    }
    copyTextToClipboard(`${text}`)
        .then(() => showHomeToast('Vacancy details &amp; link copied — paste anywhere.'))
        .catch(() => showHomeToast('Could not copy — long-press the address bar to share.'));
}

function getDateSortValue(value) {
  const raw = safe(value);
  if (!raw) return 0;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return 0;

  return parsed.getTime();
}
    
    function initializeEnhancements() {
        createSearchDatalist();
        createQuickFiltersBar();
    }

    function createSearchDatalist() {
        searchDatalist = document.createElement('datalist');
        searchDatalist.id = 'searchSuggestionsList';
        document.body.appendChild(searchDatalist);
        searchPost.setAttribute('list', 'searchSuggestionsList');
    }

    function createQuickFiltersBar() {
        quickFiltersBar = document.getElementById('quickFiltersBar');
    }

    function initializeMobileFilterAccordion() {
    if (!filtersSidebar) return;

    let toggleBtn = filtersSidebar.querySelector('.mobile-filter-toggle');

    if (!toggleBtn) {
        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'mobile-filter-toggle';
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.innerHTML = `
            <span class="mobile-filter-toggle-left">
                ${svgIcon('sliders')}
                <span class="mobile-filter-toggle-label">Show Filters</span>
            </span>
            <span class="mobile-filter-toggle-right">
                ${svgIcon('chevron-down', 'mobile-filter-chevron')}
            </span>
        `;
        filtersSidebar.insertBefore(toggleBtn, filtersSidebar.firstChild);
    }

    toggleBtn.addEventListener('click', () => {
        if (window.innerWidth > 768) return;

        filtersSidebar.classList.toggle('collapsed');
        updateMobileFilterToggle();
    });

    applyMobileFilterDefaultState();
    window.addEventListener('resize', applyMobileFilterDefaultState);
}

// EXPERIMENT: collapsible desktop filters — a compact "My Pay Level"-only card
// sits beside the KPIs by default (body.filters-collapsed, set in the markup so
// there's no flash); "Show more filters" restores the full left sidebar.
// Mobile (≤768px) keeps its own Show Filters accordion untouched.
// Reading/scroll progress bar (matches the Rules page). Widens the fixed top
// bar in proportion to how far the page is scrolled; throttled via rAF.
function setupScrollProgress() {
  const bar = document.getElementById('scrollProgress');
  if (!bar) return;
  let ticking = false;
  const update = () => {
    const h = document.documentElement;
    const max = (h.scrollHeight - h.clientHeight) || 1;
    bar.style.width = Math.min(100, (h.scrollTop / max) * 100) + '%';
    ticking = false;
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
}

function initDesktopFilterCollapse() {
  const btn = document.getElementById('desktopFilterToggle');
  if (!btn) return;
  const label = btn.querySelector('span');
  const sidebar = document.querySelector('.filters-sidebar');

  const applyLabel = (expanded) => {
    btn.setAttribute('aria-expanded', String(expanded));
    if (label) label.textContent = expanded ? 'Hide filters' : 'Many more filters';
  };
  const applyLayout = (expanded) => {
    document.body.classList.toggle('filters-collapsed', !expanded);
    updateHiddenFilterCue(); // cue only shows while collapsed
  };

  // Initial state comes from the markup: index.html ships
  // body.filters-collapsed, and its wide-default boot script drops that class
  // on ultra-wide screens (≥1600px) before first paint. Toggling by hand stays
  // a per-visit choice — nothing is remembered across loads.
  let expanded = !document.body.classList.contains('filters-collapsed');
  applyLayout(expanded);
  applyLabel(expanded);

  // Sequenced morph: rows shift before the filter content drops in (expand),
  // filter content folds before the rows expand back (collapse). Reuses the
  // existing vt-filters View Transition for the grid-template swap.
  let busy = false;
  const FOLD_MS = 380;       // matches CSS .filter-group transition + stagger
  const REVEAL_DELAY = 40;   // let the VT settle before content unfurls

  const waitFold = () => new Promise((resolve) => {
    if (!sidebar) return resolve();
    const groups = sidebar.querySelectorAll('.filter-group:not(.fg-primary)');
    if (!groups.length) return resolve();
    let done = false;
    const last = groups[groups.length - 1];
    const onEnd = (e) => {
      if (e.propertyName !== 'max-height') return;
      done = true;
      last.removeEventListener('transitionend', onEnd);
      resolve();
    };
    last.addEventListener('transitionend', onEnd);
    // Fallback in case transitionend doesn't fire (display:none ancestors, etc.)
    setTimeout(() => { if (!done) { last.removeEventListener('transitionend', onEnd); resolve(); } }, FOLD_MS + 120);
  });

  btn.addEventListener('click', async () => {
    if (busy) return;
    const motionOk = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canVT = typeof document.startViewTransition === 'function';
    const next = !expanded;

    if (!motionOk || !canVT) {
      expanded = next;
      applyLayout(expanded);
      applyLabel(expanded);
      return;
    }

    busy = true;
    applyLabel(next); // flip label/aria immediately so spam-clicks see latest

    try {
      if (next) {
        // EXPAND: phase 1 — rows shift right (VT layout morph, sidebar empty);
        // phase 2 — filter groups cascade into the freed column.
        document.body.classList.add('filters-pending-reveal');
        document.documentElement.classList.add('vt-filters');
        const t = document.startViewTransition(() => applyLayout(true));
        await t.finished.catch(() => {});
        document.documentElement.classList.remove('vt-filters');
        // small beat, then drop the gate → CSS reveal kicks in with stagger
        await new Promise((r) => setTimeout(r, REVEAL_DELAY));
        document.body.classList.remove('filters-pending-reveal');
      } else {
        // COLLAPSE: phase 1 — fold filter groups while sidebar still occupies
        // the left column; phase 2 — VT morphs rows back to full width.
        document.body.classList.add('filters-folding');
        await waitFold();
        document.documentElement.classList.add('vt-filters');
        const t = document.startViewTransition(() => {
          applyLayout(false);
          document.body.classList.remove('filters-folding');
        });
        await t.finished.catch(() => {});
        document.documentElement.classList.remove('vt-filters');
      }
      expanded = next;
    } finally {
      busy = false;
    }
  });
}

function applyMobileFilterDefaultState() {
    if (!filtersSidebar) return;

    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
        if (!filtersSidebar.dataset.mobileAccordionInitialized) {
            filtersSidebar.classList.add('collapsed');
            filtersSidebar.dataset.mobileAccordionInitialized = 'true';
        }
    } else {
        filtersSidebar.classList.remove('collapsed');
        delete filtersSidebar.dataset.mobileAccordionInitialized;
    }

    updateMobileFilterToggle();
}

function updateMobileFilterToggle() {
    const toggleBtn = filtersSidebar?.querySelector('.mobile-filter-toggle');
    if (!toggleBtn) return;

    const expanded = !filtersSidebar.classList.contains('collapsed');
    const label = toggleBtn.querySelector('.mobile-filter-toggle-label');

    if (label) {
        label.textContent = expanded ? 'Hide Filters' : 'Show Filters';
    }

    toggleBtn.setAttribute('aria-expanded', String(expanded));
}

    function setLoadingUI() {
        // The page renders its FULL real structure immediately — proper KPI
        // cards with placeholder values and correctly shaped row/card shimmers
        // — so the first paint never looks empty; data drops in when it lands.
        kpiGrid.innerHTML = [
            ['Total Vacancies', 'briefcase', 'cyan'],
            ['Active', 'check-circle', 'green'],
            ['Closing Soon', 'clock', 'red'],
            ['Ministries', 'building', 'purple'],
        ].map(([title, icon, tone]) => `
            <div class="kpi-card kpi-${tone} kpi-skeleton shimmer" aria-hidden="true">
                <div class="kpi-icon">${svgIcon(icon)}</div>
                <div class="kpi-title">${title}</div>
                <div class="kpi-value">—</div>
                <div class="kpi-trend flat">Loading…</div>
            </div>
        `).join('');

        const cardsLikely = window.innerWidth <= 768 || currentView === 'card';
        dataContainer.innerHTML = cardsLikely
            ? `
            <div class="sk-grid" aria-hidden="true">
                ${'<div class="sk-card shimmer"></div>'.repeat(6)}
            </div>`
            : `
            <div class="loading-table-shell" aria-hidden="true">
                ${'<div class="loading-row shimmer"></div>'.repeat(8)}
            </div>`;
    }

    // ---- dialog ↔ history bookkeeping (permalink ?v=) ----
    let modalPushed = false;          // we added a history entry on open
    let suppressHistoryClose = false; // close came FROM popstate — don't go back again

    function syncUrlOnClose() {
        if (suppressHistoryClose) {
            suppressHistoryClose = false;
            modalPushed = false;
            return;
        }
        if (modalPushed) {
            modalPushed = false;
            history.back(); // restores the pre-open URL (filters intact)
            return;
        }
        // cold-loaded dialog (?v= arrived in the address bar): just strip v
        try {
            const url = new URL(window.location.href);
            if (url.searchParams.has('v')) {
                url.searchParams.delete('v');
                history.replaceState(null, '', url);
            }
        } catch (e) {}
    }

    function initializeModal() {
  if (modal && modal.dataset.bound === 'true') return;
  if (modal) {
    modal.dataset.bound = 'true';
  }

  if (closeModalBtn && !closeModalBtn.dataset.bound) {
    closeModalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeVacancyModal();
    });
    closeModalBtn.dataset.bound = 'true';
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      // a click on the <dialog> element itself = the backdrop padding area
      if (e.target === modal) {
        closeVacancyModal();
        return;
      }

      const shareWa = e.target.closest('[data-modal-action="share-wa"]');
      if (shareWa) {
        const item = getItemById(shareWa.getAttribute('data-id'));
        if (item) window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText(item))}`, '_blank', 'noopener');
        return;
      }

      const copyLink = e.target.closest('[data-modal-action="copy-link"]');
      if (copyLink) {
        copyTextToClipboard(buildShareUrl(copyLink.getAttribute('data-id')))
          .then(() => showHomeToast('Link copied — share it anywhere.'))
          .catch(() => showHomeToast('Could not copy the link.'));
        return;
      }

      const shareNative = e.target.closest('[data-modal-action="share-native"]');
      if (shareNative) {
        shareVacancy(shareNative.getAttribute('data-id'));
        return;
      }

      const modalWatchBtn = e.target.closest('[data-modal-action="watchlist"]');
      if (!modalWatchBtn) return;

      const vacancyId = modalWatchBtn.getAttribute('data-id');
      const alreadySaved = watchlist.has(safe(vacancyId));

      toggleWatchlist(vacancyId);
      renderDashboard(false);

      if (!alreadySaved) {
        animateBookmarkButton(vacancyId);
      }

      if (showWatchlistOnly && alreadySaved) {
        closeVacancyModal();
      } else {
        openVacancyModal(vacancyId, { push: false });
      }
    });

    // Native close (Esc → `cancel` → close, the X button, backdrop click):
    // clear the body and reconcile the URL/history exactly once, here.
    modal.addEventListener('close', () => {
      if (modalBody) modalBody.innerHTML = '';
      document.body.classList.remove('vxd-open');
      syncUrlOnClose();
    });
  }

  // Back/forward buttons open or close the dialog to match ?v= in the URL.
  window.addEventListener('popstate', () => {
    const id = getUrlVacancyId();
    if (id && getItemById(id)) {
      openVacancyModal(id, { push: false });
    } else if (modal && modal.open) {
      suppressHistoryClose = true;
      modal.close();
    }
  });
}

/* Two-stage approval (0017_admin_verified.sql). A row published in bulk is live
 * before any admin has read it; a verified row has been checked.
 *
 * This is expressed as nothing more than the colour of the row's leading edge —
 * amber for pending, green for checked. It is background reassurance, not an
 * announcement: a visitor who never notices it loses nothing, and one who
 * wonders how vetted a listing is has an answer without the row shouting a
 * warning at them.
 *
 * Three states, not two. A missing key means the data source predates the flag
 * (a stale bundled JSON, or the legacy spreadsheet), which is NOT the same as
 * "unverified" — those rows get no edge at all, because colouring the whole
 * back catalogue amber would be a loud wrong answer. Handles both value shapes:
 * the live API yields a real boolean, the bundled JSON whatever build_data.py
 * wrote.
 */
function verificationClass(item) {
  const v = item.Admin_Verified;
  if (v === undefined || v === null || v === '') return '';
  const verified = typeof v === 'boolean'
    ? v
    : String(v).trim().toLowerCase() !== 'false';
  return verified ? 'vx-verif-ok' : 'vx-verif-pending';
}

function orgDisplayName(item) {
  return safe(item.Organisation) || safe(item.Department) || safe(item.Department_Organisation) || '';
}

function renderTable(data) {
  const hasSavedAny = watchlist.size > 0;

  const rows = data.map((item) => {
    const vacancyId = safe(item.Vacancy_ID);
    const saved = watchlist.has(vacancyId);
    const daysLeft = parseInt(item.Days_Left, 10);
    const notificationLink = normalizeUrl(safe(item.Official_Notification_Link));

    const notificationDateDisplay = formatDisplayDate(safe(item.Notification_Date));
    const notificationDateText =
      notificationDateDisplay && notificationDateDisplay !== 'Not specified'
        ? notificationDateDisplay
        : '—';

    return `
      <tr class="clickable-row ${saved ? 'row-bookmarked' : ''} ${verificationClass(item)}" data-open-details="${escapeHtml(vacancyId)}">
        <td class="post-col" data-label="Post Name">
          <strong>${escapeHtml(safe(item.Post_Name) || '—')}</strong>${isNewVacancy(item) ? ' <span class="vx-new table-new" title="Added in the last 7 days">NEW</span>' : ''}
          ${(() => {
            // Phase 2 item 8: the organisation is clamped to two lines in CSS
            // to stop it driving row height, so carry the full string in a
            // title for the names that get cut.
            const org = safe(item.Department_Organisation) || orgDisplayName(item) || '';
            return `<div class="table-subtext"${org ? ` title="${escapeHtml(org)}"` : ''}>
            ${escapeHtml(org)}
          </div>`;
          })()}
        </td>

        <td class="level-col" data-label="Level">
          ${escapeHtml(safe(item.Level_Text) || '—')}
        </td>

        <td class="eligibility-col" data-label="Eligibility">
          ${escapeHtml(formatEligibility(item))}
        </td>

        <td class="ministry-col" data-label="Ministry">
          ${escapeHtml(withAcronym(item.Ministry) || '—')}
        </td>

        <td class="org-col" data-label="Org.">
          ${escapeHtml(orgAcronym(item) || '—')}
        </td>

        ${(() => {
          // Posts spanning many offices carry a very long location string —
          // the worst live example is 167 characters across 8 cities and 7
          // states — which wrapped to a 362px row beside 110px neighbours.
          // Clamped to two lines in CSS; the full list stays in the title and
          // in the row's modal, so nothing is lost.
          const loc = formatLocation(item) || '—';
          return `<td class="location-col" data-label="Location"${loc !== '—' ? ` title="${escapeHtml(loc)}"` : ''}>
          <div class="loc-clamp">${escapeHtml(loc)}</div>
        </td>`;
        })()}

        <td class="days-col" data-label="Days Left">
          <span class="days-pill days-pill-${getDaysLeftTone(daysLeft)}">
            ${escapeHtml(formatDaysLeft(daysLeft))}
          </span>
          ${(() => {
            const d = safe(item.Last_Date_To_Apply_Display) || formatDisplayDate(safe(item.Last_Date_To_Apply));
            return d && d !== 'Not specified' ? `<span class="days-date-sub">${escapeHtml(d)}</span>` : '';
          })()}
        </td>

        <td class="notification-date-col" data-label="Notification Date">
          ${escapeHtml(notificationDateText)}
        </td>

        <td class="table-link-cell" data-label="Source PDF">
          ${notificationLink ? `
            <a
              class="table-link-btn"
              href="${escapeHtml(notificationLink)}"
              target="_blank"
              rel="noopener noreferrer"
              onclick="event.stopPropagation();"${notifPreviewAttr(item)}
            >
              Source PDF
            </a>
          ` : '—'}
          ${(() => {
            const b = formatSourceBadgeShort(item);
            return b ? `<div class="table-source-line"><span class="source-badge" title="${escapeHtml(b.full)}">${escapeHtml(b.short)}</span></div>` : '';
          })()}
        </td>

        <td class="table-heart-cell save-col" data-label="Bookmark">
          <button
            type="button"
            class="table-heart-btn ${saved ? 'saved' : ''}"
            data-table-action="watchlist"
            data-id="${escapeHtml(vacancyId)}"
            title="Bookmark the Vacancy"
            aria-label="${saved ? 'Remove bookmarked vacancy' : 'Bookmark the Vacancy'}"
            aria-pressed="${saved ? 'true' : 'false'}"
          >
            ${svgIcon('heart')}
          </button>
        </td>
      </tr>
    `;
  }).join('');

  return `
    <div class="table-wrapper">
      <table class="data-table responsive-table">
        <thead>
          <tr>
            ${renderSortableHeader('Post Name', 'Post_Name', 'post-col')}
            ${renderSortableHeader('Level', 'Level_Text', 'level-col')}
            ${renderSortableHeader('Eligibility', 'Eligibility', 'eligibility-col')}
            ${renderSortableHeader('Ministry', 'Ministry', 'ministry-col')}
            ${renderSortableHeader('Org.', 'Org', 'org-col')}
            ${renderSortableHeader('Location', 'Location', 'location-col')}
            ${renderSortableHeader('Days Left', 'Days_Left', 'days-col')}
            ${renderSortableHeader('Notification Date', 'Notification_Date', 'notification-date-col')}
            <th class="table-link-cell">Source PDF</th>
            <th
              class="save-col save-col-heading ${hasSavedAny ? 'has-saved' : ''}"
              title="${hasSavedAny ? 'Bookmarks saved' : 'No bookmarks yet'}"
              aria-label="Bookmark"
            >
              ${svgIcon('bookmark')}
            </th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
    
    function populateFilters() {
        // Counts everywhere are based on the ACTIVE subset, so each "(N)" matches
        // what you see when that option is picked (the list defaults to Active).
        // These are a fixed property of the dataset (they don't change as the user
        // changes filters), so we tally them ONCE here — in a single pass — rather
        // than recomputing per filter change.
        const activeRows = [];
        const levelCounts = {}, ministryCounts = {}, locationCounts = {}, orgTypeCounts = {}, regionCounts = {};
        let inactiveCount = 0;
        rawData.forEach(i => {
            const st = safe(i.Status);
            if (st === 'Active') {
                activeRows.push(i);
                const lv = safe(i.Level_Text);   if (lv)  levelCounts[lv]    = (levelCounts[lv]    || 0) + 1;
                const mn = safe(i.Ministry);      if (mn)  ministryCounts[mn] = (ministryCounts[mn] || 0) + 1;
                const loc = formatLocation(i);    if (loc) locationCounts[loc] = (locationCounts[loc] || 0) + 1;
                const ot = safe(i.Organisation_Type); if (ot) orgTypeCounts[ot] = (orgTypeCounts[ot] || 0) + 1;
                const rg = safe(i.Region);        if (rg)  regionCounts[rg]   = (regionCounts[rg]   || 0) + 1;
            } else if (st === 'Inactive') {
                inactiveCount++;
            }
        });
        const isEligibleFn = (window.DepEnrich && window.DepEnrich.isEligible)
            ? window.DepEnrich.isEligible : null;

        // MY PAY LEVEL — all grades 18…1 (13A between 14 & 13); "(N)" = active
        // vacancies you'd be eligible for at that level (experience-independent).
        const myLevelValues = [];
        for (let i = 18; i >= 1; i--) { myLevelValues.push(String(i)); if (i === 14) myLevelValues.push('13A'); }
        const myPayLevelItems = [{ value: '', name: 'Any Level', count: null }].concat(
            myLevelValues.map(v => ({
                value: v,
                name: `Level ${v}`,
                count: isEligibleFn ? activeRows.filter(it => isEligibleFn(it, v, '')).length : null,
            }))
        );
        filterMyPayLevel.populate(myPayLevelItems);

        // MY YEARS OF EXPERIENCE — themed look, no count (only meaningful with a level).
        if (filterExperience) {
            const expItems = [{ value: '', name: 'Any', count: null }];
            for (let y = 0; y <= 10; y++) {
                expItems.push({
                    value: String(y),
                    name: y === 10 ? '10+ years' : (y === 1 ? '1 year' : `${y} years`),
                    count: null,
                });
            }
            filterExperience.populate(expItems);
            syncExperienceState();
        }

        // PAY LEVEL — active vacancies per level, high → low, only levels with ≥1 active.
        const levels = Object.keys(levelCounts).sort((a, b) => {
            const va = parseLevelValue(a), vb = parseLevelValue(b);
            if (va == null && vb == null) return a.localeCompare(b);
            if (va == null) return 1;
            if (vb == null) return -1;
            if (vb !== va) return vb - va;            // higher pay level first
            return a.localeCompare(b);
        });
        filterLevel.populate([{ value: '', name: 'All Levels', count: null }].concat(
            levels.map(value => ({ value, name: value, count: levelCounts[value] }))
        ));

        // MINISTRY — active vacancies per ministry (only ministries with ≥1 active).
        const ministries = Object.keys(ministryCounts).sort((a, b) => a.localeCompare(b));
        filterMinistry.populate([{ value: '', name: 'All Ministries', count: null }].concat(
            ministries.map(m => ({ value: m, name: m, count: ministryCounts[m] }))
        ));

        // ORGANISATION TYPE — active vacancies per type, most common first.
        const orgTypes = Object.keys(orgTypeCounts).sort((a, b) =>
            (orgTypeCounts[b] - orgTypeCounts[a]) || a.localeCompare(b));
        filterOrgType.populate([{ value: '', name: 'All Types', count: null }].concat(
            orgTypes.map(t => ({ value: t, name: t, count: orgTypeCounts[t] }))
        ));

        // REGION — derived client-side from the location's state (enrich.js). Shown
        // in a fixed geographic order; only regions with ≥1 active vacancy appear.
        const REGION_ORDER = ['North', 'South', 'East', 'West', 'Central', 'NorthEast'];
        const REGION_LABEL = { NorthEast: 'North-East' };
        const regions = Object.keys(regionCounts).sort((a, b) => {
            const ia = REGION_ORDER.indexOf(a), ib = REGION_ORDER.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
        });
        filterRegion.populate([{ value: '', name: 'All Regions', count: null }].concat(
            regions.map(r => ({ value: r, name: REGION_LABEL[r] || r, count: regionCounts[r] }))
        ));

        // STATUS — count per status. Preserve the default "Active" selection.
        filterStatus.populate([
            { value: '', name: 'All', count: null },
            { value: 'Active', name: 'Active', count: activeRows.length },
            { value: 'Inactive', name: 'Inactive', count: inactiveCount },
        ]);
        if (!filterStatus.value) filterStatus.value = 'Active';

        // LOCATION — active vacancies per location (gradient "(N)" on each option).
        const locations = Object.keys(locationCounts).sort((a, b) => a.localeCompare(b));
        filterLocation.populate(locations, locationCounts);
        if (filterLocation.__pendingValues) {
            filterLocation.setValues(filterLocation.__pendingValues);
            delete filterLocation.__pendingValues;
        }
    }

    function buildSearchSuggestions() {
        const suggestionSet = new Set();

        rawData.forEach(item => {
            [
                item.Post_Name,
                item.Ministry,
                item.Organisation,          // see searchableText: the real field
                item.Department_Organisation,
                item.Location_City,
                item.Location_State
            ].forEach(value => {
                const text = safe(value);
                if (text && text.length >= 3) {
                    suggestionSet.add(text);
                }
            });
        });

        searchSuggestions = [...suggestionSet]
            .sort((a, b) => a.localeCompare(b))
            .slice(0, 250);

        refreshSearchSuggestions('');
    }

    // Typewriter-cycle the search placeholder through several angles so users see
    // they can search by more than the post name. Pauses while the box is focused
    // or has text; shows a static hint under prefers-reduced-motion.
    function cycleSearchPlaceholder(input) {
        if (!input) return;
        // Only the moving word gets the gradient; "Search by" stays solid.
        const hints = ['post name', 'keywords', 'location', 'department', 'organisation', 'Ministry'];
        const ph = input.closest('.input-icon') && input.closest('.input-icon').querySelector('.search-ph');
        // No overlay element → fall back to the native placeholder.
        if (!ph) { input.placeholder = 'Search by post, keywords, ministry…'; return; }
        // Match the input's font so the overlay lines up exactly with typed text.
        const cs = getComputedStyle(input);
        ph.style.fontSize = cs.fontSize;
        ph.style.fontFamily = cs.fontFamily;
        ph.style.letterSpacing = cs.letterSpacing;
        ph.innerHTML = 'Search by <span class="search-ph-word"></span>';
        const word = ph.querySelector('.search-ph-word');
        input.placeholder = '';                          // overlay replaces it
        const show = (on) => { ph.style.display = on ? '' : 'none'; };
        input.addEventListener('input', () => show(input.value.length === 0));
        const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduced) { word.textContent = 'post, keywords, ministry…'; show(input.value.length === 0); return; }
        let hi = 0, ci = 0, erasing = false;
        (function tick() {
            if (input.value.length > 0) { show(false); setTimeout(tick, 700); return; }
            show(true);
            if (document.activeElement === input) { setTimeout(tick, 500); return; } // freeze while focused
            const w = hints[hi];
            if (!erasing) {
                ci++;
                word.textContent = w.slice(0, ci) + '…';
                if (ci >= w.length) { erasing = true; setTimeout(tick, 1500); return; }
                setTimeout(tick, 70);
            } else {
                ci--;
                word.textContent = w.slice(0, ci) + (ci ? '…' : '');
                if (ci <= 0) { erasing = false; hi = (hi + 1) % hints.length; setTimeout(tick, 350); return; }
                setTimeout(tick, 35);
            }
        })();
    }

    function bindEvents() {
  // Debounce the full re-filter + rebuild (150ms); suggestions stay instant.
  let searchDebounceTimer = null;
  searchPost.addEventListener('input', () => {
    refreshSearchSuggestions(searchPost.value);
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(onFilterChange, 150);
  });
  cycleSearchPlaceholder(searchPost);

  [
    filterMyPayLevel,
    filterExperience,
    filterLevel,
    filterMinistry,
    filterOrgType,
    filterRegion,
    filterLocation,
    filterStatus
  ].forEach((el) => {
    el.addEventListener('change', onFilterChange);
  });

  if (quickFiltersBar) {
    quickFiltersBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quick-filter]');
      if (!btn) return;

      const key = btn.getAttribute('data-quick-filter');
      if (!Object.prototype.hasOwnProperty.call(quickFilters, key)) return;

      quickFilters[key] = !quickFilters[key];
      pagination.currentPage = 1;
      pagination.pagesShown = 1;
      updateQuickFiltersBar();
      vtDiscrete = true;
      renderDashboard();
    });
  }

  clearFiltersBtn.addEventListener('click', () => {
    searchPost.value = '';
    filterMyPayLevel.value = '';
    if (filterExperience) filterExperience.value = '';
    filterLevel.value = '';
    filterMinistry.value = '';
    filterOrgType.value = '';
    filterRegion.value = '';
    filterLocation.setValues([]);
    filterStatus.value = 'Active';
    showWatchlistOnly = false;
    kpiFilter = 'all';

    quickFilters = {
      newOnly: false,
      closing7: false,
      delhiNcr: false,
      closingToday: false
    };

    pagination.currentPage = 1;
    pagination.pagesShown = 1;
    updateQuickFiltersBar();
    vtDiscrete = true;
    renderDashboard();
  });

  btnTableView.addEventListener('click', () => {
    setView('table', true);
  });

  btnCardView.addEventListener('click', () => {
    setView('card', true);
  });

  favBtn.addEventListener('click', () => {
    showWatchlistOnly = !showWatchlistOnly;
    pagination.currentPage = 1;
    pagination.pagesShown = 1;
    vtDiscrete = true;
    renderDashboard();
  });

  activeFilters.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-remove-filter]');
    if (!chip) return;

    const filterName = chip.getAttribute('data-remove-filter');

    if (filterName === 'search') searchPost.value = '';
    if (filterName === 'myPayLevel') filterMyPayLevel.value = '';
    if (filterName === 'experience' && filterExperience) filterExperience.value = '';
    if (filterName === 'level') filterLevel.value = '';
    if (filterName === 'ministry') filterMinistry.value = '';
    if (filterName === 'orgType') filterOrgType.value = '';
    if (filterName === 'region') filterRegion.value = '';
    if (filterName === 'location') filterLocation.setValues([]);
    if (filterName && filterName.startsWith('location:')) {
      const v = filterName.slice('location:'.length);
      filterLocation.setValues(filterLocation.values.filter(x => x !== v));
    }
    if (filterName === 'status') filterStatus.value = '';
    if (filterName === 'watchlist') showWatchlistOnly = false;
    if (filterName === 'kpi') kpiFilter = 'all';

    pagination.currentPage = 1;
    pagination.pagesShown = 1;
    vtDiscrete = true;
    renderDashboard();
  });

kpiGrid.addEventListener('click', (e) => {
  const card = e.target.closest('[data-kpi-filter]');
  if (!card) return;

  vtDiscrete = true;
  pagination.pagesShown = 1;
  const nextFilter = card.getAttribute('data-kpi-filter') || 'all';

  if (nextFilter === 'ministries') {
    kpiFilter = 'all';
    sortState.key = 'Ministry';
    sortState.direction = 'asc';
    pagination.currentPage = 1;
    renderDashboard();
    return;
  }

  if (nextFilter === 'closingSoon') {
    kpiFilter = 'closingSoon';
    sortState.key = 'Days_Left';
    sortState.direction = 'asc';
    pagination.currentPage = 1;
    renderDashboard();
    return;
  }

  if (nextFilter === 'active') {
    kpiFilter = 'active';
    sortState.key = 'Notification_Date';
    sortState.direction = 'desc';
    pagination.currentPage = 1;
    renderDashboard();
    return;
  }

  if (nextFilter === 'all') {
    kpiFilter = 'all';
    // The "Total Vacancies" card is the "show me everything" affordance.
    // It also clears the Status dropdown (defaulted to 'Active') so the
    // table actually shows all rows instead of only the Active ones.
    filterStatus.value = '';
    sortState.key = 'Notification_Date';
    sortState.direction = 'desc';
    pagination.currentPage = 1;
    renderDashboard();
    return;
  }
});

  dataContainer.addEventListener('click', (e) => {
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) {
      toggleSort(sortBtn.getAttribute('data-sort'));
      return;
    }

    const loadMoreBtn = e.target.closest('[data-load-more]');
    if (loadMoreBtn) {
      pagination.pagesShown++;
      vtDiscrete = true;
      renderDashboard(false);
      return;
    }

    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn) {
      const page = Number(pageBtn.getAttribute('data-page'));
      if (!Number.isNaN(page)) {
        pagination.currentPage = page;
        vtDiscrete = true;
        renderDashboard(false);
      }
      return;
    }

    const pageNavBtn = e.target.closest('[data-page-nav]');
    if (pageNavBtn) {
      const action = pageNavBtn.getAttribute('data-page-nav');
      const totalPages = Number(pageNavBtn.getAttribute('data-total-pages')) || 1;

      if (action === 'first') {
        pagination.currentPage = 1;
      } else if (action === 'prev' && pagination.currentPage > 1) {
        pagination.currentPage--;
      } else if (action === 'next' && pagination.currentPage < totalPages) {
        pagination.currentPage++;
      } else if (action === 'last') {
        pagination.currentPage = totalPages;
      }

      vtDiscrete = true;
      renderDashboard(false);
      return;
    }

    const cardAction = e.target.closest('[data-card-action]');
    if (cardAction) {
      e.stopPropagation();
      const action = cardAction.getAttribute('data-card-action');
      const vacancyId = cardAction.getAttribute('data-id');

      if (action === 'watchlist') {
        const wasSaved = watchlist.has(safe(vacancyId));
        toggleWatchlist(vacancyId);
        renderDashboard(false);
        if (!wasSaved) animateBookmarkButton(vacancyId);
      } else if (action === 'share') {
        shareVacancy(vacancyId);
      } else if (action === 'share-wa') {
        const item = getItemById(vacancyId);
        if (item) window.open(`https://wa.me/?text=${encodeURIComponent(buildShareText(item))}`, '_blank', 'noopener');
      } else if (action === 'expand') {
        // Toggle in place — no re-render, no scroll jump.
        const key = cardAction.getAttribute('data-group') || '';
        const card = cardAction.closest('.vx-card');
        const membersEl = card && card.querySelector('.vx-members');
        const nowExpanded = membersEl ? membersEl.hidden : false;
        if (membersEl) membersEl.hidden = !nowExpanded;
        cardAction.setAttribute('aria-expanded', String(nowExpanded));
        const total = card ? card.querySelectorAll('.vx-member').length : 0;
        cardAction.innerHTML = `${svgIcon('chevron-down')} ${nowExpanded ? 'Hide' : 'Show'} all ${total}`;
        if (nowExpanded) expandedGroups.add(key); else expandedGroups.delete(key);
      }
      return;
    }

    const tableAction = e.target.closest('[data-table-action]');
    if (tableAction) {
      e.stopPropagation();
      const action = tableAction.getAttribute('data-table-action');
      const vacancyId = tableAction.getAttribute('data-id');

      if (action === 'watchlist') {
        const wasSaved = watchlist.has(safe(vacancyId));
        toggleWatchlist(vacancyId);
        renderDashboard(false);
        if (!wasSaved) animateBookmarkButton(vacancyId);
      }
      return;
    }

    const detailsTrigger = e.target.closest('[data-open-details]');
    if (detailsTrigger) {
      openVacancyModal(detailsTrigger.getAttribute('data-open-details'));
    }
  });
}

    function onFilterChange() {
        pagination.currentPage = 1;
        pagination.pagesShown = 1;
        renderDashboard();
    }

    // Years-of-experience only makes sense relative to a chosen pay level, so the
    // dropdown is disabled (showing "Select Pay Level first") until My Pay Level is
    // set; clearing the level disables and resets it. Called from renderDashboard,
    // so every path (filter change, Clear All, chip removal, URL load, profile
    // autoselect) keeps it in sync.
    function syncExperienceState() {
        if (!filterExperience) return;
        if (filterMyPayLevel.value) {
            filterExperience.disabled = false;
            filterExperience.setPlaceholder('Any');
        } else {
            if (filterExperience.value) filterExperience.value = '';
            filterExperience.disabled = true;
            filterExperience.setPlaceholder('Select Pay Level first');
        }
    }

    function toggleSort(key) {
        if (sortState.key === key) {
            sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            sortState.key = key;
            sortState.direction = 'asc';
        }
        renderDashboard(false);
    }

   function renderDashboard(resetPageIfNeeded = true) {
  syncExperienceState();
  // KPI cards summarise the whole set regardless of the Status dropdown:
  // "Total Vacancies" = all (Status: All), "Active" = the active subset of them.
  const baseFilteredData = getFilteredData({ applyKpiFilter: false, applyStatusFilter: false });
  const filteredData = sortData(getFilteredData({ applyKpiFilter: true }));

  // Animate only discrete-click re-renders (never search keystrokes).
  const useVT = vtDiscrete
    && typeof document.startViewTransition === 'function'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  vtDiscrete = false;

  const paint = () => {
    renderKPIs(baseFilteredData);
    renderActiveFilterChips();
    updateHiddenFilterCue();

    if (currentView === 'card') {
      // Cards group sibling posts (same org + post + level + notification),
      // then page through GROUPS with a Load-more window.
      const groups = groupVacancies(filteredData);
      const pageSize = getCurrentPageSize();
      const shown = groups.slice(0, pageSize * pagination.pagesShown);
      const shownRows = shown.reduce((n, g) => n + g.items.length, 0);

      renderCardResults(shown, groups.length, filteredData.length, shownRows);

      resultsCount.textContent = filteredData.length
        ? `Showing ${shownRows} of ${filteredData.length} vacancies`
        : '0 vacancies';
    } else {
      const pageSize = getCurrentPageSize();
      const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));

      if (resetPageIfNeeded) {
        pagination.currentPage = Math.min(pagination.currentPage, totalPages);
      } else if (pagination.currentPage > totalPages) {
        pagination.currentPage = totalPages;
      }

      const pagedData = paginateData(filteredData, pageSize);
      renderTableResults(pagedData, filteredData.length, totalPages);

      const start = filteredData.length === 0
        ? 0
        : ((pagination.currentPage - 1) * pageSize) + 1;
      const end = Math.min(pagination.currentPage * pageSize, filteredData.length);

      resultsCount.textContent = filteredData.length
        ? `${start}-${end} of ${filteredData.length} vacancies`
        : '0 vacancies';
    }

    updateWatchlistUI();
    updateQuickFiltersBar();
  };

  if (useVT) document.startViewTransition(paint);
  else paint();
}

/* ---- grouping (card view): same org + post + level + source notification ---- */
function groupKeyFor(item) {
  const org = safe(item.Organisation) || safe(item.Department) || safe(item.Ministry);
  return [
    normalizeText(org),
    normalizeText(item.Post_Name),
    normalizeText(item.Level_Text),
    normalizeText(safe(item['Source Category']) || safe(item.Source_Category)),
  ].join('|');
}

function groupVacancies(rows) {
  const map = new Map(); // insertion order = current sort order
  rows.forEach((item) => {
    const key = groupKeyFor(item);
    let g = map.get(key);
    if (!g) { g = { key, items: [] }; map.set(key, g); }
    g.items.push(item);
  });
  return [...map.values()];
}

// "New this week" — derived from Notification_Date (present in both the
// Supabase-enriched and committed-JSON paths).
function isNewVacancy(item) {
  const m = safe(item.Notification_Date).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  const dt = new Date(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(dt.getTime())) return false;
  const days = (Date.now() - dt.getTime()) / 86400000;
  return days >= 0 && days <= 7;
}

   function applyMobileDefaultView() {
  if (window.innerWidth <= 768) {
    currentView = 'card';
    btnCardView.classList.add('active');
    btnTableView.classList.remove('active');
  } else {
    currentView = 'table';
    btnTableView.classList.add('active');
    btnCardView.classList.remove('active');
  }
  syncCardSortUI();
}
    function getFilteredData({ applyKpiFilter = true, applyStatusFilter = true } = {}) {
  const search = searchPost.value.trim().toLowerCase();
  const myPayLevel = filterMyPayLevel.value;
  const myYears = filterExperience ? filterExperience.value : '';
  const level = filterLevel.value;
  const ministry = filterMinistry.value;
  const orgType = filterOrgType.value;
  const region = filterRegion.value;
  const locations = filterLocation.values;
  const locationSet = locations.length ? new Set(locations) : null;
  const status = filterStatus.value;

  return rawData.filter(item => {
    const itemStatus = safe(item.Status);
    const itemLevel = safe(item.Level_Text);
    const itemMinistry = safe(item.Ministry);
    const itemLocation = formatLocation(item);
    const itemDaysLeft = parseInt(item.Days_Left, 10);
    const itemId = safe(item.Vacancy_ID);

    // Department_Organisation and Desirable_Qualification are Sheets-era column
    // names that the Supabase pipeline never fills, so they contributed '' on
    // every row — the organisation name was only findable when Keywords
    // happened to repeat it. Organisation is the real field (383/384 rows).
    // search_text is the pre-built blob from enrich.js/build_data.py; it also
    // carries the acronym expansions that Acronyms alone only has on the
    // Supabase-only path, since JSON rows take backfillDerived, which doesn't
    // set it. Both legacy keys are kept: harmless when absent, live if the
    // Sheets path ever returns.
    const searchableText = [
      item.Post_Name,
      item.Organisation,
      item.Department_Organisation,
      item.Ministry,
      item.Location_City,
      item.Location_State,
      item.Level_Text,
      item.Req_Level1,
      item.Req_Level2,
      item.Keywords,
      item.Essential_Qualification,
      item.Desirable_Qualification,
      item.Acronyms,
      item.Department,
      item.search_text
    ].map(safe).join(' ').toLowerCase();

    if (search && !fuzzyIncludes(search, searchableText)) return false;
    if (level && itemLevel !== level) return false;
    if (ministry && itemMinistry !== ministry) return false;
    if (orgType && safe(item.Organisation_Type) !== orgType) return false;
    if (region && safe(item.Region) !== region) return false;
    if (locationSet && !locationSet.has(itemLocation)) return false;
    if (applyStatusFilter && status && itemStatus !== status) return false;

    if (myPayLevel) {
      // Tier-aware eligibility: matches the candidate's level + years-at-level
      // against the vacancy's eligibility_tiers (see enrich.js#isEligible).
      // Experience only narrows results when a pay level is also chosen.
      const eligible = (window.DepEnrich && window.DepEnrich.isEligible)
        ? window.DepEnrich.isEligible(item, myPayLevel, myYears)
        : true;
      if (!eligible) return false;
    }

    if (showWatchlistOnly && !watchlist.has(itemId)) return false;
    if (applyStatusFilter && !Number.isNaN(itemDaysLeft) && status === 'Active' && itemDaysLeft < 0) return false;

    if (quickFilters.newOnly && !isNewVacancy(item)) return false;

    if (quickFilters.closing7) {
      if (Number.isNaN(itemDaysLeft) || itemDaysLeft < 0 || itemDaysLeft > 7) return false;
    }

    if (quickFilters.closingToday) {
      if (Number.isNaN(itemDaysLeft) || itemDaysLeft !== 0) return false;
    }

    if (quickFilters.delhiNcr) {
      if (!isDelhiNcrLocation(item)) return false;
    }

    if (applyKpiFilter) {
      if (kpiFilter === 'active' && itemStatus !== 'Active') return false;

      if (kpiFilter === 'closingSoon') {
        if (Number.isNaN(itemDaysLeft) || itemDaysLeft < 0 || itemDaysLeft > 15) return false;
      }
    }

    return true;
  });
}

    function sortData(data) {
        const direction = sortState.direction === 'asc' ? 1 : -1;
        const key = sortState.key;

        return [...data].sort((a, b) => {
            let aVal;
            let bVal;

            switch (key) {
                case 'Post_Name':
                    aVal = safe(a.Post_Name).toLowerCase();
                    bVal = safe(b.Post_Name).toLowerCase();
                    break;
                case 'Level_Text':
                    aVal = parseLevelValue(a.Level_Text);
                    bVal = parseLevelValue(b.Level_Text);
                    break;
                case 'Eligibility':
                    aVal = getEligibilitySortValue(a);
                    bVal = getEligibilitySortValue(b);
                    break;
                case 'Ministry':
                    aVal = safe(a.Ministry).toLowerCase();
                    bVal = safe(b.Ministry).toLowerCase();
                    break;
                case 'Org':
                    aVal = orgAcronym(a).toLowerCase();
                    bVal = orgAcronym(b).toLowerCase();
                    break;
                case 'Location':
                    aVal = formatLocation(a).toLowerCase();
                    bVal = formatLocation(b).toLowerCase();
                    break;
                case 'Days_Left':
                    aVal = parseNumericSafe(a.Days_Left, Number.MAX_SAFE_INTEGER);
                    bVal = parseNumericSafe(b.Days_Left, Number.MAX_SAFE_INTEGER);
                    break;
                    case 'Notification_Date':
  aVal = getDateSortValue(a.Notification_Date);
  bVal = getDateSortValue(b.Notification_Date);
  break;
                case 'Status':
                    aVal = safe(a.Status).toLowerCase();
                    bVal = safe(b.Status).toLowerCase();
                    break;
                default:
                    aVal = safe(a[key]).toLowerCase();
                    bVal = safe(b[key]).toLowerCase();
                    break;
            }

            if (aVal === null || aVal === undefined) aVal = '';
            if (bVal === null || bVal === undefined) bVal = '';

            if (aVal < bVal) return -1 * direction;
            if (aVal > bVal) return 1 * direction;
            return 0;
        });
    }

   function paginateData(data, pageSize = getCurrentPageSize()) {
  const start = (pagination.currentPage - 1) * pageSize;
  const end = start + pageSize;
  return data.slice(start, end);
}

    function getKpiSnapshot(filteredData) {
        return {
            total: filteredData.length,
            active: filteredData.filter(d => safe(d.Status) === 'Active').length,
            closingSoon: filteredData.filter(d => {
                const days = parseInt(d.Days_Left, 10);
                return !Number.isNaN(days) && days >= 0 && days <= 15;
            }).length,
            ministries: new Set(
                filteredData.map(d => safe(d.Ministry)).filter(Boolean)
            ).size
        };
    }

 function renderKPIs(filteredData) {
  const current = getKpiSnapshot(filteredData);
  const previous = previousKpiSnapshot;

  const totalDelta = previous ? current.total - previous.total : 0;
  const activeDelta = previous ? current.active - previous.active : 0;
  const closingSoonDelta = previous ? current.closingSoon - previous.closingSoon : 0;
  const ministriesDelta = previous ? current.ministries - previous.ministries : 0;

  kpiGrid.innerHTML = `
    ${buildKpiCard('Total Vacancies', current.total, 'briefcase', 'cyan', totalDelta, 'all')}
    ${buildKpiCard('Active', current.active, 'check-circle', 'green', activeDelta, 'active')}
    ${buildKpiCard('Closing Soon', current.closingSoon, 'clock', 'red', closingSoonDelta, 'closingSoon')}
   ${buildKpiCard('Ministries', current.ministries, 'building', 'purple', ministriesDelta, 'ministries')}
  `;

  animateKpiCounters();
  previousKpiSnapshot = current;
}

   function buildKpiCard(title, value, icon, tone, delta, filterKey = 'all') {
  const trendClass = delta > 0 ? 'up' : 'down';
  const trendSymbol = delta > 0 ? '↑' : '↓';
  const isSelected = kpiFilter === filterKey;
  // "No change" is noise — render the delta line only when nonzero (review V4).
  const trendHtml = delta === 0
    ? ''
    : `<div class="kpi-trend ${trendClass}">${trendSymbol} ${Math.abs(delta)}</div>`;

  return `
    <button
      type="button"
      class="kpi-card kpi-${tone} kpi-clickable ${isSelected ? 'kpi-selected' : ''}"
      data-kpi-filter="${filterKey}"
      aria-pressed="${isSelected ? 'true' : 'false'}"
      title="Filter by ${title}"
    >
      <div class="kpi-icon">
        ${svgIcon(icon)}
      </div>
      <div class="kpi-title">${title}</div>
      <div class="kpi-value" data-count="${value}">0</div>
      ${trendHtml}
    </button>
  `;
}

    function animateKpiCounters() {
        const counters = kpiGrid.querySelectorAll('.kpi-value[data-count]');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        counters.forEach(counter => {
            const target = Number(counter.getAttribute('data-count')) || 0;

            if (reduced || document.hidden) {
                counter.textContent = target.toLocaleString();
                return;
            }

            const duration = 700;
            const startTime = performance.now();

            function update(now) {
                const progress = Math.min((now - startTime) / duration, 1);
                const eased = 1 - Math.pow(1 - progress, 3);
                const currentValue = Math.round(target * eased);

                counter.textContent = currentValue.toLocaleString();

                if (progress < 1) {
                    requestAnimationFrame(update);
                } else {
                    counter.textContent = target.toLocaleString();
                }
            }

            requestAnimationFrame(update);
            // rAF stalls in background tabs — make sure the number always lands.
            setTimeout(() => { counter.textContent = target.toLocaleString(); }, duration + 150);
        });
    }

    function updateWatchlistUI() {
    const savedCount = watchlist.size;
    const hasSaved = savedCount > 0;

    favCount.textContent = String(savedCount);

    favBtn.classList.toggle('has-saved', hasSaved);
    favBtn.classList.toggle('active-watchlist', showWatchlistOnly);

    favBtn.setAttribute('aria-pressed', String(showWatchlistOnly));

    // P3-7 PR 3: aria-label carries the count and the "stored on this device"
    // hint so screen-reader users immediately know both (1) how many vacancies
    // they've bookmarked and (2) that the data is local-only.
    const countPhrase = savedCount === 0
        ? 'no bookmarks yet'
        : `${savedCount} bookmarked`;
    const watchlistLabel = `My Watchlist. ${countPhrase}. Stored on this device.`;
    favBtn.setAttribute('aria-label', watchlistLabel);
    favBtn.setAttribute('aria-description', 'Bookmarks are stored locally on this device; they do not sync across browsers or devices.');

    if (showWatchlistOnly) {
        favBtn.title = `Showing ${savedCount} bookmarked ${savedCount === 1 ? 'vacancy' : 'vacancies'} (stored on this device)`;
    } else if (hasSaved) {
        favBtn.title = `Show ${savedCount} bookmarked ${savedCount === 1 ? 'vacancy' : 'vacancies'} (stored on this device)`;
    } else {
        favBtn.title = 'Bookmark vacancies — stored on this device';
    }
}

/**
 * P3-7 PR 3: pulse the header favBtn to give a global signal that the
 * bookmark action was registered (not just on the row the user clicked).
 * Triggered on the 0 → 1 transition only — repeated clicks on already-saved
 * items don't pulse the header (the row-level bookmarkPop animation covers
 * that case for visual feedback).
 */
function pulseHeaderWatchlist() {
    if (!favBtn) return;
    favBtn.classList.remove('fav-btn-pop');
    // Force reflow so the animation restarts even if it just ran.
    void favBtn.offsetWidth;
    favBtn.classList.add('fav-btn-pop');
    // Clean up the class after the animation so re-triggering works cleanly.
    setTimeout(() => favBtn.classList.remove('fav-btn-pop'), 600);
}

/**
 * P3-7 PR 3: show a one-time toast explaining that bookmarks live on the
 * device. Gated by localStorage so the user sees it once and never again.
 * Safe to call on every transition 0 → 1 — the gate is what enforces "once".
 */
function maybeShowBookmarkIntroToast() {
    try {
        if (localStorage.getItem('deputation_bookmark_intro_seen') === '1') return;
        localStorage.setItem('deputation_bookmark_intro_seen', '1');
    } catch (err) {
        // localStorage may be disabled (private mode, etc.) — still show
        // the toast once for this page load.
    }
    showHomeToast('Bookmarked. Stored on this device only — bookmarks don\'t sync across browsers.');
}
   function renderActiveFilterChips() {
  const chips = [];

  if (searchPost.value.trim()) chips.push(makeChip('search', `Search: ${escapeHtml(searchPost.value.trim())}`));
  if (filterMyPayLevel.value) chips.push(makeChip('myPayLevel', `My Pay Level: Level ${filterMyPayLevel.value}`));
  if (filterExperience && filterExperience.value) chips.push(makeChip('experience', `Experience: ${filterExperience.value === '10' ? '10+' : escapeHtml(filterExperience.value)} yr`));
  if (filterLevel.value) chips.push(makeChip('level', `Pay Level: ${escapeHtml(filterLevel.value)}`));
  if (filterMinistry.value) chips.push(makeChip('ministry', `Ministry: ${escapeHtml(filterMinistry.value)}`));
  if (filterOrgType.value) chips.push(makeChip('orgType', `Type: ${escapeHtml(filterOrgType.value)}`));
  if (filterRegion.value) chips.push(makeChip('region', `Region: ${escapeHtml(filterRegion.value === 'NorthEast' ? 'North-East' : filterRegion.value)}`));
  filterLocation.values.forEach(loc => {
    chips.push(makeChip(`location:${loc}`, `Location: ${escapeHtml(loc)}`));
  });
  if (filterStatus.value) chips.push(makeChip('status', `Status: ${escapeHtml(filterStatus.value)}`));
  if (showWatchlistOnly) chips.push(makeChip('watchlist', 'Watchlist'));

  if (kpiFilter === 'active') chips.push(makeChip('kpi', 'KPI: Active'));
  if (kpiFilter === 'closingSoon') chips.push(makeChip('kpi', 'KPI: Closing Soon'));

  activeFilters.innerHTML = chips.join('');
}

// When the sidebar is collapsed, the filters living in the "Many more filters"
// drawer (everything except My Pay Level + Search) are hidden — yet they may still
// be narrowing the results. Flag that on the toggle button (brand-gradient fill +
// a count) so the user isn't confused by an unseen filter. Expanded = normal look.
function countHiddenActiveFilters() {
  let n = 0;
  if (filterExperience && filterExperience.value) n++;
  if (filterLevel.value) n++;
  if (filterMinistry.value) n++;
  if (filterOrgType.value) n++;
  if (filterRegion.value) n++;
  if (filterLocation.values.length) n++;
  if (filterStatus.value && filterStatus.value !== 'Active') n++; // Active is the default
  return n;
}

function updateHiddenFilterCue() {
  const btn = document.getElementById('desktopFilterToggle');
  if (!btn) return;
  const n = countHiddenActiveFilters();
  const show = document.body.classList.contains('filters-collapsed') && n > 0;

  btn.classList.toggle('filters-more-btn--cue', show);
  btn.title = show
    ? `${n} active filter${n > 1 ? 's' : ''} hidden in here — click to view`
    : '';

  let badge = btn.querySelector('.filters-more-count');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'filters-more-count';
    badge.setAttribute('aria-hidden', 'true');
    const caret = btn.querySelector('.filters-more-caret');
    if (caret) caret.insertAdjacentElement('beforebegin', badge);
    else btn.appendChild(badge);
  }
  badge.textContent = String(n);
}

    function makeChip(filterName, label) {
        return `
            <button type="button" class="filter-chip removable-chip" data-remove-filter="${filterName}">
                <span>${label}</span>
                <span class="chip-x">×</span>
            </button>
        `;
    }

    function initializeTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    applyTheme(savedTheme);
}

function toggleTheme() {
    const currentTheme =
        document.documentElement.getAttribute('data-theme') === 'light'
            ? 'light'
            : 'dark';

    const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(nextTheme);
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);

    if (themeToggle) {
        themeToggle.innerHTML = theme === 'light' ? svgIcon('sun') : svgIcon('moon');
        themeToggle.title =
            theme === 'light'
                ? 'Switch to dark mode'
                : 'Switch to light mode';
    }
}

    function emptyStateHtml() {
        const message = showWatchlistOnly
            ? (watchlist.size
                ? 'No saved vacancies match the current filters.'
                : 'No saved vacancies yet. Click the heart on any vacancy to save it.')
            : 'No vacancies match the current filters.';
        return `<div class="empty-state">${escapeHtml(message)}</div>`;
    }

    function renderTableResults(rows, totalCount, totalPages) {
        dataContainer.className = 'data-container view-table';
        dataContainer.innerHTML = totalCount
            ? `${renderTable(rows)}${renderPagination(totalPages)}`
            : emptyStateHtml();
    }

    function renderCardResults(groups, totalGroups, totalRows, shownRows) {
        dataContainer.className = 'data-container view-card';
        dataContainer.innerHTML = totalRows
            ? `${renderCards(groups)}${renderLoadMore(groups.length, totalGroups, shownRows, totalRows)}`
            : emptyStateHtml();
    }


    function renderSortableHeader(label, key, extraClass = '') {
  const active = sortState.key === key;
  const dir = sortState.direction === 'asc' ? '↑' : '↓';

  return `
    <th class="${extraClass}">
      <button
        type="button"
        class="sort-btn ${active ? 'active' : ''}"
        data-sort="${key}"
      >
        <span>${label}</span>
        <span class="sort-indicator">${active ? dir : '↕'}</span>
      </button>
    </th>
  `;
}

   function cardHeartBtn(item, extraClass = 'card-heart-btn vx-heart') {
  const vacancyId = safe(item.Vacancy_ID);
  const saved = watchlist.has(vacancyId);
  return `
    <button
      type="button"
      class="${extraClass} ${saved ? 'saved' : ''}"
      data-card-action="watchlist"
      data-id="${escapeHtml(vacancyId)}"
      title="Bookmark the Vacancy"
      aria-label="${saved ? 'Remove bookmarked vacancy' : 'Bookmark the Vacancy'}"
      aria-pressed="${saved ? 'true' : 'false'}"
    >${svgIcon('heart')}</button>`;
}

function cardOrgLine(item) {
  const ministry = withAcronym(item.Ministry);
  const org = orgDisplayName(item);
  const orgShown = org && normalizeText(org) !== normalizeText(safe(item.Ministry)) ? withAcronym(org) : '';
  const parts = [ministry, orgShown].filter(Boolean);
  return parts.join(' — ') || '—';
}

function cardEligibilityText(item) {
  return safe(item.eligibility_tiers_text) || formatEligibility(item);
}

function cardMetaChips(item, { withLocation = true } = {}) {
  const chips = [];
  if (withLocation) {
    const loc = formatLocation(item);
    if (loc) chips.push(`<span class="vx-chip" title="Location">${svgIcon('map-pin')}<span>${escapeHtml(loc)}</span></span>`);
  }
  const elig = cardEligibilityText(item);
  if (elig && elig !== 'Not specified') {
    chips.push(`<span class="vx-chip" title="Eligible feeder grades">${svgIcon('layers')}<span>${escapeHtml(elig)}</span></span>`);
  }
  const notif = formatDisplayDate(safe(item.Notification_Date));
  if (notif && notif !== 'Not specified') {
    chips.push(`<span class="vx-chip" title="Notification date">${svgIcon('calendar')}<span class="vx-date">${escapeHtml(notif)}</span></span>`);
  }
  return chips.join('');
}

function cardFootHtml(item) {
  const pdf = normalizeUrl(safe(item.Official_Notification_Link));
  const badge = formatSourceBadgeShort(item);
  return `
    <div class="vx-foot">
      ${pdf ? `
        <a class="vx-link" href="${escapeHtml(pdf)}" target="_blank" rel="noopener noreferrer"
           title="Open the official notification PDF" onclick="event.stopPropagation();"${notifPreviewAttr(item)}>
          ${svgIcon('external')} Notification PDF
        </a>` : `
        <span class="vx-link vx-link-muted" title="Open full details">View details</span>`}
      <button type="button" class="vx-share" data-card-action="share" data-id="${escapeHtml(safe(item.Vacancy_ID))}"
              title="Share this vacancy" aria-label="Share this vacancy">
        ${svgIcon('share')}
      </button>
      <button type="button" class="vx-share vx-share-wa" data-card-action="share-wa" data-id="${escapeHtml(safe(item.Vacancy_ID))}"
              title="Share on WhatsApp" aria-label="Share on WhatsApp">
        ${svgIcon('whatsapp')}
      </button>
      ${badge ? `<span class="vx-src" title="${escapeHtml(badge.full)}">${escapeHtml(badge.short)}</span>` : ''}
    </div>`;
}

function cardHeadHtml(item, daysLeft) {
  return `
    <div class="vx-head">
      <span class="vx-pill vx-pill-level">${escapeHtml(safe(item.Level_Text) || '—')}</span>
      ${isNewVacancy(item) ? '<span class="vx-new">NEW</span>' : ''}
      <span class="vx-head-spacer"></span>
      <span class="days-pill days-pill-${getDaysLeftTone(daysLeft)}">${escapeHtml(formatDaysLeft(daysLeft))}</span>
      ${cardHeartBtn(item)}
    </div>`;
}

function renderVacancyCard(item) {
  const vacancyId = safe(item.Vacancy_ID);
  const daysLeft = parseInt(item.Days_Left, 10);

  return `
    <article class="vx-card clickable-card ${verificationClass(item)}" data-open-details="${escapeHtml(vacancyId)}">
      ${cardHeadHtml(item, daysLeft)}
      <h3 class="vx-title">${escapeHtml(safe(item.Post_Name) || '—')}</h3>
      <div class="vx-org">${escapeHtml(cardOrgLine(item))}</div>
      <div class="vx-meta">${cardMetaChips(item)}</div>
      ${cardFootHtml(item)}
    </article>
  `;
}

function renderGroupCard(group) {
  const rep = group.items[0];
  const expanded = expandedGroups.has(group.key);
  const minDays = group.items.reduce((min, it) => {
    const d = parseInt(it.Days_Left, 10);
    return Number.isNaN(d) ? min : Math.min(min, d);
  }, Number.MAX_SAFE_INTEGER);
  const daysLeft = minDays === Number.MAX_SAFE_INTEGER ? NaN : minDays;

  const locations = group.items.map(it => ({ id: safe(it.Vacancy_ID), loc: formatLocation(it) || '—', days: parseInt(it.Days_Left, 10) }));
  const chipMax = 4;
  const locChips = locations.slice(0, chipMax).map(l => `
    <button type="button" class="vx-loc-chip ${!Number.isNaN(l.days) && l.days >= 0 && l.days <= 15 ? 'tone-closing' : ''}"
            data-open-details="${escapeHtml(l.id)}" title="Open ${escapeHtml(l.loc)}">
      ${escapeHtml(l.loc)}
    </button>`).join('');
  const moreCount = locations.length - chipMax;

  const totalPosts = group.items.reduce((n, it) => n + (parseInt(it.No_of_Posts, 10) || 1), 0);
  const savedCount = group.items.filter(it => watchlist.has(safe(it.Vacancy_ID))).length;

  const members = group.items.map(it => {
    const d = parseInt(it.Days_Left, 10);
    return `
      <div class="vx-member" data-open-details="${escapeHtml(safe(it.Vacancy_ID))}" role="button" tabindex="0">
        <span class="vx-member-loc">${svgIcon('map-pin')}${escapeHtml(formatLocation(it) || '—')}</span>
        <span class="days-pill days-pill-${getDaysLeftTone(d)}">${escapeHtml(formatDaysLeft(d))}</span>
        ${cardHeartBtn(it, 'table-heart-btn')}
      </div>`;
  }).join('');

  const gid = 'grp-' + group.key.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);

  return `
    <article class="vx-card vx-group clickable-card" data-open-details="${escapeHtml(safe(rep.Vacancy_ID))}">
      <div class="vx-head">
        <span class="vx-pill vx-pill-level">${escapeHtml(safe(rep.Level_Text) || '—')}</span>
        ${group.items.some(isNewVacancy) ? '<span class="vx-new">NEW</span>' : ''}
        <span class="vx-head-spacer"></span>
        <span class="days-pill days-pill-${getDaysLeftTone(daysLeft)}" title="Soonest closing among these posts">${escapeHtml(formatDaysLeft(daysLeft))}</span>
      </div>
      <h3 class="vx-title">${escapeHtml(safe(rep.Post_Name) || '—')}</h3>
      <div class="vx-org">${escapeHtml(cardOrgLine(rep))}</div>
      <div class="vx-count-line">${svgIcon('layers')}${totalPosts} post${totalPosts === 1 ? '' : 's'} · ${locations.length} location${locations.length === 1 ? '' : 's'}${savedCount ? ` · ${savedCount} saved` : ''}</div>
      <div class="vx-meta">${cardMetaChips(rep, { withLocation: false })}</div>
      <div class="vx-locs">
        ${locChips}
        ${moreCount > 0 ? `<span class="vx-loc-more">+${moreCount} more</span>` : ''}
      </div>
      <div class="vx-foot">
        <button type="button" class="vx-expand" data-card-action="expand" data-group="${escapeHtml(group.key)}"
                aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="${escapeHtml(gid)}">
          ${svgIcon('chevron-down')} ${expanded ? 'Hide' : 'Show'} all ${locations.length}
        </button>
        <button type="button" class="vx-share" data-card-action="share" data-id="${escapeHtml(safe(rep.Vacancy_ID))}"
                title="Share this vacancy" aria-label="Share this vacancy">
          ${svgIcon('share')}
        </button>
        <button type="button" class="vx-share vx-share-wa" data-card-action="share-wa" data-id="${escapeHtml(safe(rep.Vacancy_ID))}"
                title="Share on WhatsApp" aria-label="Share on WhatsApp">
          ${svgIcon('whatsapp')}
        </button>
        ${(() => {
          const badge = formatSourceBadgeShort(rep);
          return badge ? `<span class="vx-src" title="${escapeHtml(badge.full)}">${escapeHtml(badge.short)}</span>` : '';
        })()}
      </div>
      <div class="vx-members" id="${escapeHtml(gid)}" ${expanded ? '' : 'hidden'}>${members}</div>
    </article>
  `;
}

function renderCards(groups) {
  const cards = groups
    .map(g => (g.items.length === 1 ? renderVacancyCard(g.items[0]) : renderGroupCard(g)))
    .join('');
  return `<div class="cards-grid">${cards}</div>`;
}

    function renderPagination(totalPages) {
  if (totalPages <= 1) return '';

  const current = pagination.currentPage;
  const pageBtn = (i) => `
      <button type="button" class="page-btn ${i === current ? 'active' : ''}" data-page="${i}"
              ${i === current ? 'aria-current="page"' : ''}>${i}</button>`;
  const ell = '<span class="page-ellipsis" aria-hidden="true">…</span>';

  // Windowed numbers: 1 … (current±2) … last — never two wrapped rows of 24.
  const lo = Math.max(1, current - 2);
  const hi = Math.min(totalPages, current + 2);
  const parts = [];
  if (lo > 1) { parts.push(pageBtn(1)); if (lo > 2) parts.push(ell); }
  for (let i = lo; i <= hi; i++) parts.push(pageBtn(i));
  if (hi < totalPages) { if (hi < totalPages - 1) parts.push(ell); parts.push(pageBtn(totalPages)); }

  return `
    <div class="pagination-bar">
      <button type="button" class="page-nav-btn" data-page-nav="prev"
              data-total-pages="${totalPages}" ${current === 1 ? 'disabled' : ''}>Prev</button>

      <div class="page-numbers">${parts.join('')}</div>

      <button type="button" class="page-nav-btn" data-page-nav="next"
              data-total-pages="${totalPages}" ${current === totalPages ? 'disabled' : ''}>Next</button>
    </div>
  `;
}

function renderLoadMore(shownGroups, totalGroups, shownRows, totalRows) {
  if (totalGroups <= shownGroups) {
    return totalRows > getCurrentPageSize()
      ? `<div class="load-more-bar"><span class="load-more-note">All ${totalRows} vacancies shown</span></div>`
      : '';
  }
  return `
    <div class="load-more-bar">
      <button type="button" class="load-more-btn" data-load-more>
        ${svgIcon('chevron-down')} Load more
      </button>
      <span class="load-more-note">Showing ${shownRows} of ${totalRows} vacancies</span>
    </div>
  `;
}

    function setView(view, resetPage = false) {
  currentView = view;

  if (resetPage) {
    pagination.currentPage = 1;
    pagination.pagesShown = 1;
  }

  btnTableView.classList.toggle('active', view === 'table');
  btnCardView.classList.toggle('active', view === 'card');
  syncCardSortUI();

  vtDiscrete = true;
  renderDashboard(false);
}

// The sort dropdown belongs to card view; table view sorts via its headers.
// Entering card view re-applies the dropdown's sort so the label is honest.
function syncCardSortUI() {
  if (cardSortRoot) cardSortRoot.hidden = currentView !== 'card';
  if (currentView === 'card' && cardSort) {
    const s = CARD_SORTS[cardSort.value] || CARD_SORTS.closing;
    sortState.key = s.key;
    sortState.direction = s.direction;
  }
}

    function openVacancyModal(vacancyId, { push = true } = {}) {
        const item = getItemById(vacancyId);
        if (!item || !modal || !modalBody) return;

        modalBody.innerHTML = buildModalContent(item);

        if (typeof modal.showModal === 'function') {
            if (!modal.open) modal.showModal();
        } else {
            modal.setAttribute('open', ''); // ancient-browser fallback
        }
        document.body.classList.add('vxd-open');
        if (modal.scrollTop) modal.scrollTop = 0;
        const content = modal.querySelector('.modal-content');
        if (content) content.scrollTop = 0;

        // URL: one history entry per dialog session (replace on in-dialog switches)
        try {
            const id = safe(vacancyId);
            if (getUrlVacancyId() !== id) {
                const url = new URL(window.location.href);
                url.searchParams.set('v', id);
                if (push && !modalPushed) {
                    history.pushState({ vx: id }, '', url);
                    modalPushed = true;
                } else {
                    history.replaceState(modalPushed ? { vx: id } : history.state, '', url);
                }
            }
        } catch (e) {}

        wireFlagUI(vacancyId);
    }

    function closeVacancyModal() {
        if (!modal || !modalBody) return;
        if (typeof modal.close === 'function' && modal.open) {
            modal.close(); // `close` event does the cleanup + URL sync
        } else {
            modal.removeAttribute('open');
            modalBody.innerHTML = '';
            document.body.classList.remove('vxd-open');
            syncUrlOnClose();
        }
    }

    function buildModalContent(item) {
        const vacancyId = safe(item.Vacancy_ID);
        const saved = watchlist.has(vacancyId);
        const daysLeft = parseInt(item.Days_Left, 10);
        const closingSoon = !Number.isNaN(daysLeft) && daysLeft >= 0 && daysLeft <= 15;
        const expired = !Number.isNaN(daysLeft) && daysLeft < 0;

        const title = safe(item.Post_Name) || '—';
        const ministry = withAcronym(item.Ministry) || '—';
        const organisation = withAcronym(getFirstNonEmpty(item, [
            'Department_Organisation',
            'Organisation',
            'Department',
            'Office'
        ]));
        const location = formatLocation(item) || 'Not specified';
        const level = safe(item.Level_Text) || '—';
        const eligibility = formatEligibility(item);
        const status = safe(item.Status) || '—';

        const rawClosingDate = safe(item.Last_Date_To_Apply);
        const rawNotificationDate = safe(item.Notification_Date);
        const modeOfApplication = safe(item.Mode_of_Application) || 'Not specified';

        const closingDate = formatDisplayDate(rawClosingDate);
        const notificationDate = formatDisplayDate(rawNotificationDate);
        const closingDateDays = getDaysUntilDate(rawClosingDate);

        const tenure = getFirstNonEmpty(item, [
            'Tenure',
            'Deputation_Tenure',
            'Period_of_Deputation'
        ]);

        const ageLimit = getFirstNonEmpty(item, [
            'Age_Limit',
            'Maximum_Age',
            'Age'
        ]);

        const payScale = getFirstNonEmpty(item, [
            'Pay_Scale',
            'PayScale',
            'Pay_Band'
        ]);

        const detailedEligibility = getFirstNonEmpty(item, ['Detailed_Eligibility']);
        const additionalDetails = getFirstNonEmpty(item, ['Additional_Details']);

        const essentialQualification = getFirstNonEmpty(item, [
            'Essential_Qualification',
            'Qualification',
            'Essential Qualifications'
        ]);

        const desirableQualification = getFirstNonEmpty(item, [
            'Desirable_Qualification',
            'Desirable Qualifications'
        ]);

        const experience = getFirstNonEmpty(item, [
            'Experience',
            'Essential_Experience',
            'Desirable_Experience'
        ]);

        const description = getFirstNonEmpty(item, [
            'Job_Description',
            'Description',
            'Remarks',
            'Notes'
        ]);

        const detailedNotificationLink = normalizeUrl(safe(item.Official_Notification_Link));
        const applyLink = normalizeUrl(safe(item.Application_Form_Link));

        const srcRef = safe(item.Source_Ref);
        const srcCat = safe(item['Source Category']);
        const srcPage = safe(item.Source_Page);
        const sourceDisplay = !srcRef ? ''
            : (srcPage && srcCat) ? `p${escapeHtml(srcPage)} of ${escapeHtml(srcCat)}`
            : srcCat ? `${escapeHtml(srcRef)} <span class="modal-muted">${escapeHtml(srcCat)}</span>`
            : escapeHtml(srcRef);

        return `
            <div class="vacancy-modal">
                <div class="vacancy-modal-header">
                    <div class="vacancy-modal-title-block">
                        <div class="vacancy-modal-title">${escapeHtml(title)}</div>
                        <div class="vacancy-modal-subtitle">${escapeHtml(ministry)}</div>
                        ${organisation && organisation !== ministry ? `<div class="vacancy-modal-org">${escapeHtml(organisation)}</div>` : ''}
                    </div>

                    <div class="modal-chip-row">
                        <span class="badge badge-level">${escapeHtml(level)}</span>
                        <span class="badge ${status === 'Active' ? 'badge-active' : ''}">${escapeHtml(status)}</span>
                        <span class="modal-deadline-chip ${expired ? 'expired' : closingSoon ? 'closing' : ''}">
                            ${escapeHtml(formatDaysLeft(daysLeft))}
                        </span>
                    </div>
                </div>

                <div class="modal-section">
                    <div class="modal-section-title">Overview</div>
                    <div class="modal-grid">
                        ${buildModalField('Eligibility', eligibility)}
                        ${buildModalField('Location', location)}
                        ${buildModalField('Pay Level', level)}
                        ${buildModalField('Days Left', formatDaysLeft(daysLeft))}
                        ${buildModalField('Organisation', organisation || 'Not specified')}
                        ${buildModalField('Closing Date', `<span class="${closingDateDays !== null && closingDateDays >= 0 && closingDateDays <= 15 ? 'closing-date-text' : ''}">${escapeHtml(closingDate)}</span>`, true)}
                        ${buildModalField('Notification Date', notificationDate)}
                        ${sourceDisplay ? buildModalField('Source', sourceDisplay, true) : ''}
                        ${buildModalField('Mode of Application', renderModeBadge(modeOfApplication), true, 'modal-field--wide')}
                        ${tenure ? buildModalField('Tenure', tenure) : ''}
                        ${ageLimit ? buildModalField('Age Limit', ageLimit) : ''}
                        ${payScale ? buildModalField('Pay / Scale', payScale) : ''}
                    </div>
                </div>

                ${renderModalRichSection('Detailed Eligibility', detailedEligibility)}
                ${renderModalRichSection('Essential Qualification', essentialQualification)}
                ${renderModalRichSection('Desirable Qualification', desirableQualification)}
                ${renderModalRichSection('Experience', experience)}
                ${renderModalRichSection('Description / Remarks', description)}
                ${renderModalRichSection('Additional Details', additionalDetails)}

                <div class="modal-actions">
                    <button
                        type="button"
                        class="card-action-btn ${saved ? 'saved' : ''}"
                        data-modal-action="watchlist"
                        data-id="${escapeHtml(vacancyId)}"
                    >
                        ${svgIcon('heart')} ${saved ? 'Remove from Watchlist' : 'Save to Watchlist'}
                    </button>

                    ${detailedNotificationLink ? `
                        <a class="card-action-btn secondary" href="${escapeHtml(detailedNotificationLink)}" target="_blank" rel="noopener noreferrer"${notifPreviewAttr(item)}>
                            ${svgIcon('external')} Official Notification PDF
                        </a>
                    ` : ''}

                    <button type="button" class="card-action-btn share-wa" data-modal-action="share-wa" data-id="${escapeHtml(vacancyId)}">
                        ${svgIcon('whatsapp')} Share on WhatsApp
                    </button>

                    <button type="button" class="card-action-btn secondary" data-modal-action="copy-link" data-id="${escapeHtml(vacancyId)}">
                        ${svgIcon('link')} Copy link
                    </button>

                    <button type="button" class="card-action-btn ghost flag-open-btn" data-flag-open="${escapeHtml(vacancyId)}">
                        ${svgIcon('flag')} Report an issue
                    </button>
                </div>

                <div class="modal-section flag-section" id="flagSection" data-vid="${escapeHtml(vacancyId)}">
                    <div class="modal-section-title">Community-reported issues</div>
                    <div class="flag-list" id="flagList"><div class="flag-status">Loading…</div></div>
                    <div class="flag-form-wrap" id="flagFormWrap" hidden></div>
                </div>
            </div>
        `;
    }

    /* ---------------- Vacancy issue flags (community-reported) ---------------- */
    const FLAG_ISSUES = [
        ['broken_link',     'Link is broken / dead'],
        ['wrong_link',      'Link points to the wrong document'],
        ['wrong_pay_level', 'Wrong pay level'],
        ['wrong_deadline',  'Wrong last date / deadline'],
        ['closed_already',  'Already closed / filled'],
        ['wrong_location',  'Wrong location'],
        ['duplicate',       'Duplicate of another vacancy'],
        ['other',           'Something else'],
    ];
    const FLAG_ISSUE_LABEL = Object.fromEntries(FLAG_ISSUES);
    const FLAG_FIELDS = [
        ['whole',                       'The whole vacancy'],
        ['official_notification_link',  'Notification link'],
        ['application_form_link',       'Application / apply link'],
        ['level',                       'Pay level'],
        ['last_date_to_apply',          'Last date'],
        ['location',                    'Location'],
        ['post_name',                   'Post name'],
        ['other',                       'Other field'],
    ];

    function flagApiReady() {
        return !!(window.SUPABASE_READY && window.SUPABASE_READY());
    }
    function lsGet(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
    function lsAdd(key, val) {
        try { const a = new Set(lsGet(key)); a.add(String(val)); localStorage.setItem(key, JSON.stringify([...a])); } catch (e) {}
    }
    const endorsedFlags = () => new Set(lsGet('dep_flag_endorsed_v1').map(String));
    const reportedVacancies = () => lsGet('dep_flag_reported_v1').map(String);

    async function fetchFlags(vacancyId) {
        if (!flagApiReady()) return [];
        const url = `${window.SUPABASE_URL}/rest/v1/vacancy_flags`
            + `?vacancy_id=eq.${encodeURIComponent(vacancyId)}&status=eq.open`
            + `&select=id,field,issue_type,note,suggested_value,endorsements,created_at`
            + `&order=endorsements.desc,created_at.desc`;
        try {
            const r = await fetch(url, { headers: { apikey: window.SUPABASE_ANON_KEY, Authorization: `Bearer ${window.SUPABASE_ANON_KEY}` } });
            if (!r.ok) return [];
            return await r.json();
        } catch { return []; }
    }
    async function postToSubmit(payload) {
        const url = `${window.SUPABASE_URL}/functions/v1/submit`;
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', apikey: window.SUPABASE_ANON_KEY, Authorization: `Bearer ${window.SUPABASE_ANON_KEY}` },
            body: JSON.stringify(payload),
        });
        let d = {}; try { d = await r.json(); } catch {}
        if (!r.ok || (d && d.ok === false)) throw new Error((d && d.message) || `Server error (${r.status})`);
        return d;
    }

    function flagCardHtml(f) {
        const endorsed = endorsedFlags().has(String(f.id));
        const sv = safe(f.suggested_value);
        return `
            <div class="flag-card" data-flag-id="${escapeHtml(f.id)}">
                <div class="flag-card-head">
                    <span class="flag-tag">${escapeHtml(FLAG_ISSUE_LABEL[f.issue_type] || f.issue_type)}</span>
                    <span class="flag-unverified" title="Reported by a reader; not yet verified by an admin">unverified</span>
                </div>
                ${hasMeaningfulValue(f.note) ? `<div class="flag-note">${escapeHtml(f.note)}</div>` : ''}
                ${sv ? `<div class="flag-suggest"><span>Suggested correction:</span> ${escapeHtml(sv)}</div>` : ''}
                <div class="flag-card-foot">
                    <button type="button" class="flag-endorse-btn${endorsed ? ' done' : ''}" data-endorse="${escapeHtml(f.id)}" ${endorsed ? 'disabled' : ''}>
                        ${svgIcon('thumbs-up')} ${endorsed ? 'Endorsed' : 'Endorse'} · <span class="flag-count">${Number(f.endorsements) || 0}</span>
                    </button>
                </div>
            </div>`;
    }

    function renderFlagList(listEl, flags) {
        if (!flagApiReady()) { listEl.innerHTML = '<div class="flag-status">Issue reporting isn\'t configured.</div>'; return; }
        listEl.innerHTML = flags.length
            ? flags.map(flagCardHtml).join('')
            : '<div class="flag-status">No issues reported yet. Spotted something wrong? Use “Report an issue”.</div>';
    }

    function flagFormHtml(vacancyId) {
        const reportedBefore = reportedVacancies().filter(v => v === String(vacancyId)).length;
        return `
            <form class="flag-form" id="flagForm">
                ${reportedBefore >= 3 ? '<div class="flag-status">You\'ve already reported this vacancy a few times — please endorse an existing report instead.</div>' : `
                <div class="flag-row">
                    <label>What's wrong?
                        <select name="issueType" required>
                            <option value="">Select…</option>
                            ${FLAG_ISSUES.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('')}
                        </select>
                    </label>
                    <label>Which part?
                        <select name="field">
                            ${FLAG_FIELDS.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <label>Details <span class="flag-opt">(what's wrong, in a line)</span>
                    <textarea name="note" rows="2" maxlength="600" placeholder="e.g. The notification link 404s / points to a different post"></textarea>
                </label>
                <label>Suggested correction <span class="flag-opt">(optional — the right value/link)</span>
                    <input type="text" name="suggestedValue" maxlength="600" placeholder="e.g. correct PDF URL, or the right pay level">
                </label>
                <div class="flag-row">
                    <label>Your name <span class="flag-opt">(optional)</span><input type="text" name="reporterName" maxlength="120" autocomplete="name"></label>
                    <label>Email <span class="flag-opt">(optional)</span><input type="email" name="reporterEmail" maxlength="160" autocomplete="email"></label>
                </div>
                <input type="text" name="website" class="flag-hp" tabindex="-1" autocomplete="off" aria-hidden="true">
                <div class="flag-form-actions">
                    <button type="button" class="card-action-btn ghost" data-flag-cancel>Cancel</button>
                    <button type="submit" class="card-action-btn">Submit report</button>
                </div>
                <div class="flag-msg" id="flagMsg"></div>`}
            </form>`;
    }

    async function loadFlagsInto(vacancyId) {
        const section = document.getElementById('flagSection');
        if (!section || section.dataset.vid !== String(vacancyId)) return; // modal changed
        const listEl = document.getElementById('flagList');
        if (!listEl) return;
        const flags = await fetchFlags(vacancyId);
        const cur = document.getElementById('flagSection');
        if (!cur || cur.dataset.vid !== String(vacancyId)) return; // raced with a reopen
        renderFlagList(listEl, flags);
    }

    function wireFlagUI(vacancyId) {
        const section = document.getElementById('flagSection');
        if (!section) return;
        if (!flagApiReady()) { section.hidden = true; return; }

        loadFlagsInto(vacancyId);

        const openBtn = modalBody.querySelector(`[data-flag-open="${CSS.escape(String(vacancyId))}"]`);
        const wrap = document.getElementById('flagFormWrap');
        const listEl = document.getElementById('flagList');

        if (openBtn && wrap) {
            openBtn.addEventListener('click', () => {
                const showing = !wrap.hidden;
                if (showing) { wrap.hidden = true; wrap.innerHTML = ''; return; }
                wrap.innerHTML = flagFormHtml(vacancyId);
                wrap.hidden = false;
                const form = document.getElementById('flagForm');
                form?.querySelector('[data-flag-cancel]')?.addEventListener('click', () => { wrap.hidden = true; wrap.innerHTML = ''; });
                form?.addEventListener('submit', (e) => submitFlagForm(e, vacancyId));
                wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        }

        // Endorse (delegated within the list)
        if (listEl) {
            listEl.addEventListener('click', async (e) => {
                const btn = e.target.closest('[data-endorse]');
                if (!btn || btn.disabled) return;
                const flagId = btn.getAttribute('data-endorse');
                if (endorsedFlags().has(String(flagId))) return;
                btn.disabled = true;
                try {
                    const d = await postToSubmit({ action: 'endorse', flagId });
                    lsAdd('dep_flag_endorsed_v1', flagId);
                    const countEl = btn.querySelector('.flag-count');
                    if (countEl && typeof d.endorsements === 'number') countEl.textContent = d.endorsements;
                    btn.classList.add('done');
                    btn.childNodes.forEach(n => { if (n.nodeType === 3 && n.textContent.includes('Endorse')) n.textContent = ' Endorsed · '; });
                } catch (err) {
                    btn.disabled = false;
                    showHomeToast(`Couldn't endorse: ${escapeHtml(err.message)}`);
                }
            });
        }
    }

    async function submitFlagForm(e, vacancyId) {
        e.preventDefault();
        const form = e.target;
        const msg = document.getElementById('flagMsg');
        const submitBtn = form.querySelector('button[type="submit"]');
        const fd = new FormData(form);
        if (fd.get('website')) { if (msg) msg.textContent = 'Thanks!'; return; } // honeypot
        const issueType = fd.get('issueType');
        if (!issueType) { if (msg) { msg.textContent = 'Please choose what\'s wrong.'; msg.className = 'flag-msg err'; } return; }
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }
        try {
            await postToSubmit({
                action: 'flag',
                vacancyId,
                issueType,
                field: fd.get('field') || 'whole',
                note: fd.get('note') || '',
                suggestedValue: fd.get('suggestedValue') || '',
                reporterName: fd.get('reporterName') || '',
                reporterEmail: fd.get('reporterEmail') || '',
            });
            lsAdd('dep_flag_reported_v1', vacancyId);
            const wrap = document.getElementById('flagFormWrap');
            if (wrap) { wrap.innerHTML = '<div class="flag-status ok">✓ Thanks — your report was submitted for admin review.</div>'; }
            loadFlagsInto(vacancyId);
        } catch (err) {
            if (msg) { msg.textContent = err.message; msg.className = 'flag-msg err'; }
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit report'; }
        }
    }

    function buildModalField(label, value, isHtml = false, extraClass = '') {
        return `
            <div class="modal-field ${extraClass}">
                <div class="modal-field-label">${escapeHtml(label)}</div>
                <div class="modal-field-value">${isHtml ? value : escapeHtml(value)}</div>
            </div>
        `;
    }

    function renderModalRichSection(title, value) {
        if (!hasMeaningfulValue(value)) return '';
        return `
            <div class="modal-section">
                <div class="modal-section-title">${escapeHtml(title)}</div>
                <div class="modal-richtext">${formatRichText(value)}</div>
            </div>
        `;
    }

    function toggleWatchlist(vacancyId) {
        const id = safe(vacancyId);
        if (!id) return;

        const hadAny = watchlist.size > 0;

        if (watchlist.has(id)) {
            watchlist.delete(id);
        } else {
            watchlist.add(id);
        }

        persistWatchlist();
        updateWatchlistUI();

        // P3-7 PR 3: on the 0 → 1 transition, pulse the header favBtn so
        // the action feels registered globally (not just on the row), and
        // surface the one-time "stored on this device" toast. Repeated
        // adds (size > 1) skip both — the user already knows.
        const hasAny = watchlist.size > 0;
        if (!hadAny && hasAny) {
            pulseHeaderWatchlist();
            maybeShowBookmarkIntroToast();
        }
    }

    function animateBookmarkButton(vacancyId) {
        const safeId = String(vacancyId).replace(/"/g, '\\"');
        const buttons = document.querySelectorAll(
            `.card-heart-btn[data-id="${safeId}"], .table-heart-btn[data-id="${safeId}"]`
        );

        buttons.forEach(btn => {
            btn.classList.remove('bookmark-pop');
            void btn.offsetWidth;
            btn.classList.add('bookmark-pop');
        });
    }

    function loadWatchlist() {
        try {
            const stored = localStorage.getItem(WATCHLIST_KEY);
            if (!stored) return new Set();

            const parsed = JSON.parse(stored);
            if (!Array.isArray(parsed)) return new Set();

            const cleaned = parsed
                .map(item => String(item).trim())
                .filter(item => item && !['null', 'undefined', '-', '—', 'NaN'].includes(item));

            return new Set(cleaned);
        } catch (err) {
            console.warn('Unable to load watchlist:', err);
            return new Set();
        }
    }

    function reconcileWatchlistWithData() {
        const validIds = new Set(rawData.map(item => safe(item.Vacancy_ID)).filter(Boolean));
        watchlist = new Set([...watchlist].filter(id => validIds.has(id)));
        persistWatchlist();
        updateWatchlistUI();
    }

    function persistWatchlist() {
        try {
            localStorage.setItem(WATCHLIST_KEY, JSON.stringify([...watchlist]));
        } catch (err) {
            console.warn('Unable to save watchlist:', err);
        }
    }

    function getItemById(vacancyId) {
        const id = safe(vacancyId);
        return rawData.find(item => safe(item.Vacancy_ID) === id) || null;
    }

    function updateQuickFiltersBar() {
        if (!quickFiltersBar) return;

        quickFiltersBar.innerHTML = `
            <button type="button" class="quick-pill quick-pill--new ${quickFilters.newOnly ? 'active' : ''}" data-quick-filter="newOnly">
                New
            </button>
            <button type="button" class="quick-pill ${quickFilters.closing7 ? 'active' : ''}" data-quick-filter="closing7">
                Closing in 7 days
            </button>
            <button type="button" class="quick-pill ${quickFilters.delhiNcr ? 'active' : ''}" data-quick-filter="delhiNcr">
                Delhi/NCR
            </button>
            <button type="button" class="quick-pill ${quickFilters.closingToday ? 'active' : ''}" data-quick-filter="closingToday">
                Closing today
            </button>
        `;
    }

    function refreshSearchSuggestions(query) {
        if (!searchDatalist) return;

        const q = normalizeText(query);
        const items = q
            ? searchSuggestions.filter(item => normalizeText(item).includes(q)).slice(0, 12)
            : searchSuggestions.slice(0, 12);

        searchDatalist.innerHTML = items
            .map(item => `<option value="${escapeHtml(item)}"></option>`)
            .join('');
    }

    function tokenizeText(text) {
        return normalizeText(text).split(' ').filter(Boolean);
    }

    function levenshteinDistance(a, b) {
        const m = a.length;
        const n = b.length;

        if (m === 0) return n;
        if (n === 0) return m;

        const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }

        return dp[m][n];
    }

    function fuzzyIncludes(query, text) {
        const normalizedQuery = normalizeText(query);
        const normalizedText = normalizeText(text);

        if (!normalizedQuery) return true;
        // Exact phrase / substring match (e.g. "external affairs").
        if (normalizedText.includes(normalizedQuery)) return true;

        const queryTokens = tokenizeText(normalizedQuery);
        if (!queryTokens.length) return false;
        const textTokens = tokenizeText(normalizedText);

        // Typo tolerance is reserved for single-word queries. Multi-word queries
        // require every word to actually appear (AND of substrings) — otherwise
        // loose fuzzy matching over the long qualification text returns rows that
        // don't contain the phrase at all.
        const allowFuzzy = queryTokens.length === 1;

        return queryTokens.every(qToken => {
            // The query word must appear as a substring somewhere in the text
            // ("affair" → "affairs", "extern" → "external").
            if (normalizedText.includes(qToken)) return true;
            if (!allowFuzzy || qToken.length < 4) return false;

            // Single-word fallback: tolerate one typo against a similar-length word.
            return textTokens.some(tToken =>
                Math.abs(tToken.length - qToken.length) <= 1 &&
                levenshteinDistance(qToken, tToken) <= 1
            );
        });
    }

    function isDelhiNcrLocation(item) {
        const text = normalizeText([
            item.Location_City,
            item.Location_State,
            formatLocation(item)
        ].join(' '));

        const keywords = [
            'delhi',
            'new delhi',
            'ncr',
            'noida',
            'greater noida',
            'gurugram',
            'gurgaon',
            'ghaziabad',
            'faridabad'
        ];

        return keywords.some(keyword => text.includes(keyword));
    }

    function normalizeText(text) {
        return safe(text)
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function safe(value) {
        return value == null ? '' : String(value).trim();
    }

    function hasMeaningfulValue(value) {
        const text = safe(value).toLowerCase();
        return Boolean(text) && !['-', '—', 'na', 'n/a', 'null', 'undefined'].includes(text);
    }

    function withAcronym(value) {
        const v = safe(value);
        if (!v) return v;
        return (window.DepEnrich && window.DepEnrich.withAcronym) ? window.DepEnrich.withAcronym(v) : v;
    }

    // Short form (acronym only) of the organisation/department, if derivable.
    function orgAcronym(item) {
        const f = window.DepEnrich && window.DepEnrich.acronymFor;
        if (!f) return '';
        return f(safe(item.Organisation)) || f(safe(item.Department)) || '';
    }

    function formatLocation(item) {
        const city = safe(item.Location_City);
        const state = safe(item.Location_State);
        if (city && state) return `${city}, ${state}`;
        return city || state || '';
    }

    // Rank-based level parsing: "13A" → 13.5 (sits between 13 and 14), so all
    // comparisons/sorts below need no special-casing. levelLabel gives the
    // display token ("13A"). A suffix needs a word boundary ("13 and…" → 13).
    const LEVEL_RX = /(\d+)([\s-]*A\b)?/;

    function parseLevelValue(value) {
        if (value == null) return null;
        const str = String(value).trim().toUpperCase();
        if (!str) return null;

        const match = str.match(LEVEL_RX);
        return match ? Number(match[1]) + (match[2] ? 0.5 : 0) : null;
    }

    function levelLabel(value) {
        if (value == null) return '';
        const match = String(value).trim().toUpperCase().match(LEVEL_RX);
        return match ? match[1] + (match[2] ? 'A' : '') : '';
    }

    function parseNumericSafe(value, fallback = 0) {
        const num = Number.parseInt(value, 10);
        return Number.isNaN(num) ? fallback : num;
    }

    function formatEligibility(item) {
        // ranks order the pair; tokens are displayed (so "13A", never 13.5)
        const req1 = parseLevelValue(item.Req_Level1);
        const req2 = parseLevelValue(item.Req_Level2);
        const lbl1 = levelLabel(item.Req_Level1);
        const lbl2 = levelLabel(item.Req_Level2);

        if (req1 !== null && req2 !== null) {
            if (req1 === req2) return `Level ${lbl1}`;
            return req1 < req2
                ? `Level ${lbl1} to Level ${lbl2}`
                : `Level ${lbl2} to Level ${lbl1}`;
        }

        if (req1 !== null) return `Level ${lbl1}`;
        if (req2 !== null) return `Level ${lbl2}`;
        return 'Not specified';
    }

    function getEligibilitySortValue(item) {
        const req1 = parseLevelValue(item.Req_Level1);
        const req2 = parseLevelValue(item.Req_Level2);

        if (req1 !== null && req2 !== null) return Math.min(req1, req2);
        if (req1 !== null) return req1;
        if (req2 !== null) return req2;
        return Number.MAX_SAFE_INTEGER;
    }

    function formatDaysLeft(daysLeft) {
        if (Number.isNaN(daysLeft)) return 'Not specified';
        if (daysLeft < 0) return 'Expired';
        if (daysLeft === 0) return 'Closes today';
        return `${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    }

    // Phase 2 item 9. Was three bands (expired / <=15 / rest), which typeset
    // "1 day" and "93 days" identically once both landed outside the 15-day
    // window. These five bands are byte-identical to the twin in
    // shared/vacancy-utils.js:79 — the duplication Phase 0 declined to collapse
    // (because merging then would have recoloured every pill as a side effect
    // of a defect fix) is resolved here, where recolouring IS the change.
    // Keep the two in step; style.css carries a tone class per band.
    function getDaysLeftTone(daysLeft) {
  if (Number.isNaN(daysLeft)) return 'muted';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 2) return 'critical';
  if (daysLeft <= 7) return 'closing';
  if (daysLeft <= 15) return 'soon';
  return 'safe';
}

    // Turn a dense eligibility / details paragraph into readable, broken-up lines:
    //  • **labels** become bold subheadings;
    //  • numbered/lettered points "(1)/(i)/(a)", "Note:", "OR" tiers, and sentence
    //    boundaries each start a new line (abbreviations like "O.M.", "No." kept intact);
    //  • key facts (pay levels, service years, age, post count) get a sober accent.
    function formatRichText(value) {
        let s = escapeHtml(safe(value));
        // bold subheadings
        s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="rich-subhead">$1</strong>');
        // new line before structured markers
        s = s
            .replace(/\s+(?=\((?:\d{1,2}|[ivxlcdm]{1,4}|[a-h])\)\s)/gi, '\n')
            .replace(/\s*(Note\s*:|Eligibility criteria\s*:|Age\s*limit\s*:|Experience\s*:|Qualifications?\s*:|Address\s*:|Desirable\s*:)/gi, '\n$1')
            .replace(/\s*;?\s+OR\s+/g, '\nOR ');
        // gentle sentence breaks — skip single-capital abbreviations (O.M., G.S.R.) and "No. 2"
        s = s.replace(/(?<![A-Z])\.\s+(?=[A-Z])/g, '.\n');
        // sober highlights for the facts that matter most
        s = s
            .replace(/\b(Pay Level\s*\d{1,2}[A-Z]?|Level[\s-]?\d{1,2}[A-Z]?)\b/g, '<span class="rich-key">$1</span>')
            .replace(/\b((?:one|two|three|four|five|six|seven|eight|nine|ten)\s+years?|\d{1,2}\s*years?)\b/gi, '<span class="rich-key">$1</span>')
            .replace(/\b(\d{1,3}\s*Posts?)\b/gi, '<span class="rich-key">$1</span>');
        // explicit newlines from the source too
        s = s.replace(/\r/g, '');
        // split into blocks, wrap (points get a hanging indent)
        const blocks = s.split('\n').map(b => b.trim()).filter(Boolean);
        return blocks.map(b => {
            const isPoint = /^(\((?:\d{1,2}|[ivxlcdm]{1,4}|[a-h])\)|OR\b)/i.test(b);
            return `<span class="rich-line${isPoint ? ' rich-point' : ''}">${b}</span>`;
        }).join('');
    }

    function normalizeUrl(value) {
        const url = safe(value);
        if (!url) return '';
        if (['-', '—', 'na', 'n/a', 'null', 'undefined'].includes(url.toLowerCase())) return '';
        if (/^https?:\/\//i.test(url)) return url;
        if (/^www\./i.test(url)) return `https://${url}`;
        return '';
    }

    function formatDisplayDate(value) {
        const raw = safe(value);
        if (!raw || ['-', '—', 'na', 'n/a', 'null', 'undefined'].includes(raw.toLowerCase())) {
            return 'Not specified';
        }

        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
        }

        return raw;
    }

    function getDaysUntilDate(value) {
        const raw = safe(value);
        if (!raw) return null;

        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;

        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());

        const diffMs = target - today;
        return Math.round(diffMs / (1000 * 60 * 60 * 24));
    }

   function getApplicationModeClass(mode) {
  const text = safe(mode).toLowerCase();

  if (text.includes('both')) return 'mode-both';
  if (text.includes('online')) return 'mode-online';
  if (text.includes('physical') || text.includes('offline') || text.includes('post')) {
    return 'mode-physical';
  }

  return 'mode-default';
}

    function renderModeBadge(mode) {
        const safeMode = safe(mode) || 'Not specified';
        // Short modes (Online/Offline/Both) stay as a compact pill; long sentences
        // render as a readable block box instead of a giant bold pill.
        const longCls = safeMode.length > 28 ? ' mode-long' : '';
        return `<span class="application-mode-badge ${getApplicationModeClass(safeMode)}${longCls}">${escapeHtml(safeMode)}</span>`;
    }

    function uniqueSorted(arr) {
        return [...new Set(arr.map(safe).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
    }

    function addOptions(selectEl, values) {
        values.forEach(value => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = value;
            selectEl.appendChild(option);
        });
    }

    function getFirstNonEmpty(item, keys) {
        for (const key of keys) {
            const value = item[key];
            if (hasMeaningfulValue(value)) {
                return safe(value);
            }
        }
        return '';
    }

    function escapeHtml(str) {
        return String(str)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    // ========================================================================
    // P3-3 PR 4 — semantic search (Gemini embeddings via the semantic-search
    // Edge Function from PR 2). The previous sidebar chip has been replaced
    // by a dedicated `#aiSearchInput` bar below the KPI grid; the AI path
    // is now always-on (no toggle) and the sidebar #searchPost input remains
    // the keyword path only. The two inputs operate independently.
    //
    // Free-tier discipline: the Edge Function returns 503 + code="disabled"
    // when the daily Gemini quota is exhausted; the UI degrades to a single
    // inline status line, never throws, never blocks the user from typing.
    // ========================================================================

    let semanticTimer = null;
    let semanticInflight = null;
    let semanticLoaderTimer = null;
    let semanticLoaderActive = false;
    const aiSearchInput = document.getElementById('aiSearchInput');
    const semanticResults = document.getElementById('semanticResults');
    const semanticResultsList = document.getElementById('semanticResultsList');
    const semanticResultsStatus = document.getElementById('semanticResultsStatus');
    const semanticLoader = document.getElementById('semanticLoader');

    // v7.3.13 — neural loader for AI search latency.
    // Builds a 6-node / ~9-edge SVG network inside #semanticLoader on first
    // show, then cycles status text every 1.3s. Idempotent: subsequent
    // shows skip the rebuild. Auto-truncates the moment the response lands.
    const SEMANTIC_STATUS = [
        'Understanding your request…',
        'Extracting intent & filters…',
        'Scanning ministries & organizations…',
        'Matching eligibility & ranking results…',
    ];
    const SEMANTIC_NODE_POS = [
        { x: 120, y: 20  },
        { x:  40, y: 50  },
        { x: 200, y: 50  },
        { x:  70, y: 110 },
        { x: 170, y: 110 },
        { x: 120, y: 140 },
    ];

    function buildSemanticLoaderNetwork() {
        if (!semanticLoader) return;
        const edgesG = semanticLoader.querySelector('.sem-net-edges');
        const nodesG = semanticLoader.querySelector('.sem-net-nodes');
        if (!edgesG || !nodesG) return;
        if (edgesG.childElementCount > 0) return;        // already built
        const nodes = SEMANTIC_NODE_POS;
        // Inject nodes
        nodes.forEach((n) => {
            const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            c.setAttribute('cx', n.x);
            c.setAttribute('cy', n.y);
            c.setAttribute('r', 5);
            nodesG.appendChild(c);
        });
        // Inject edges — connect every node to every other (15 total). Skip
        // duplicates (line "1-2" same as "2-1") by only emitting j > i.
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i], b = nodes[j];
                const len = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', a.x);
                line.setAttribute('y1', a.y);
                line.setAttribute('x2', b.x);
                line.setAttribute('y2', b.y);
                line.style.setProperty('--len', len);
                edgesG.appendChild(line);
            }
        }
    }

    function showSemanticLoader(query) {
        if (!semanticLoader) return;
        buildSemanticLoaderNetwork();
        const echo = semanticLoader.querySelector('.semantic-loader-echo');
        const msgSpan = semanticLoader.querySelector('[data-loader-msg]');
        if (echo) echo.textContent = `“${query}”`;
        if (msgSpan) msgSpan.textContent = SEMANTIC_STATUS[0];
        semanticLoader.hidden = false;
        semanticLoader.removeAttribute('aria-hidden');
        // next frame so the transition picks up the .is-active class
        requestAnimationFrame(() => {
            semanticLoader.classList.add('is-active');
            semanticLoader.classList.remove('is-leaving');
        });
        semanticLoaderActive = true;
        // Cycle status text every 1.3s
        let idx = 0;
        clearInterval(semanticLoaderTimer);
        semanticLoaderTimer = setInterval(() => {
            if (!semanticLoaderActive) return;
            idx = (idx + 1) % SEMANTIC_STATUS.length;
            const s = semanticLoader.querySelector('.semantic-loader-status');
            const m = semanticLoader.querySelector('[data-loader-msg]');
            if (!s || !m) return;
            s.classList.add('is-swapping');
            setTimeout(() => {
                m.textContent = SEMANTIC_STATUS[idx];
                s.classList.remove('is-swapping');
            }, 220);
        }, 1300);
    }

    function hideSemanticLoader() {
        if (!semanticLoader || !semanticLoaderActive) return;
        semanticLoaderActive = false;
        clearInterval(semanticLoaderTimer);
        semanticLoaderTimer = null;
        semanticLoader.classList.add('is-leaving');
        setTimeout(() => {
            if (semanticLoader) {
                semanticLoader.classList.remove('is-active', 'is-leaving');
                semanticLoader.hidden = true;
                semanticLoader.setAttribute('aria-hidden', 'true');
            }
        }, 300);
    }

    // NOTE: the AI bar used to disable itself on load behind a one-shot
    // `ensureSupabaseAvailable()` probe, swapping in an "Unavailable in NIC
    // Network" placeholder. That gate is gone. Two reasons:
    //
    //   1. It is no longer true. NIC reaches the backend through the
    //      api.alldeputations.com proxy, so the AI endpoint works there.
    //   2. It failed open in the wrong direction. The probe ran once at
    //      startup and its result was permanent — a single slow or dropped
    //      probe (which happens on any congested network, NIC or not) left
    //      the box greyed out and untypable for the rest of the session with
    //      no way back, even though the endpoint was fine.
    //
    // Reachability is now judged per-request at the point of the search, where
    // a failure is recoverable and the next query gets a fresh verdict.

    function hideSemanticResults() {
        if (semanticResults) semanticResults.hidden = true;
        if (semanticResultsList) semanticResultsList.innerHTML = '';
        if (semanticResultsStatus) semanticResultsStatus.textContent = '';
    }

    function showSemanticMessage(text) {
        if (!semanticResults || !semanticResultsList || !semanticResultsStatus) return;
        semanticResults.hidden = false;
        semanticResultsList.innerHTML = '';
        semanticResultsStatus.textContent = text;
    }

    // Raw cosine similarity → a percentage a visitor can act on.
    //
    // The Edge Function returns cosine similarity between the query and the
    // vacancy's embedding. That number does NOT span 0-1 in practice. Each
    // vacancy is embedded as its whole record — post name + ministry +
    // location + level + eligibility + job description, ~100 words — so a
    // short query only ever overlaps a fraction of it. Two consequences:
    //
    //   * the ceiling is low: an exact post-name match measures ~0.64, never 1.0
    //   * the floor is high: any vacancy in the same broad domain sits ~0.45-0.55,
    //     because they share the boilerplate that dominates the record
    //
    // So the usable range is a narrow band well inside [0, 1]. Scaling against
    // the top hit instead (an earlier attempt) collapsed that band into 75-100%
    // and made loosely-related posts read as near-perfect matches. Rescaling
    // the real band to 0-100% and clamping is what makes the number mean
    // "how well does this match" rather than "where does this sit in the list".
    //
    // Measured 2026-08-03 against the live Edge Function, after the corpus was
    // re-embedded with RETRIEVAL_DOCUMENT / RETRIEVAL_QUERY:
    //
    //   query                                       top     10th
    //   "chief general manager finance and accounts" 0.727   0.623   (exact title)
    //   "managing director national high"            0.713   0.608   (exact title)
    //   "senior vice president in finance"           0.704   0.560   (exact title)
    //   "director"                                   0.635   0.600   (vague)
    //   "primary school teacher mathematics"         0.553   0.541   (off-domain)
    //   "zebra pineapple carburettor"                0.544   0.526   (nonsense)
    //   "software developer react native javascript" 0.531   0.525   (off-domain)
    //
    // A query that means nothing to this corpus peaks at ~0.545, so that's the
    // floor; the best an exact post-name match ever does is ~0.73, so that's
    // the ceiling. 100% stays just out of reach — an exact title reads 86-98%.
    //
    // RECALIBRATE after any change to what gets embedded or how (EMBED_FIELDS,
    // the model, or the taskType pair): all of those move the distribution.
    // Method is the table above — run a few exact-title queries and a few
    // deliberate nonsense ones, read the raw similarity off each row's title
    // attribute, and set FLOOR/CEIL just outside the nonsense peak and the
    // exact-match peak.
    const RELEVANCE_FLOOR = 0.55;   // at or below → 0%  (nonsense-query level)
    const RELEVANCE_CEIL  = 0.73;   // at or above → 100% (as close as this corpus gets)

    function relevancePercent(raw) {
        const span = RELEVANCE_CEIL - RELEVANCE_FLOOR;
        if (!(span > 0)) return 0;
        const t = (Number(raw) - RELEVANCE_FLOOR) / span;
        return Math.round(Math.max(0, Math.min(1, t)) * 100);
    }

    function renderSemanticResults(results) {
        if (!semanticResults || !semanticResultsList || !semanticResultsStatus) return;
        semanticResults.hidden = false;
        semanticResultsStatus.textContent =
            results.length === 0
                ? 'No AI matches — try different wording or use keywords.'
                : 'Ranked by how closely each vacancy matches your wording.';
        semanticResultsList.innerHTML = results.map((r) => {
            const post = escapeHtml(r.post_name || 'Untitled post');
            const subParts = [
                r.organisation,
                r.ministry,
                r.level ? 'L' + r.level : '',
            ].filter(Boolean);
            // Escape ONCE, on the joined string. Escaping each part and then
            // escaping the join double-encodes: "Micro, Small & Medium" came
            // out as "Micro, Small &amp;amp; Medium" on screen.
            const sub = escapeHtml(subParts.join(' · '));
            const raw = (typeof r.score === 'number') ? r.score : 0;
            const pct = relevancePercent(raw);
            return `<li data-vid="${escapeHtml(r.vacancy_id)}">
                <span class="semantic-relevance" title="cosine similarity ${raw.toFixed(3)}">
                    <span class="semantic-score">${pct}%</span>
                    <span class="semantic-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
                </span>
                <span class="semantic-result-meta">
                    <span class="semantic-result-post">${post}</span>
                    <span class="semantic-result-sub">${sub}</span>
                </span>
                <span class="semantic-result-open" aria-hidden="true">Open ›</span>
            </li>`;
        }).join('');
    }

    function scheduleSemanticSearch() {
        if (!aiSearchInput) return;
        clearTimeout(semanticTimer);
        const q = aiSearchInput.value.trim();
        if (q.length < 3) {
            // Cancelling the input is also "I'm done with results" — abort any
            // in-flight request so a late-resolving fetch can't repaint the
            // panel with stale matches after we've hidden it.
            if (semanticInflight && semanticInflight.abort) {
                try { semanticInflight.abort(); } catch { /* ignore */ }
            }
            hideSemanticResults();
            return;
        }
        semanticTimer = setTimeout(() => runSemanticSearch(q), 250);
    }

    async function runSemanticSearch(query) {
        if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
            showSemanticMessage('AI search unavailable — Supabase not configured. Use keywords.');
            return;
        }
        // P3-7 PR 1: pre-flight check via the one-time TLS probe. If Supabase
        // is known unreachable from this network (NIC middlebox fails the TLS
        // handshake), don't attempt the fetch at all — render a friendly
        // inline message and skip the cross-origin Edge Function call.
        // Awaits the probe so we don't race a real fetch against an in-flight
        // HEAD; the probe itself is bounded by a 2 s timeout.
        const available = await window.ensureSupabaseAvailable();
        if (!available) {
            showSemanticMessage(
                'AI search unavailable on this network. Use the keyword search above.'
            );
            return;
        }
        // Cancel any in-flight request before starting a new one.
        if (semanticInflight && semanticInflight.abort) {
            try { semanticInflight.abort(); } catch { /* ignore */ }
        }
        const ctrl = new AbortController();
        semanticInflight = ctrl;
        showSemanticMessage('Finding AI-ranked matches…');
        // v7.3.13: only show the neural loader AFTER the Supabase probe
        // succeeds — NIC users (who fail the probe) never see it. The
        // loader auto-truncates in `finally` below, so it never outlasts
        // the real response even if the response is fast.
        showSemanticLoader(query);

        try {
            const url = `${window.SUPABASE_URL}/functions/v1/semantic-search`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': window.SUPABASE_ANON_KEY,
                    'Authorization': 'Bearer ' + window.SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({ query, k: 5 }),
                signal: ctrl.signal,
            });
            // The signal may have aborted because a newer keystroke fired.
            if (ctrl.signal.aborted) return;
            // The input may have been cleared while the fetch was in flight.
            // Repainting now would resurrect the stale panel the user just
            // dismissed; only render if the current input still matches the
            // query we searched for.
            if (!aiSearchInput || aiSearchInput.value.trim() !== query) return;
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body.ok === false) {
                if (body && body.code === 'disabled') {
                    showSemanticMessage(
                        '✨ AI search temporarily unavailable (free-tier limit). ' +
                        'Available again after midnight UTC. Keyword search still works.');
                } else {
                    showSemanticMessage(
                        'AI search unavailable right now. Try keywords, or retry in a minute.');
                }
                return;
            }
            const results = Array.isArray(body.results) ? body.results : [];
            renderSemanticResults(results);
        } catch (e) {
            if (e && e.name === 'AbortError') return;   // superseded by newer keystroke
            console.warn('[semantic] fetch failed:', e);
            showSemanticMessage('AI search unavailable — try keywords instead.');
        } finally {
            if (semanticInflight === ctrl) semanticInflight = null;
            hideSemanticLoader();
        }
    }

    // The dedicated AI bar (below the KPI grid) is the single driver of the
    // semantic-search Edge Function. The sidebar #searchPost input is the
    // keyword path only — typing there does NOT trigger /semantic-search.
    if (aiSearchInput) {
        aiSearchInput.addEventListener('input', scheduleSemanticSearch);
    }
    // Click a ranked-match row → open the existing vacancy modal. Uses
    // event delegation so we don't have to rebind when the panel re-renders.
    if (semanticResultsList) {
        semanticResultsList.addEventListener('click', (e) => {
            const li = e.target.closest('li[data-vid]');
            if (!li) return;
            const vid = li.getAttribute('data-vid');
            if (vid && typeof openVacancyModal === 'function') {
                openVacancyModal(vid);
            }
        });
    }
});
