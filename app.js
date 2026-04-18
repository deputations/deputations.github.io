document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 Deputation dashboard started');

    const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRtNK339wNsCATEu20kc0XPlFjHKKahfxZqunH3Gll2mA-9witdSGrKB3-1jmeauT5gbwkNg5Y8rCKk/pub?output=csv';
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
    const filterLevel = document.getElementById('filterLevel');
    const filterMinistry = document.getElementById('filterMinistry');
    const filterLocation = document.getElementById('filterLocation');
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

    let sortState = {
        key: 'Days_Left',
        direction: 'asc'
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
    
initializeModal();
updateWatchlistUI();

    loadDataFromJSON();

 function getCurrentPageSize() {
  return currentView === 'card' ? 9 : 10;
}   

function loadDataFromJSON() {
    fetch('data/vacancies.json')
        .then(res => res.json())
        .then(data => {
            rawData = data;

            reconcileWatchlistWithData();
            populateFilters();
            buildSearchSuggestions();
            bindEvents();
            updateQuickFiltersBar();
            applyMobileDefaultView();
            renderDashboard();
            lucide.createIcons();

            console.log('✅ Loaded', rawData.length, 'vacancies (JSON)');
        })
        .catch(err => {
            console.error('❌ JSON load failed:', err);
            dataContainer.innerHTML = `
                <div class="empty-state">
                    Failed to load data.
                </div>
            `;
        });
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
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', closeVacancyModal);
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
  const rows = data.map((item) => {
    const vacancyId = safe(item.Vacancy_ID);
    const saved = watchlist.has(vacancyId);
    const daysLeft = parseInt(item.Days_Left, 10);
    const closingSoon = !Number.isNaN(daysLeft) && daysLeft >= 0 && daysLeft <= 15;
    const notificationLink = normalizeUrl(safe(item.Official_Notification_Link));
    const applyLink = normalizeUrl(safe(item.Application_Form_Link));

    return `
      <tr class="clickable-row" data-open-details="${escapeHtml(vacancyId)}">
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
          ${escapeHtml(safe(item.Ministry) || '—')}
        </td>

        <td class="location-col" data-label="Location">
          ${escapeHtml(formatLocation(item) || '—')}
        </td>

        <td class="days-col days-left ${closingSoon ? 'closing' : ''}" data-label="Days Left">
          ${escapeHtml(formatDaysLeft(daysLeft))}
        </td>

        <td class="status-col" data-label="Status">
          <span class="badge ${safe(item.Status) === 'Active' ? 'badge-active' : ''}">
            ${escapeHtml(safe(item.Status) || '—')}
          </span>
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
        </td>

        <td class="table-link-cell" data-label="Apply">
          ${applyLink ? `
            <a
              class="table-link-btn apply"
              href="${escapeHtml(applyLink)}"
              target="_blank"
              rel="noopener noreferrer"
              onclick="event.stopPropagation();"
            >
              Apply
            </a>
          ` : '—'}
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
            <i data-lucide="bookmark"></i>
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
            ${renderSortableHeader('Location', 'Location', 'location-col')}
            ${renderSortableHeader('Days Left', 'Days_Left', 'days-col')}
            ${renderSortableHeader('Status', 'Status', 'status-col')}
            <th class="table-link-cell">Notification</th>
            <th class="table-link-cell">Apply</th>
            <th class="save-col save-col-heading" title="Bookmark" aria-label="Bookmark">
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
        }

        filterLevel.innerHTML = '<option value="">All Levels</option>';
        filterMinistry.innerHTML = '<option value="">All Ministries</option>';
        filterLocation.innerHTML = '<option value="">All Locations</option>';

        const levels = uniqueSorted(rawData.map(i => i.Level_Text));
        const ministries = uniqueSorted(rawData.map(i => i.Ministry));
        const locations = uniqueSorted(rawData.map(i => formatLocation(i)).filter(Boolean));

        addOptions(filterLevel, levels);
        addOptions(filterMinistry, ministries);
        addOptions(filterLocation, locations);
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
            filterLevel,
            filterMinistry,
            filterLocation,
            filterStatus
        ].forEach(el => {
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
            filterLevel.value = '';
            filterMinistry.value = '';
            filterLocation.value = '';
            filterStatus.value = 'Active';
            showWatchlistOnly = false;

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
            currentView = 'table';
            btnTableView.classList.add('active');
            btnCardView.classList.remove('active');
            renderDashboard(false);
        });

        btnCardView.addEventListener('click', () => {
            currentView = 'card';
            btnCardView.classList.add('active');
            btnTableView.classList.remove('active');
            renderDashboard(false);
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
            if (filterName === 'level') filterLevel.value = '';
            if (filterName === 'ministry') filterMinistry.value = '';
            if (filterName === 'location') filterLocation.value = '';
            if (filterName === 'status') filterStatus.value = '';
            if (filterName === 'watchlist') showWatchlistOnly = false;

            pagination.currentPage = 1;
            renderDashboard();
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth <= 768 && currentView !== 'card') {
                currentView = 'card';
                btnCardView.classList.add('active');
                btnTableView.classList.remove('active');
                renderDashboard(false);
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

                if (action === 'prev' && pagination.currentPage > 1) {
                    pagination.currentPage--;
                } else if (action === 'next' && pagination.currentPage < totalPages) {
                    pagination.currentPage++;
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

            btnTableView.addEventListener('click', () => {
  currentView = 'table';
  pagination.currentPage = 1;
  btnTableView.classList.add('active');
  btnCardView.classList.remove('active');
  renderDashboard(false);
});

btnCardView.addEventListener('click', () => {
  currentView = 'card';
  pagination.currentPage = 1;
  btnCardView.classList.add('active');
  btnTableView.classList.remove('active');
  renderDashboard(false);
});

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
  let filteredData = getFilteredData();
  filteredData = sortData(filteredData);

  const pageSize = getCurrentPageSize();
  const totalPages = Math.max(1, Math.ceil(filteredData.length / pageSize));

  if (resetPageIfNeeded) {
    pagination.currentPage = Math.min(pagination.currentPage, totalPages);
  } else if (pagination.currentPage > totalPages) {
    pagination.currentPage = totalPages;
  }

  const pagedData = paginateData(filteredData, pageSize);

  renderKPIs(filteredData);
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
        }
    }

    function getFilteredData() {
        const search = searchPost.value.trim().toLowerCase();
        const myPayLevel = filterMyPayLevel.value;
        const level = filterLevel.value;
        const ministry = filterMinistry.value;
        const location = filterLocation.value;
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
                item.Desirable_Qualification
            ].map(safe).join(' ').toLowerCase();

            if (search && !fuzzyIncludes(search, searchableText)) return false;
            if (level && itemLevel !== level) return false;
            if (ministry && itemMinistry !== ministry) return false;
            if (location && itemLocation !== location) return false;
            if (status && itemStatus !== status) return false;

            if (myPayLevel) {
                const userLevel = Number(myPayLevel);
                const req1 = parseLevelValue(item.Req_Level1);
                const req2 = parseLevelValue(item.Req_Level2);

                if (req1 !== null && req2 !== null) {
                    const minReq = Math.min(req1, req2);
                    const maxReq = Math.max(req1, req2);
                    if (userLevel < minReq || userLevel > maxReq) return false;
                } else if (req1 !== null) {
                    if (userLevel !== req1) return false;
                } else if (req2 !== null) {
                    if (userLevel !== req2) return false;
                } else {
                    return false;
                }
            }

            if (showWatchlistOnly && !watchlist.has(itemId)) return false;
            if (!Number.isNaN(itemDaysLeft) && status === 'Active' && itemDaysLeft < 0) return false;

            if (quickFilters.closing7) {
                if (Number.isNaN(itemDaysLeft) || itemDaysLeft < 0 || itemDaysLeft > 7) return false;
            }

            if (quickFilters.closingToday) {
                if (Number.isNaN(itemDaysLeft) || itemDaysLeft !== 0) return false;
            }

            if (quickFilters.delhiNcr) {
                if (!isDelhiNcrLocation(item)) return false;
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
                case 'Location':
                    aVal = formatLocation(a).toLowerCase();
                    bVal = formatLocation(b).toLowerCase();
                    break;
                case 'Days_Left':
                    aVal = parseNumericSafe(a.Days_Left, Number.MAX_SAFE_INTEGER);
                    bVal = parseNumericSafe(b.Days_Left, Number.MAX_SAFE_INTEGER);
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
            ${buildKpiCard('Total Vacancies', current.total, 'briefcase', 'cyan', totalDelta)}
            ${buildKpiCard('Active', current.active, 'check-circle-2', 'green', activeDelta)}
            ${buildKpiCard('Closing Soon', current.closingSoon, 'clock-3', 'red', closingSoonDelta)}
            ${buildKpiCard('Ministries', current.ministries, 'building-2', 'purple', ministriesDelta)}
        `;

        animateKpiCounters();
        previousKpiSnapshot = current;
    }

    function buildKpiCard(title, value, icon, tone, delta) {
        const trendClass = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
        const trendSymbol = delta > 0 ? '↑' : delta < 0 ? '↓' : '•';
        const trendText = delta === 0 ? 'No change' : `${trendSymbol} ${Math.abs(delta)}`;

        return `
            <div class="kpi-card kpi-${tone}">
                <div class="kpi-icon">
                    <i data-lucide="${icon}"></i>
                </div>

                <div class="kpi-title">${title}</div>

                <div class="kpi-value" data-count="${value}">0</div>

                <div class="kpi-trend ${trendClass}">
                    ${trendText}
                </div>
            </div>
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
        if (filterLevel.value) chips.push(makeChip('level', `Pay Level: ${escapeHtml(filterLevel.value)}`));
        if (filterMinistry.value) chips.push(makeChip('ministry', `Ministry: ${escapeHtml(filterMinistry.value)}`));
        if (filterLocation.value) chips.push(makeChip('location', `Location: ${escapeHtml(filterLocation.value)}`));
        if (filterStatus.value) chips.push(makeChip('status', `Status: ${escapeHtml(filterStatus.value)}`));
        if (showWatchlistOnly) chips.push(makeChip('watchlist', 'Watchlist'));

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

  /* ===== LIGHT MODE CARD READABILITY POLISH ===== */

[data-theme="light"] .job-card,
[data-theme="light"] .premium-card {
  background: linear-gradient(
    165deg,
    rgba(255, 255, 255, 0.94),
    rgba(244, 247, 251, 0.96)
  ) !important;
  border-color: rgba(15, 23, 42, 0.10) !important;
  box-shadow:
    0 10px 24px rgba(15, 23, 42, 0.08),
    0 1px 0 rgba(255,255,255,0.9) inset !important;
}

[data-theme="light"] .job-card:hover,
[data-theme="light"] .premium-card:hover {
  border-color: rgba(2, 132, 199, 0.18) !important;
  box-shadow:
    0 14px 30px rgba(15, 23, 42, 0.10),
    0 0 0 1px rgba(2,132,199,0.06) !important;
}

/* title + subtitle */
[data-theme="light"] .job-title {
  color: #0f172a !important;
  letter-spacing: -0.03em;
}

[data-theme="light"] .job-org {
  color: #475569 !important;
  font-weight: 500;
}

/* pills on top */
[data-theme="light"] .meta-pill {
  background: rgba(248, 250, 252, 0.96) !important;
  border-color: rgba(15, 23, 42, 0.10) !important;
  color: #334155 !important;
}

[data-theme="light"] .meta-pill-level {
  background: rgba(2, 132, 199, 0.08) !important;
  border-color: rgba(2, 132, 199, 0.18) !important;
  color: #0284c7 !important;
}

[data-theme="light"] .meta-pill-eligibility {
  background: rgba(51, 65, 85, 0.06) !important;
  border-color: rgba(51, 65, 85, 0.10) !important;
  color: #334155 !important;
}

/* highlight boxes */
[data-theme="light"] .highlight-box {
  background: linear-gradient(
    180deg,
    rgba(241, 245, 249, 0.95),
    rgba(226, 232, 240, 0.88)
  ) !important;
  border-color: rgba(15, 23, 42, 0.08) !important;
}

[data-theme="light"] .highlight-label {
  color: #64748b !important;
}

[data-theme="light"] .highlight-value {
  color: #0f172a !important;
}

[data-theme="light"] .highlight-closing {
  background: linear-gradient(
    180deg,
    rgba(254, 242, 242, 0.98),
    rgba(254, 226, 226, 0.94)
  ) !important;
  border-color: rgba(220, 38, 38, 0.14) !important;
}

[data-theme="light"] .highlight-expired {
  background: linear-gradient(
    180deg,
    rgba(248, 250, 252, 0.96),
    rgba(226, 232, 240, 0.92)
  ) !important;
  border-color: rgba(100, 116, 139, 0.14) !important;
}

/* details grid */
[data-theme="light"] .premium-details {
  border-top-color: rgba(15, 23, 42, 0.08) !important;
  border-bottom-color: rgba(15, 23, 42, 0.08) !important;
}

[data-theme="light"] .detail-label {
  color: #64748b !important;
  font-weight: 700;
}

[data-theme="light"] .detail-value {
  color: #334155 !important;
  font-weight: 500;
}

/* buttons in cards */
[data-theme="light"] .job-card-footer .card-action-btn.secondary {
  background: rgba(248, 250, 252, 0.98) !important;
  border-color: rgba(15, 23, 42, 0.10) !important;
  color: #334155 !important;
}

[data-theme="light"] .job-card-footer .card-action-btn.secondary:hover {
  border-color: rgba(2, 132, 199, 0.22) !important;
  background: rgba(240, 249, 255, 0.96) !important;
  color: #075985 !important;
}

[data-theme="light"] .job-card-footer .apply-btn {
  border-color: rgba(22, 163, 74, 0.20) !important;
  background: rgba(240, 253, 244, 0.98) !important;
  color: #15803d !important;
}

/* notification/apply links inside table too */
[data-theme="light"] .table-link-btn {
  background: rgba(240, 249, 255, 0.96) !important;
  border-color: rgba(2, 132, 199, 0.16) !important;
  color: #0369a1 !important;
}

[data-theme="light"] .table-link-btn.apply {
  background: rgba(240, 253, 244, 0.98) !important;
  border-color: rgba(22, 163, 74, 0.18) !important;
  color: #15803d !important;
}

/* slightly stronger separators */
[data-theme="light"] .data-table td,
[data-theme="light"] .data-table th {
  border-bottom-color: rgba(15, 23, 42, 0.08) !important;
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
        const cards = data.map(item => {
            const vacancyId = safe(item.Vacancy_ID);
            const saved = watchlist.has(vacancyId);
            const daysLeft = parseInt(item.Days_Left, 10);
            const closingSoon = !Number.isNaN(daysLeft) && daysLeft >= 0 && daysLeft <= 15;
            const expired = !Number.isNaN(daysLeft) && daysLeft < 0;
            const status = safe(item.Status) || '—';
            const detailedNotificationLink = normalizeUrl(safe(item.Official_Notification_Link));
            const applyLink = normalizeUrl(safe(item.Application_Form_Link));

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
                            <div class="job-org">${escapeHtml(safe(item.Ministry) || safe(item.Department_Organisation) || '—')}</div>
                        </div>
                    </div>

                    <div class="job-highlight-row">
                        <div class="highlight-box ${expired ? 'highlight-expired' : closingSoon ? 'highlight-closing' : 'highlight-normal'}">
                            <div class="highlight-label">Days Left</div>
                            <div class="highlight-value ${closingSoon ? 'days-left closing' : ''}">
                                ${escapeHtml(formatDaysLeft(daysLeft))}
                            </div>
                        </div>

                        <div class="highlight-box">
                            <div class="highlight-label">Status</div>
                            <div class="highlight-value">
                                <span class="badge ${status === 'Active' ? 'badge-active' : ''}">
                                    ${escapeHtml(status)}
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
                            <span class="detail-value">${escapeHtml(safe(item.Department_Organisation) || '—')}</span>
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

                    ${(detailedNotificationLink || applyLink) ? `
                        <div class="job-card-footer">
                            ${detailedNotificationLink ? `
                                <a
                                    class="card-action-btn secondary"
                                    href="${escapeHtml(detailedNotificationLink)}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onclick="event.stopPropagation();"
                                >
                                    Detailed Notification
                                </a>
                            ` : ''}

                            ${applyLink ? `
                                <a
                                    class="card-action-btn secondary apply-btn"
                                    href="${escapeHtml(applyLink)}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onclick="event.stopPropagation();"
                                >
                                    Apply
                                </a>
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
                <button type="button" class="page-btn ${i === current ? 'active' : ''}" data-page="${i}">
                    ${i}
                </button>
            `);
        }

        return `
            <div class="pagination-bar">
                <button type="button" class="page-nav-btn" data-page-nav="prev" data-total-pages="${totalPages}" ${current === 1 ? 'disabled' : ''}>
                    Prev
                </button>

                <div class="page-numbers">
                    ${pages.join('')}
                </div>

                <button type="button" class="page-nav-btn" data-page-nav="next" data-total-pages="${totalPages}" ${current === totalPages ? 'disabled' : ''}>
                    Next
                </button>
            </div>
        `;
    }

    function openVacancyModal(vacancyId) {
        const item = getItemById(vacancyId);
        if (!item || !modal || !modalBody) return;

        modalBody.innerHTML = buildModalContent(item);
        modal.style.display = 'flex';
        lucide.createIcons();
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
        const ministry = safe(item.Ministry) || '—';
        const organisation = getFirstNonEmpty(item, [
            'Department_Organisation',
            'Organisation',
            'Department',
            'Office'
        ]);
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
                        ${buildModalField('Mode of Application', renderModeBadge(modeOfApplication), true)}
                        ${tenure ? buildModalField('Tenure', tenure) : ''}
                        ${ageLimit ? buildModalField('Age Limit', ageLimit) : ''}
                        ${payScale ? buildModalField('Pay / Scale', payScale) : ''}
                    </div>
                </div>

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

                    ${applyLink ? `
                        <a class="card-action-btn secondary apply-btn" href="${escapeHtml(applyLink)}" target="_blank" rel="noopener noreferrer">
                            Apply
                        </a>
                    ` : ''}
                </div>
            </div>
        `;
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
        if (normalizedText.includes(normalizedQuery)) return true;

        const queryTokens = tokenizeText(normalizedQuery);
        const textTokens = tokenizeText(normalizedText);

        return queryTokens.every(qToken => {
            return textTokens.some(tToken => {
                if (tToken.includes(qToken) || qToken.includes(tToken)) return true;

                const maxAllowedDistance =
                    qToken.length <= 4 ? 1 :
                    qToken.length <= 8 ? 2 : 2;

                return levenshteinDistance(qToken, tToken) <= maxAllowedDistance;
            });
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

    function formatLocation(item) {
        const city = safe(item.Location_City);
        const state = safe(item.Location_State);
        if (city && state) return `${city}, ${state}`;
        return city || state || '';
    }

    function parseLevelValue(value) {
        if (value == null) return null;
        const str = String(value).trim();
        if (!str) return null;

        const match = str.match(/\d+/);
        return match ? Number(match[0]) : null;
    }

    function parseNumericSafe(value, fallback = 0) {
        const num = Number.parseInt(value, 10);
        return Number.isNaN(num) ? fallback : num;
    }

    function formatEligibility(item) {
        const req1 = parseLevelValue(item.Req_Level1);
        const req2 = parseLevelValue(item.Req_Level2);

        if (req1 !== null && req2 !== null) {
            if (req1 === req2) return `Level ${req1}`;
            const minReq = Math.min(req1, req2);
            const maxReq = Math.max(req1, req2);
            return `Level ${minReq} to Level ${maxReq}`;
        }

        if (req1 !== null) return `Level ${req1}`;
        if (req2 !== null) return `Level ${req2}`;
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

    function formatRichText(value) {
        return escapeHtml(safe(value)).replace(/\n/g, '<br>');
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
        if (text.includes('physical') || text.includes('offline') || text.includes('post')) return 'mode-physical';

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
