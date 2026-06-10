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

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m]));
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
          <span class="ms-opt-label">${esc(v)}</span>
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
    setTimeout(() => search.focus(), 0);
  }
  function close() {
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
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
    populate(arr) {
      items = (arr || []).slice();
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
    const filterMyPayLevel = document.getElementById('filterMyPayLevel');
    const filterExperience = document.getElementById('filterExperience');
    const filterLevel = document.getElementById('filterLevel');
    const filterMinistry = document.getElementById('filterMinistry');
    const filterLocation = createMultiSelect(document.getElementById('filterLocationMS'), {
      placeholder: 'All Locations',
      singularPattern: (v) => v,
      multiPattern: (n) => `${n} locations`,
    });
    const filterStatus = document.getElementById('filterStatus');

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
        pageSize: 10
    };

    let quickFilters = {
        closing7: false,
        delhiNcr: false,
        closingToday: false
    };

    let searchSuggestions = [];
    let searchDatalist = null;
    let quickFiltersBar = null;

   initializeEnhancements();
initializeMobileFilterAccordion();
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
    t.innerHTML = `
      <span class="home-toast-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></svg>
      </span>
      <span class="home-toast-msg"></span>
      <button type="button" class="home-toast-close" aria-label="Dismiss">×</button>`;
    document.body.appendChild(t);
    t.querySelector('.home-toast-close').addEventListener('click', () => {
      t.classList.remove('show');
      try { sessionStorage.setItem('payLevelToastDismissed', '1'); } catch (e) {}
    });
  }
  t.querySelector('.home-toast-msg').innerHTML = html;
  // Allow the element to be in the DOM before transitioning.
  setTimeout(() => t.classList.add('show'), 30);
  setTimeout(() => t.classList.remove('show'), 6500);
}

 function getCurrentPageSize() {
  return currentView === 'card' ? 9 : 10;
}   

function loadDataFromJSON() {
    fetchVacancies()
        .then(data => {
            rawData = data;

            reconcileWatchlistWithData();
            populateFilters();
            hydrateFiltersFromUrl();
            autoselectPayLevelFromProfile();
            buildSearchSuggestions();
            bindEvents();
            updateQuickFiltersBar();
            applyMobileDefaultView();
            renderDashboard();
            lucide.createIcons();

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

// Source of truth = Supabase (approved rows only, enforced by RLS). Until
// Supabase is configured in config.js, fall back to the committed JSON so the
// site keeps working. Both paths run through the shared enrich.js so the
// rendered records have identical derived fields.
function fetchVacancies() {
    const enrich = (rows) =>
        (window.DepEnrich ? window.DepEnrich.enrichAll(rows) : rows);

    if (window.SUPABASE_READY && window.SUPABASE_READY()) {
        const url = `${window.SUPABASE_URL}/rest/v1/vacancies` +
            `?status=eq.approved&select=*`;
        return fetch(url, {
            headers: {
                apikey: window.SUPABASE_ANON_KEY,
                Authorization: `Bearer ${window.SUPABASE_ANON_KEY}`,
            },
        })
        .then(res => { if (!res.ok) throw new Error('Supabase ' + res.status); return res.json(); })
        .then(rows => {
            // Supabase is the source of truth. 0 approved rows = genuinely empty
            // (show the empty state), NOT a reason to resurrect old dummy data.
            console.log('📡 Source: Supabase', (rows || []).length, 'approved rows');
            return enrich(rows || []);
        });
    }

    console.log('📄 Source: data/vacancies.json (Supabase not configured)');
    return fetch('data/vacancies.json').then(res => res.json());
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
        // multi-select: ?location=a,b,c
        if (params.has('location')) {
          const arr = (params.get('location') || '').split(',').map(s => s.trim()).filter(Boolean);
          if (arr.length) filterLocation.__pendingValues = arr;
        }
        if (params.has('status')) filterStatus.value = params.get('status');

        const quick = (params.get('quick') || '').split(',').filter(Boolean);
        if (quick.includes('closing7')) quickFilters.closing7 = true;
        if (quick.includes('closingToday')) quickFilters.closingToday = true;
        if (quick.includes('delhiNcr')) quickFilters.delhiNcr = true;

        if (params.get('watchlist') === '1') showWatchlistOnly = true;
    } catch (e) {
        console.warn('URL param hydration skipped:', e);
    }
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
                <i data-lucide="sliders-horizontal"></i>
                <span class="mobile-filter-toggle-label">Show Filters</span>
            </span>
            <span class="mobile-filter-toggle-right">
                <i data-lucide="chevron-down" class="mobile-filter-chevron"></i>
            </span>
        `;
        filtersSidebar.insertBefore(toggleBtn, filtersSidebar.firstChild);
    }

    toggleBtn.addEventListener('click', () => {
        if (window.innerWidth > 768) return;

        filtersSidebar.classList.toggle('collapsed');
        updateMobileFilterToggle();
        lucide.createIcons();
    });

    applyMobileFilterDefaultState();
    window.addEventListener('resize', applyMobileFilterDefaultState);
    lucide.createIcons();
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
        dataContainer.innerHTML = `
            <div class="loading-shell">
                <div class="loading-header-skeleton shimmer"></div>

                <div class="loading-kpi-row">
                    <div class="loading-kpi-card shimmer"></div>
                    <div class="loading-kpi-card shimmer"></div>
                    <div class="loading-kpi-card shimmer"></div>
                    <div class="loading-kpi-card shimmer"></div>
                </div>

                <div class="loading-table-shell">
                    <div class="loading-table-toolbar shimmer"></div>
                    <div class="loading-row shimmer"></div>
                    <div class="loading-row shimmer"></div>
                    <div class="loading-row shimmer"></div>
                    <div class="loading-row shimmer"></div>
                    <div class="loading-row shimmer"></div>
                </div>
            </div>
        `;
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
      if (e.target === modal) {
        closeVacancyModal();
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
        openVacancyModal(vacancyId);
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
      closeVacancyModal();
    }
  });
}

function renderTable(data) {
  const hasSavedAny = watchlist.size > 0;

  const rows = data.map((item) => {
    const vacancyId = safe(item.Vacancy_ID);
    const saved = watchlist.has(vacancyId);
    const daysLeft = parseInt(item.Days_Left, 10);
    const closingSoon = !Number.isNaN(daysLeft) && daysLeft >= 0 && daysLeft <= 15;
    const notificationLink = normalizeUrl(safe(item.Official_Notification_Link));
    const applyLink = normalizeUrl(safe(item.Application_Form_Link));

    const notificationDateDisplay = formatDisplayDate(safe(item.Notification_Date));
    const notificationDateText =
      notificationDateDisplay && notificationDateDisplay !== 'Not specified'
        ? notificationDateDisplay
        : '—';

    return `
      <tr class="clickable-row ${saved ? 'row-bookmarked' : ''}" data-open-details="${escapeHtml(vacancyId)}">
        <td class="post-col" data-label="Post Name">
          <strong>${escapeHtml(safe(item.Post_Name) || '—')}</strong>
          <div class="table-subtext">
            ${escapeHtml(safe(item.Department_Organisation) || '')}
          </div>
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

        <td class="location-col" data-label="Location">
          ${escapeHtml(formatLocation(item) || '—')}
        </td>

        <td class="days-col" data-label="Days Left">
          <span class="days-pill days-pill-${getDaysLeftTone(daysLeft)}">
            ${escapeHtml(formatDaysLeft(daysLeft))}
          </span>
        </td>

        <td class="notification-date-col" data-label="Notification Date">
          ${escapeHtml(notificationDateText)}
        </td>

        <td class="table-link-cell" data-label="Notification">
          ${notificationLink ? `
            <a
              class="table-link-btn"
              href="${escapeHtml(notificationLink)}"
              target="_blank"
              rel="noopener noreferrer"
              onclick="event.stopPropagation();"
            >
              Notification
            </a>
          ` : '—'}
          ${item.Source_Ref
            ? `<div class="table-source-line"><span class="source-badge" title="${escapeHtml(safe(item['Source Category']))}">${escapeHtml(item.Source_Ref)}</span></div>`
            : ''}
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
            <i data-lucide="heart"></i>
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
            <th class="table-link-cell">Notification</th>
            <th
              class="save-col save-col-heading ${hasSavedAny ? 'has-saved' : ''}"
              title="${hasSavedAny ? 'Bookmarks saved' : 'No bookmarks yet'}"
              aria-label="Bookmark"
            >
              <i data-lucide="bookmark"></i>
            </th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
    
    function populateFilters() {
        filterMyPayLevel.innerHTML = '<option value="">Any Level</option>';
        for (let i = 18; i >= 1; i--) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = `Level ${i}`;
            filterMyPayLevel.appendChild(opt);
            // the exceptional 13A grade sits between 14 and 13 (descending list)
            if (i === 14) {
                const a = document.createElement('option');
                a.value = '13A';
                a.textContent = 'Level 13A';
                filterMyPayLevel.appendChild(a);
            }
        }

        if (filterExperience) {
            filterExperience.innerHTML = '<option value="">Any</option>';
            for (let y = 0; y <= 10; y++) {
                const opt = document.createElement('option');
                opt.value = String(y);
                opt.textContent = y === 10 ? '10+ years' : (y === 1 ? '1 year' : `${y} years`);
                filterExperience.appendChild(opt);
            }
            syncExperienceState();
        }

        filterLevel.innerHTML = '<option value="">All Levels</option>';
        filterMinistry.innerHTML = '<option value="">All Ministries</option>';
        // (no-op for the multi-select; items populated below)

        const levels = uniqueSorted(rawData.map(i => i.Level_Text));
        const ministries = uniqueSorted(rawData.map(i => i.Ministry));
        const locations = uniqueSorted(rawData.map(i => formatLocation(i)).filter(Boolean));

        addOptions(filterLevel, levels);
        addOptions(filterMinistry, ministries);
        filterLocation.populate(locations);
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

    function bindEvents() {
  searchPost.addEventListener('input', () => {
    refreshSearchSuggestions(searchPost.value);
    onFilterChange();
  });

  [
    filterMyPayLevel,
    filterExperience,
    filterLevel,
    filterMinistry,
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
      updateQuickFiltersBar();
      renderDashboard();
    });
  }

  clearFiltersBtn.addEventListener('click', () => {
    searchPost.value = '';
    filterMyPayLevel.value = '';
    if (filterExperience) filterExperience.value = '';
    filterLevel.value = '';
    filterMinistry.value = '';
    filterLocation.setValues([]);
    filterStatus.value = 'Active';
    showWatchlistOnly = false;
    kpiFilter = 'all';

    quickFilters = {
      closing7: false,
      delhiNcr: false,
      closingToday: false
    };

    pagination.currentPage = 1;
    updateQuickFiltersBar();
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
    if (filterName === 'location') filterLocation.setValues([]);
    if (filterName && filterName.startsWith('location:')) {
      const v = filterName.slice('location:'.length);
      filterLocation.setValues(filterLocation.values.filter(x => x !== v));
    }
    if (filterName === 'status') filterStatus.value = '';
    if (filterName === 'watchlist') showWatchlistOnly = false;
    if (filterName === 'kpi') kpiFilter = 'all';

    pagination.currentPage = 1;
    renderDashboard();
  });

kpiGrid.addEventListener('click', (e) => {
  const card = e.target.closest('[data-kpi-filter]');
  if (!card) return;

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

    const pageBtn = e.target.closest('[data-page]');
    if (pageBtn) {
      const page = Number(pageBtn.getAttribute('data-page'));
      if (!Number.isNaN(page)) {
        pagination.currentPage = page;
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
        renderDashboard();
    }

    // Years-of-experience only makes sense relative to a chosen pay level, so the
    // dropdown is disabled (showing "Select Pay Level first") until My Pay Level is
    // set; clearing the level disables and resets it. Called from renderDashboard,
    // so every path (filter change, Clear All, chip removal, URL load, profile
    // autoselect) keeps it in sync.
    function syncExperienceState() {
        if (!filterExperience) return;
        const placeholder = filterExperience.querySelector('option[value=""]');
        if (filterMyPayLevel.value) {
            filterExperience.disabled = false;
            if (placeholder) placeholder.textContent = 'Any';
        } else {
            if (filterExperience.value) filterExperience.value = '';
            filterExperience.disabled = true;
            if (placeholder) placeholder.textContent = 'Select Pay Level first';
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
  let filteredData = getFilteredData({ applyKpiFilter: true });

  filteredData = sortData(filteredData);

  const pageSize = getCurrentPageSize();
  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));

  if (resetPageIfNeeded) {
    pagination.currentPage = Math.min(pagination.currentPage, totalPages);
  } else if (pagination.currentPage > totalPages) {
    pagination.currentPage = totalPages;
  }

  const pagedData = paginateData(filteredData, pageSize);

  renderKPIs(baseFilteredData);
  renderActiveFilterChips();
  renderResults(pagedData, filteredData.length, totalPages);
  updateWatchlistUI();
  updateQuickFiltersBar();

  const start = filteredData.length === 0
    ? 0
    : ((pagination.currentPage - 1) * pageSize) + 1;

  const end = Math.min(pagination.currentPage * pageSize, filteredData.length);

  resultsCount.textContent = filteredData.length
    ? `${start}-${end} of ${filteredData.length} vacancies`
    : '0 vacancies';

  lucide.createIcons();
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
}
    function getFilteredData({ applyKpiFilter = true, applyStatusFilter = true } = {}) {
  const search = searchPost.value.trim().toLowerCase();
  const myPayLevel = filterMyPayLevel.value;
  const myYears = filterExperience ? filterExperience.value : '';
  const level = filterLevel.value;
  const ministry = filterMinistry.value;
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

    const searchableText = [
      item.Post_Name,
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
      item.Department
    ].map(safe).join(' ').toLowerCase();

    if (search && !fuzzyIncludes(search, searchableText)) return false;
    if (level && itemLevel !== level) return false;
    if (ministry && itemMinistry !== ministry) return false;
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
    ${buildKpiCard('Active', current.active, 'check-circle-2', 'green', activeDelta, 'active')}
    ${buildKpiCard('Closing Soon', current.closingSoon, 'clock-3', 'red', closingSoonDelta, 'closingSoon')}
   ${buildKpiCard('Ministries', current.ministries, 'building-2', 'purple', ministriesDelta, 'ministries')}
  `;

  animateKpiCounters();
  previousKpiSnapshot = current;
}

   function buildKpiCard(title, value, icon, tone, delta, filterKey = 'all') {
  const trendClass = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const trendSymbol = delta > 0 ? '↑' : delta < 0 ? '↓' : '•';
  const trendText = delta === 0 ? 'No change' : `${trendSymbol} ${Math.abs(delta)}`;
  const isSelected = kpiFilter === filterKey;

  return `
    <button
      type="button"
      class="kpi-card kpi-${tone} kpi-clickable ${isSelected ? 'kpi-selected' : ''}"
      data-kpi-filter="${filterKey}"
      aria-pressed="${isSelected ? 'true' : 'false'}"
      title="Filter by ${title}"
    >
      <div class="kpi-icon">
        <i data-lucide="${icon}"></i>
      </div>
      <div class="kpi-title">${title}</div>
      <div class="kpi-value" data-count="${value}">0</div>
      <div class="kpi-trend ${trendClass}">
        ${trendText}
      </div>
    </button>
  `;
}

    function animateKpiCounters() {
        const counters = kpiGrid.querySelectorAll('.kpi-value[data-count]');

        counters.forEach(counter => {
            const target = Number(counter.getAttribute('data-count')) || 0;
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
        });
    }

    function updateWatchlistUI() {
    const savedCount = watchlist.size;
    const hasSaved = savedCount > 0;

    favCount.textContent = String(savedCount);

    favBtn.classList.toggle('has-saved', hasSaved);
    favBtn.classList.toggle('active-watchlist', showWatchlistOnly);

    favBtn.setAttribute('aria-pressed', String(showWatchlistOnly));

    if (showWatchlistOnly) {
        favBtn.title = 'Showing bookmarked vacancies';
    } else if (hasSaved) {
        favBtn.title = 'Show bookmarked vacancies';
    } else {
        favBtn.title = 'No bookmarked vacancies yet';
    }
}
   function renderActiveFilterChips() {
  const chips = [];

  if (searchPost.value.trim()) chips.push(makeChip('search', `Search: ${escapeHtml(searchPost.value.trim())}`));
  if (filterMyPayLevel.value) chips.push(makeChip('myPayLevel', `My Pay Level: Level ${filterMyPayLevel.value}`));
  if (filterExperience && filterExperience.value) chips.push(makeChip('experience', `Experience: ${filterExperience.value === '10' ? '10+' : escapeHtml(filterExperience.value)} yr`));
  if (filterLevel.value) chips.push(makeChip('level', `Pay Level: ${escapeHtml(filterLevel.value)}`));
  if (filterMinistry.value) chips.push(makeChip('ministry', `Ministry: ${escapeHtml(filterMinistry.value)}`));
  filterLocation.values.forEach(loc => {
    chips.push(makeChip(`location:${loc}`, `Location: ${escapeHtml(loc)}`));
  });
  if (filterStatus.value) chips.push(makeChip('status', `Status: ${escapeHtml(filterStatus.value)}`));
  if (showWatchlistOnly) chips.push(makeChip('watchlist', 'Watchlist'));

  if (kpiFilter === 'active') chips.push(makeChip('kpi', 'KPI: Active'));
  if (kpiFilter === 'closingSoon') chips.push(makeChip('kpi', 'KPI: Closing Soon'));

  activeFilters.innerHTML = chips.join('');
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
        themeToggle.innerHTML =
            theme === 'light'
                ? '<i data-lucide="sun"></i>'
                : '<i data-lucide="moon"></i>';

        themeToggle.title =
            theme === 'light'
                ? 'Switch to dark mode'
                : 'Switch to light mode';
    }

    lucide.createIcons();
}

    function renderResults(data, totalCount, totalPages) {
        if (!totalCount) {
            const message = showWatchlistOnly
                ? (watchlist.size
                    ? 'No saved vacancies match the current filters.'
                    : 'No saved vacancies yet. Click the heart on any vacancy to save it.')
                : 'No vacancies match the current filters.';

            dataContainer.className = `data-container view-${currentView}`;
            dataContainer.innerHTML = `
                <div class="empty-state">
                    ${escapeHtml(message)}
                </div>
            `;
            return;
        }

        dataContainer.className = `data-container view-${currentView}`;
        dataContainer.innerHTML = `
            ${renderTable(data)}
            ${renderCards(data)}
            ${renderPagination(totalPages)}
        `;
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

   function renderCards(data) {
  const cards = data.map((item) => {
    const vacancyId = safe(item.Vacancy_ID);
    const saved = watchlist.has(vacancyId);
    const daysLeft = parseInt(item.Days_Left, 10);
    const expired = !Number.isNaN(daysLeft) && daysLeft < 0;

    const detailedNotificationLink = normalizeUrl(safe(item.Official_Notification_Link));
    const applyLink = normalizeUrl(safe(item.Application_Form_Link));

    const notificationDateDisplay = formatDisplayDate(safe(item.Notification_Date));
    const notificationDateText =
      notificationDateDisplay && notificationDateDisplay !== 'Not specified'
        ? notificationDateDisplay
        : 'Not specified';

    return `
      <div class="job-card premium-card clickable-card" data-open-details="${escapeHtml(vacancyId)}">
        <button
          type="button"
          class="card-heart-btn ${saved ? 'saved' : ''}"
          data-card-action="watchlist"
          data-id="${escapeHtml(vacancyId)}"
          title="Bookmark the Vacancy"
          aria-label="${saved ? 'Remove bookmarked vacancy' : 'Bookmark the Vacancy'}"
          aria-pressed="${saved ? 'true' : 'false'}"
        >
          <i data-lucide="heart"></i>
        </button>

        <div class="job-card-top">
          <div class="job-meta-row">
            <span class="meta-pill meta-pill-level">
              ${escapeHtml(safe(item.Level_Text) || '—')}
            </span>
            <span class="meta-pill meta-pill-eligibility">
              Eligible: ${escapeHtml(formatEligibility(item))}
            </span>
          </div>

          <div class="job-title-block">
            <div class="job-title">${escapeHtml(safe(item.Post_Name) || '—')}</div>
            <div class="job-org">
              ${escapeHtml(withAcronym(item.Ministry) || withAcronym(item.Department_Organisation) || '—')}
            </div>
          </div>
        </div>

        <div class="job-highlight-row">
          <div class="highlight-box ${expired ? 'highlight-expired' : 'highlight-normal'}">
            <div class="highlight-label">Days Left</div>
            <div class="highlight-value">
              <span class="days-pill days-pill-${getDaysLeftTone(daysLeft)}">
                ${escapeHtml(formatDaysLeft(daysLeft))}
              </span>
            </div>
          </div>

          <div class="highlight-box">
            <div class="highlight-label">Notification Date</div>
            <div class="highlight-value">
              <span class="notification-date-chip">
                ${escapeHtml(notificationDateText)}
              </span>
            </div>
          </div>
        </div>

        <div class="job-details premium-details">
          <div class="detail-item">
            <span class="detail-label">Location</span>
            <span class="detail-value">${escapeHtml(formatLocation(item) || '—')}</span>
          </div>

          <div class="detail-item">
            <span class="detail-label">Organisation</span>
            <span class="detail-value">${escapeHtml(orgAcronym(item) || safe(item.Department_Organisation) || '—')}</span>
          </div>

          <div class="detail-item">
            <span class="detail-label">Level</span>
            <span class="detail-value">${escapeHtml(safe(item.Level_Text) || '—')}</span>
          </div>

          <div class="detail-item">
            <span class="detail-label">Eligibility</span>
            <span class="detail-value">${escapeHtml(formatEligibility(item))}</span>
          </div>
        </div>

        ${(detailedNotificationLink || item.Source_Ref) ? `
          <div class="job-card-footer">
            ${detailedNotificationLink ? `
              <a
                class="card-action-btn secondary"
                href="${escapeHtml(detailedNotificationLink)}"
                target="_blank"
                rel="noopener noreferrer"
                onclick="event.stopPropagation();"
              >
                Notification
              </a>
            ` : ''}

            ${item.Source_Ref ? `
              <span class="card-source-badge" title="${escapeHtml(safe(item['Source Category']))}">
                ${escapeHtml(item.Source_Ref_Long || item.Source_Ref)}
              </span>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `<div class="cards-grid premium-cards-grid">${cards}</div>`;
}

    function renderPagination(totalPages) {
  if (totalPages <= 1) return '';

  const pages = [];
  const current = pagination.currentPage;

  for (let i = 1; i <= totalPages; i++) {
    pages.push(`
      <button
        type="button"
        class="page-btn ${i === current ? 'active' : ''}"
        data-page="${i}"
      >
        ${i}
      </button>
    `);
  }

  return `
    <div class="pagination-bar">
      <button
        type="button"
        class="page-nav-btn"
        data-page-nav="first"
        data-total-pages="${totalPages}"
        ${current === 1 ? 'disabled' : ''}
      >
        First
      </button>

      <button
        type="button"
        class="page-nav-btn"
        data-page-nav="prev"
        data-total-pages="${totalPages}"
        ${current === 1 ? 'disabled' : ''}
      >
        Prev
      </button>

      <div class="page-numbers">
        ${pages.join('')}
      </div>

      <button
        type="button"
        class="page-nav-btn"
        data-page-nav="next"
        data-total-pages="${totalPages}"
        ${current === totalPages ? 'disabled' : ''}
      >
        Next
      </button>

      <button
        type="button"
        class="page-nav-btn"
        data-page-nav="last"
        data-total-pages="${totalPages}"
        ${current === totalPages ? 'disabled' : ''}
      >
        Last
      </button>
    </div>
  `;
}

    function setView(view, resetPage = false) {
  currentView = view;

  if (resetPage) {
    pagination.currentPage = 1;
  }

  btnTableView.classList.toggle('active', view === 'table');
  btnCardView.classList.toggle('active', view === 'card');

  renderDashboard(false);
}

    function openVacancyModal(vacancyId) {
        const item = getItemById(vacancyId);
        if (!item || !modal || !modalBody) return;

        modalBody.innerHTML = buildModalContent(item);
        modal.style.display = 'flex';
        lucide.createIcons();
        wireFlagUI(vacancyId);
    }

    function closeVacancyModal() {
        if (!modal || !modalBody) return;
        modal.style.display = 'none';
        modalBody.innerHTML = '';
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
                        ${buildModalField('Mode of Application', renderModeBadge(modeOfApplication), true)}
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

                <div class="modal-actions">
                    <button
                        type="button"
                        class="card-action-btn ${saved ? 'saved' : ''}"
                        data-modal-action="watchlist"
                        data-id="${escapeHtml(vacancyId)}"
                    >
                        ${saved ? 'Remove from Watchlist' : 'Save to Watchlist'}
                    </button>

                    ${detailedNotificationLink ? `
                        <a class="card-action-btn secondary" href="${escapeHtml(detailedNotificationLink)}" target="_blank" rel="noopener noreferrer">
                            Detailed Notification
                        </a>
                    ` : ''}

                    <button type="button" class="card-action-btn ghost flag-open-btn" data-flag-open="${escapeHtml(vacancyId)}">
                        <i data-lucide="flag"></i> Report an issue
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
                        <i data-lucide="thumbs-up"></i> ${endorsed ? 'Endorsed' : 'Endorse'} · <span class="flag-count">${Number(f.endorsements) || 0}</span>
                    </button>
                </div>
            </div>`;
    }

    function renderFlagList(listEl, flags) {
        if (!flagApiReady()) { listEl.innerHTML = '<div class="flag-status">Issue reporting isn\'t configured.</div>'; return; }
        listEl.innerHTML = flags.length
            ? flags.map(flagCardHtml).join('')
            : '<div class="flag-status">No issues reported yet. Spotted something wrong? Use “Report an issue”.</div>';
        if (window.lucide) lucide.createIcons();
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
                if (window.lucide) lucide.createIcons();
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

    function buildModalField(label, value, isHtml = false) {
        return `
            <div class="modal-field">
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

        if (watchlist.has(id)) {
            watchlist.delete(id);
        } else {
            watchlist.add(id);
        }

        persistWatchlist();
        updateWatchlistUI();
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
        return `${daysLeft} days`;
    }

    function getDaysLeftTone(daysLeft) {
  if (Number.isNaN(daysLeft)) return 'muted';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 15) return 'closing';
  return 'safe';
}

    function formatRichText(value) {
        return escapeHtml(safe(value))
            .replace(/\*\*(.+?)\*\*/g, '<strong class="rich-subhead">$1</strong>')
            .replace(/\n/g, '<br>');
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
        return `<span class="application-mode-badge ${getApplicationModeClass(safeMode)}">${escapeHtml(safeMode)}</span>`;
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
});
