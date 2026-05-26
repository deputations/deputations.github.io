/* my-deputation.js — Control Room controller (local-first, vanilla) */
(function () {
  'use strict';

  const U = window.DepUtils;
  if (!U) { console.error('DepUtils missing'); return; }

  // ---------- Constants ----------
  const KEYS = {
    watchlist:    'deputationWatchlist',
    profile:      'dep_profile_v1',
    searches:     'dep_savedSearches_v1',
    tracker:      'dep_tracker_v1',
    documents:    'dep_documents_v1',
    reminders:    'dep_reminders_v1',
    ui:           'dep_ui_v1',
    theme:        'deputation_theme_v1'
  };

  const STAGES = [
    { id: 'saved',     label: 'Saved' },
    { id: 'drafting',  label: 'Drafting' },
    { id: 'submitted', label: 'Submitted to Parent' },
    { id: 'awaiting',  label: 'Awaiting Clearances' },
    { id: 'forwarded', label: 'Forwarded to Borrower' },
    { id: 'review',    label: 'Under Review' },
    { id: 'interview', label: 'Interview / Interaction' },
    { id: 'selected',  label: 'Selected' },
    { id: 'joined',    label: 'Joined' },
    { id: 'closed',    label: 'Rejected / Withdrawn' }
  ];
  const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.id, s.label]));
  const IN_TRANSIT_STAGES = new Set(['submitted', 'awaiting', 'forwarded', 'review']);
  const CLOSED_STAGES = new Set(['joined', 'closed']);

  const DOC_TEMPLATE = [
    { key: 'biodata',    name: 'Bio-data / Application Proforma' },
    { key: 'apar',       name: 'APAR / ACR (last 5 years)' },
    { key: 'vigilance',  name: 'Vigilance Clearance' },
    { key: 'integrity',  name: 'Integrity Certificate' },
    { key: 'cadre',      name: 'Cadre Clearance' },
    { key: 'noc',        name: 'NOC from Parent Department' },
    { key: 'experience', name: 'Experience Certificate' },
    { key: 'education',  name: 'Educational Qualifications' },
    { key: 'prevdep',    name: 'Previous Deputation Details' },
    { key: 'forward',    name: 'Employer Forwarding Letter' }
  ];
  const REQUIRED_DOC_KEYS = new Set(['biodata', 'apar', 'vigilance', 'integrity', 'cadre', 'noc']);

  const DOC_STATUSES = [
    { value: 'missing',   label: 'Missing' },
    { value: 'requested', label: 'Requested' },
    { value: 'ready',     label: 'Ready' },
    { value: 'expiring',  label: 'Expiring Soon' },
    { value: 'na',        label: 'N/A for me' }
  ];

  const MINISTRY_OPTIONS = [
    'Agriculture & Farmers Welfare', 'AYUSH', 'Civil Aviation', 'Coal', 'Commerce',
    'Communications', 'Consumer Affairs', 'Corporate Affairs', 'Culture',
    'Defence', 'Education', 'Electronics & IT', 'Environment & Forests', 'External Affairs',
    'Finance', 'Health & Family Welfare', 'Home Affairs', 'Housing & Urban Affairs',
    'Information & Broadcasting', 'Jal Shakti', 'Labour & Employment',
    'Law & Justice', 'MSME', 'New & Renewable Energy', 'Panchayati Raj',
    'Personnel & Training (DoPT)', 'Petroleum & Natural Gas', 'Planning',
    'Power', 'Railways', 'Road Transport & Highways', 'Rural Development',
    'Science & Technology', 'Shipping & Ports', 'Skill Development',
    'Social Justice', 'Statistics & PI', 'Steel', 'Textiles', 'Tourism',
    'Tribal Affairs', 'Women & Child Development'
  ];

  const LOCATION_OPTIONS = [
    'Delhi / NCR', 'Mumbai', 'Bengaluru', 'Hyderabad', 'Chennai', 'Kolkata',
    'Pune', 'Ahmedabad', 'Jaipur', 'Lucknow', 'Bhopal', 'Chandigarh',
    'Guwahati', 'Patna', 'Thiruvananthapuram', 'North-East', 'Other'
  ];

  // ---------- Store ----------
  const store = {
    read(key, fallback) {
      try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
      catch { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn('write fail', key, e); }
    },
    bookmarks() { return this.read(KEYS.watchlist, []) || []; },
    setBookmarks(list) { this.write(KEYS.watchlist, [...new Set(list)]); },
    profile() {
      return this.read(KEYS.profile, {
        payLevel: '', service: '', cadre: '',
        currentMinistry: '', currentPost: '', yearsOfService: '',
        preferredMinistries: [], preferredLocations: [], experienceTags: [],
        lastDeputationEndDate: '', coolingOffYears: 3
      });
    },
    setProfile(p) { this.write(KEYS.profile, p); },
    searches() { return this.read(KEYS.searches, []) || []; },
    setSearches(s) { this.write(KEYS.searches, s); },
    tracker() { return this.read(KEYS.tracker, []) || []; },
    setTracker(t) { this.write(KEYS.tracker, t); },
    documents() { return this.read(KEYS.documents, []) || []; },
    setDocuments(d) { this.write(KEYS.documents, d); },
    reminders() { return this.read(KEYS.reminders, []) || []; },
    setReminders(r) { this.write(KEYS.reminders, r); },
    ui() { return this.read(KEYS.ui, { lastTab: 'overview' }) || {}; },
    setUi(u) { this.write(KEYS.ui, u); }
  };

  // ---------- State ----------
  let vacancies = [];
  let vacancyById = new Map();
  let currentTab = 'overview';

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    initTheme();
    bindTabs();
    bindModal();
    bindHashRouter();
    loadVacancies().then(() => {
      const initialTab = (location.hash || '#overview').slice(1);
      switchTab(STAGES_TAB_LIST.includes(initialTab) ? initialTab : 'overview', { skipPush: true });
    });
  }
  const STAGES_TAB_LIST = ['overview', 'bookmarks', 'searches', 'tracker', 'documents', 'profile'];

  function loadVacancies() {
    return fetch('data/vacancies.json')
      .then(r => r.json())
      .then(data => {
        vacancies = Array.isArray(data) ? data : [];
        vacancyById = new Map(vacancies.map(v => [String(v.Vacancy_ID), v]));
      })
      .catch(err => { console.error('vacancies.json failed', err); vacancies = []; });
  }

  // ---------- Theme ----------
  function initTheme() {
    const saved = localStorage.getItem(KEYS.theme) || 'dark';
    applyTheme(saved);
    const btn = document.getElementById('themeToggle');
    if (btn && !btn.dataset.bound) {
      btn.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        applyTheme(next);
        localStorage.setItem(KEYS.theme, next);
      });
      btn.dataset.bound = '1';
    }
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const icon = document.querySelector('#themeToggle i');
    if (icon) icon.setAttribute('data-lucide', theme === 'light' ? 'sun' : 'moon');
    if (window.lucide) lucide.createIcons();
  }

  // ---------- Tab routing ----------
  function bindTabs() {
    document.querySelectorAll('.md-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  }
  function bindHashRouter() {
    window.addEventListener('hashchange', () => {
      const tab = (location.hash || '#overview').slice(1);
      if (STAGES_TAB_LIST.includes(tab)) switchTab(tab, { skipPush: true });
    });
  }
  function switchTab(tab, opts) {
    if (!STAGES_TAB_LIST.includes(tab)) tab = 'overview';
    currentTab = tab;
    document.querySelectorAll('.md-tab').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });
    document.querySelectorAll('.md-panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById('panel-' + tab);
    if (panel) panel.classList.add('active');
    if (!(opts && opts.skipPush)) history.replaceState(null, '', '#' + tab);
    store.setUi({ ...store.ui(), lastTab: tab });
    renderActive();
    renderWelcome();
    updateTabBadges();
  }

  function renderActive() {
    switch (currentTab) {
      case 'overview':  renderOverview(); break;
      case 'bookmarks': renderBookmarks(); break;
      case 'searches':  renderSearches(); break;
      case 'tracker':   renderTracker(); break;
      case 'documents': renderDocuments(); break;
      case 'profile':   renderProfile(); break;
    }
    if (window.lucide) lucide.createIcons();
  }

  // ---------- Welcome strip ----------
  function renderWelcome() {
    const el = document.getElementById('mdWelcome');
    if (!el) return;
    const bookmarks = store.bookmarks();
    const tracker = store.tracker().filter(t => !CLOSED_STAGES.has(t.stage));
    const reminders = computeReminders();
    const weekDeadlines = reminders.filter(r => r._daysLeft != null && r._daysLeft >= 0 && r._daysLeft <= 7).length;

    if (!bookmarks.length && !tracker.length) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = `
      <div class="md-welcome-text">
        Welcome back. You have
        <span class="md-num">${tracker.length}</span> active application${tracker.length === 1 ? '' : 's'},
        <span class="md-num">${bookmarks.length}</span> bookmark${bookmarks.length === 1 ? '' : 's'},
        and <span class="md-num">${weekDeadlines}</span> deadline${weekDeadlines === 1 ? '' : 's'} this week.
      </div>
      <div class="md-welcome-actions">
        <button class="md-btn primary" data-goto="overview"><i data-lucide="layout-grid"></i>Open Overview</button>
      </div>`;
    el.querySelector('[data-goto]')?.addEventListener('click', () => switchTab('overview'));
  }

  // ---------- Overview (bento) ----------
  function renderOverview() {
    const panel = document.getElementById('panel-overview');
    const profile = store.profile();
    const bookmarks = store.bookmarks();
    const tracker = store.tracker();
    const docs = mergedDocuments();
    const searches = store.searches();
    const reminders = computeReminders();

    if (!bookmarks.length && !tracker.length && !profile.payLevel) {
      panel.innerHTML = onboardingHtml();
      panel.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.goto)));
      return;
    }

    const closingSoon = bookmarks
      .map(id => vacancyById.get(String(id)))
      .filter(v => v && Number.isFinite(Number(v.Days_Left)) && Number(v.Days_Left) >= 0 && Number(v.Days_Left) <= 14)
      .sort((a, b) => Number(a.Days_Left) - Number(b.Days_Left))
      .slice(0, 4);

    const bestMatches = vacancies
      .filter(v => v && !bookmarks.includes(String(v.Vacancy_ID)) && Number(v.Days_Left) >= 0)
      .map(v => ({ v, score: matchScore(v, profile).score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const inTransit = tracker.filter(t => IN_TRANSIT_STAGES.has(t.stage));
    const docReady = docs.filter(d => d.status === 'ready').length;
    const docRequired = docs.filter(d => REQUIRED_DOC_KEYS.has(d.docKey) && d.status !== 'na').length;
    const docMissing = docs.filter(d => REQUIRED_DOC_KEYS.has(d.docKey) && (d.status === 'missing' || d.status === 'expiring')).length;

    const nextAction = tracker
      .filter(t => !CLOSED_STAGES.has(t.stage) && (t.nextAction || t.internalDeadline || t.officialDeadline))
      .map(t => ({ t, sortKey: U.getDaysUntilDate(t.internalDeadline || t.officialDeadline) ?? 9999 }))
      .sort((a, b) => a.sortKey - b.sortKey)[0];

    const newMatchesTotal = searches.reduce((sum, s) => sum + computeSearchNewCount(s), 0);

    panel.innerHTML = `
      <div class="md-bento">

        <div class="md-card span-3">
          <div class="md-card-head">
            <span class="md-card-title"><i data-lucide="zap"></i>Next action</span>
            <button class="md-card-link" data-goto="tracker">Open tracker</button>
          </div>
          ${nextAction ? `
            <div class="md-card-body">
              <div style="font-weight:700;font-size:1rem;color:var(--text-primary);">${U.escapeHtml(vacancyTitle(nextAction.t.vacancyId))}</div>
              <div style="color:var(--text-secondary);margin:0.3rem 0;">${U.escapeHtml(nextAction.t.nextAction || 'Update next action in tracker')}</div>
              <div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:0.4rem;">
                <span class="md-pill">${U.escapeHtml(STAGE_LABEL[nextAction.t.stage] || nextAction.t.stage)}</span>
                ${deadlinePill(nextAction.t.internalDeadline || nextAction.t.officialDeadline)}
              </div>
            </div>` : `<div class="md-card-empty">No pending actions. Add a vacancy to your tracker to start.</div>`}
        </div>

        <div class="md-card span-3">
          <div class="md-card-head">
            <span class="md-card-title"><i data-lucide="clock-3"></i>Closing soon</span>
            <button class="md-card-link" data-goto="bookmarks">All bookmarks</button>
          </div>
          ${closingSoon.length ? closingSoon.map(v => `
            <div class="md-mini-row">
              <div>
                <div class="md-mini-title">${U.escapeHtml(v.Post_Name || v.Vacancy_ID)}</div>
                <div class="md-mini-meta">${U.escapeHtml(v.Ministry || '')} · ${U.escapeHtml(U.formatLocation(v))}</div>
              </div>
              ${deadlinePill(v.Last_Date_To_Apply, Number(v.Days_Left))}
            </div>`).join('') : `<div class="md-card-empty">No bookmarks closing in 14 days.</div>`}
        </div>

        <div class="md-card span-3">
          <div class="md-card-head">
            <span class="md-card-title"><i data-lucide="sparkles"></i>Best matches</span>
            <button class="md-card-link" data-href="/index.html">Open vacancies</button>
          </div>
          ${profile.payLevel ? (bestMatches.length ? bestMatches.map(({ v, score }) => `
            <div class="md-mini-row">
              <div>
                <div class="md-mini-title">${U.escapeHtml(v.Post_Name || v.Vacancy_ID)}</div>
                <div class="md-mini-meta">${U.escapeHtml(v.Ministry || '')} · ${U.escapeHtml(U.formatLocation(v))}</div>
              </div>
              <span class="md-pill ${matchTone(score)}">${score}% match</span>
            </div>`).join('') : `<div class="md-card-empty">No matches yet — your bookmarks already cover the top picks.</div>`)
            : `<div class="md-card-empty">Set your pay level in Profile to see matches.</div>`}
        </div>

        <div class="md-card span-2">
          <div class="md-card-head">
            <span class="md-card-title"><i data-lucide="truck"></i>In transit</span>
            <button class="md-card-link" data-goto="tracker">Tracker</button>
          </div>
          <div class="md-card-stat">${inTransit.length}</div>
          <div class="md-card-stat-sub">applications moving through proper channel</div>
        </div>

        <div class="md-card span-2">
          <div class="md-card-head">
            <span class="md-card-title"><i data-lucide="file-check-2"></i>Document readiness</span>
            <button class="md-card-link" data-goto="documents">Open</button>
          </div>
          <div class="md-card-stat">${docRequired ? Math.round((docReady / Math.max(docRequired, 1)) * 100) : 0}%</div>
          <div class="md-progress" style="margin-top:0.2rem"><div class="md-progress-bar" style="width:${docRequired ? Math.round((docReady / Math.max(docRequired, 1)) * 100) : 0}%"></div></div>
          <div class="md-card-stat-sub">${docMissing ? `${docMissing} required missing` : 'All required documents ready'}</div>
        </div>

        <div class="md-card span-2">
          <div class="md-card-head">
            <span class="md-card-title"><i data-lucide="search"></i>Saved searches</span>
            <button class="md-card-link" data-goto="searches">View all</button>
          </div>
          <div class="md-card-stat">${newMatchesTotal}</div>
          <div class="md-card-stat-sub">new matches across ${searches.length} saved search${searches.length === 1 ? '' : 'es'}</div>
        </div>

        <div class="md-card span-6">
          <div class="md-card-head">
            <span class="md-card-title"><i data-lucide="bell"></i>Upcoming reminders</span>
            <button class="md-card-link" data-add-reminder>+ Add reminder</button>
          </div>
          ${reminders.length ? reminders.slice(0, 6).map(r => `
            <div class="md-mini-row">
              <div>
                <div class="md-mini-title">${U.escapeHtml(r.title)}</div>
                <div class="md-mini-meta">${U.escapeHtml(r.kind)} · ${U.formatDisplayDate(r.dueAt)}</div>
              </div>
              <div style="display:flex;gap:0.4rem;align-items:center;">
                ${deadlinePill(r.dueAt, r._daysLeft)}
                <button class="md-btn ghost sm" data-done-reminder="${U.escapeHtml(r.id)}">${r.done ? 'Undo' : 'Done'}</button>
              </div>
            </div>`).join('') : `<div class="md-card-empty">No reminders yet — they'll appear automatically as tracker deadlines approach.</div>`}
        </div>

      </div>`;

    panel.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.goto)));
    panel.querySelectorAll('[data-href]').forEach(b => b.addEventListener('click', () => location.href = b.dataset.href));
    panel.querySelectorAll('[data-done-reminder]').forEach(b => b.addEventListener('click', () => toggleReminderDone(b.dataset.doneReminder)));
    panel.querySelector('[data-add-reminder]')?.addEventListener('click', openReminderModal);
  }

  function onboardingHtml() {
    return `
      <div class="md-onboarding">
        <h3>Welcome to your Deputation Control Room</h3>
        <p>Track applications through proper channel, watch deadlines, and prep documents — all in your browser.</p>
        <p style="color:var(--text-muted);font-size:0.85rem;">Nothing is sent to any server. Export anytime from Profile.</p>
        <div class="md-onboarding-steps">
          <button class="md-step" data-goto="profile">1 · Set your pay level</button>
          <button class="md-step" data-goto="bookmarks">2 · Bookmark vacancies</button>
          <button class="md-step" data-goto="tracker">3 · Track applications</button>
        </div>
      </div>`;
  }

  // ---------- Bookmarks ----------
  function renderBookmarks() {
    const panel = document.getElementById('panel-bookmarks');
    const bookmarks = store.bookmarks();
    const profile = store.profile();
    const trackerByVid = Object.fromEntries(store.tracker().map(t => [t.vacancyId, t]));

    if (!bookmarks.length) {
      panel.innerHTML = `
        <div class="md-onboarding">
          <h3>No bookmarks yet</h3>
          <p>Open the vacancies page and tap the heart icon to bookmark vacancies.</p>
          <div class="md-onboarding-steps"><a class="md-step" href="/index.html">Browse vacancies →</a></div>
        </div>`;
      return;
    }

    const items = bookmarks
      .map(id => vacancyById.get(String(id)))
      .filter(Boolean)
      .map(v => {
        const score = matchScore(v, profile).score;
        const inTracker = trackerByVid[String(v.Vacancy_ID)];
        const days = Number(v.Days_Left);
        return `
          <div class="md-vacancy-card">
            <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:flex-start;">
              <div class="md-vacancy-title">${U.escapeHtml(v.Post_Name || v.Vacancy_ID)}</div>
              ${profile.payLevel ? `<span class="md-pill ${matchTone(score)}">${score}%</span>` : ''}
            </div>
            <div class="md-vacancy-meta">
              <span><i data-lucide="building-2" style="width:12px;height:12px;vertical-align:-2px"></i> ${U.escapeHtml(v.Ministry || '—')}</span>
              <span><i data-lucide="map-pin" style="width:12px;height:12px;vertical-align:-2px"></i> ${U.escapeHtml(U.formatLocation(v) || '—')}</span>
              <span><i data-lucide="layers" style="width:12px;height:12px;vertical-align:-2px"></i> ${U.escapeHtml(U.formatEligibility(v))}</span>
            </div>
            <div class="md-vacancy-pills">
              ${deadlinePill(v.Last_Date_To_Apply, days)}
              ${inTracker ? `<span class="md-pill match-md"><i data-lucide="kanban-square" style="width:12px;height:12px"></i> ${U.escapeHtml(STAGE_LABEL[inTracker.stage] || inTracker.stage)}</span>` : ''}
              ${coolingOffPill(profile)}
            </div>
            <div class="md-vacancy-actions">
              ${inTracker
                ? `<button class="md-btn" data-edit-tracker="${U.escapeHtml(v.Vacancy_ID)}"><i data-lucide="edit-3"></i>Edit in tracker</button>`
                : `<button class="md-btn primary" data-add-tracker="${U.escapeHtml(v.Vacancy_ID)}"><i data-lucide="plus"></i>Add to tracker</button>`}
              ${U.normalizeUrl(v.Official_Notification_Link) ? `<a class="md-btn" target="_blank" rel="noopener" href="${U.escapeHtml(U.normalizeUrl(v.Official_Notification_Link))}"><i data-lucide="external-link"></i>Notification</a>` : ''}
              <button class="md-btn danger" data-remove-bookmark="${U.escapeHtml(v.Vacancy_ID)}"><i data-lucide="trash-2"></i>Remove</button>
            </div>
          </div>`;
      });

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;">
        <div style="color:var(--text-secondary);font-size:0.9rem;">${items.length} bookmarked vacancy${items.length === 1 ? '' : 'ies'}${profile.payLevel ? '' : ' · set your pay level in Profile to enable match scores'}</div>
        <a href="/index.html" class="md-btn"><i data-lucide="plus"></i>Find more</a>
      </div>
      <div class="md-grid">${items.join('')}</div>`;

    panel.querySelectorAll('[data-remove-bookmark]').forEach(b => b.addEventListener('click', () => removeBookmark(b.dataset.removeBookmark)));
    panel.querySelectorAll('[data-add-tracker]').forEach(b => b.addEventListener('click', () => openTrackerModal(b.dataset.addTracker, true)));
    panel.querySelectorAll('[data-edit-tracker]').forEach(b => b.addEventListener('click', () => openTrackerModal(b.dataset.editTracker, false)));
  }

  function removeBookmark(id) {
    const next = store.bookmarks().filter(b => String(b) !== String(id));
    store.setBookmarks(next);
    toast('Bookmark removed');
    renderActive(); renderWelcome(); updateTabBadges();
  }

  // ---------- Saved searches ----------
  function renderSearches() {
    const panel = document.getElementById('panel-searches');
    const searches = store.searches();

    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;flex-wrap:wrap;margin-bottom:1rem;">
        <div style="color:var(--text-secondary);font-size:0.9rem;">${searches.length} saved search${searches.length === 1 ? '' : 'es'}</div>
        <button class="md-btn primary" id="mdAddSearch"><i data-lucide="plus"></i>New search</button>
      </div>
      ${searches.length ? searches.map(s => {
        const newCount = computeSearchNewCount(s);
        return `
          <div class="md-search-row">
            <div style="flex:1;min-width:220px;">
              <div class="md-search-name">
                <i data-lucide="search" style="width:16px;height:16px"></i>
                ${U.escapeHtml(s.name)}
                ${newCount ? `<span class="md-pill match-hi">${newCount} new</span>` : ''}
              </div>
              <div class="md-search-filters">${summarizeFilters(s.filters)}</div>
            </div>
            <div class="md-search-actions">
              <button class="md-btn primary" data-run-search="${U.escapeHtml(s.id)}"><i data-lucide="play"></i>Run</button>
              <button class="md-btn" data-edit-search="${U.escapeHtml(s.id)}"><i data-lucide="edit-3"></i>Edit</button>
              <button class="md-btn danger" data-delete-search="${U.escapeHtml(s.id)}"><i data-lucide="trash-2"></i></button>
            </div>
          </div>`;
      }).join('') : `<div class="md-card-empty">No saved searches yet. Click <strong>New search</strong> to add one.</div>`}`;

    panel.querySelector('#mdAddSearch')?.addEventListener('click', () => openSearchModal(null));
    panel.querySelectorAll('[data-run-search]').forEach(b => b.addEventListener('click', () => runSearch(b.dataset.runSearch)));
    panel.querySelectorAll('[data-edit-search]').forEach(b => b.addEventListener('click', () => openSearchModal(b.dataset.editSearch)));
    panel.querySelectorAll('[data-delete-search]').forEach(b => b.addEventListener('click', () => deleteSearch(b.dataset.deleteSearch)));
  }

  function summarizeFilters(f) {
    if (!f) return '<em>No filters</em>';
    const parts = [];
    if (f.search) parts.push(`Search: "${U.escapeHtml(f.search)}"`);
    if (f.level) parts.push(`Level ${U.escapeHtml(f.level)}`);
    if (f.ministry) parts.push(U.escapeHtml(f.ministry));
    if (f.location) parts.push(U.escapeHtml(f.location));
    if (f.status) parts.push(U.escapeHtml(f.status));
    if (f.myPayLevel) parts.push(`My Level ${U.escapeHtml(f.myPayLevel)}`);
    if (f.quick) parts.push(U.escapeHtml(f.quick));
    return parts.length ? parts.join(' · ') : '<em>Any</em>';
  }

  function runSearch(id) {
    const s = store.searches().find(x => x.id === id);
    if (!s) return;
    const matched = filterByCriteria(s.filters).map(v => String(v.Vacancy_ID));
    const updated = store.searches().map(x => x.id === id ? { ...x, lastRunAt: Date.now(), lastResultIds: matched } : x);
    store.setSearches(updated);
    const url = '/index.html' + buildQuery(s.filters);
    location.href = url;
  }

  function buildQuery(f) {
    const q = new URLSearchParams();
    if (f.search) q.set('search', f.search);
    if (f.level) q.set('level', f.level);
    if (f.ministry) q.set('ministry', f.ministry);
    if (f.location) q.set('location', f.location);
    if (f.status) q.set('status', f.status);
    if (f.myPayLevel) q.set('myPayLevel', f.myPayLevel);
    if (f.quick) q.set('quick', f.quick);
    const s = q.toString();
    return s ? '?' + s : '';
  }

  function deleteSearch(id) {
    if (!confirm('Delete this saved search?')) return;
    store.setSearches(store.searches().filter(s => s.id !== id));
    renderActive(); updateTabBadges();
  }

  function openSearchModal(id) {
    const existing = id ? store.searches().find(s => s.id === id) : null;
    const f = (existing && existing.filters) || {};
    const ministries = uniqueVacancyValues('Ministry');
    const locations = uniqueVacancyValues(null, U.formatLocation);
    const levels = uniqueVacancyValues('Level_Text');
    showModal(`
      <h2 style="font-family:Sora,sans-serif;letter-spacing:-0.02em;margin:0 0 1rem;">${existing ? 'Edit search' : 'New saved search'}</h2>
      <form class="md-modal-form" id="mdSearchForm">
        <div>
          <label>Name</label>
          <input class="md-input" name="name" required value="${U.escapeHtml(existing?.name || '')}" placeholder="e.g. Level 12–13 · Delhi · Defence">
        </div>
        <div class="row">
          <div><label>Keyword</label><input class="md-input" name="search" value="${U.escapeHtml(f.search || '')}" placeholder="post, dept, keywords"></div>
          <div><label>My pay level</label><input class="md-input" name="myPayLevel" type="number" min="1" max="18" value="${U.escapeHtml(f.myPayLevel || '')}"></div>
        </div>
        <div class="row">
          <div><label>Pay level</label>${selectHtml('level', levels, f.level)}</div>
          <div><label>Ministry</label>${selectHtml('ministry', ministries, f.ministry)}</div>
        </div>
        <div class="row">
          <div><label>Location</label>${selectHtml('location', locations, f.location)}</div>
          <div><label>Status</label>${selectHtml('status', ['Active', 'Inactive'], f.status || 'Active')}</div>
        </div>
        <div>
          <label>Quick filter</label>
          ${selectHtml('quick', [['', 'None'], ['closing7', 'Closing in 7 days'], ['closingToday', 'Closes today'], ['delhiNcr', 'Delhi / NCR']], f.quick)}
        </div>
        <div style="display:flex;gap:0.5rem;justify-content:flex-end;padding-top:0.5rem;">
          <button type="button" class="md-btn" data-cancel>Cancel</button>
          <button type="submit" class="md-btn primary"><i data-lucide="save"></i>${existing ? 'Update' : 'Save'}</button>
        </div>
      </form>`);

    document.getElementById('mdSearchForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const filters = {
        search: fd.get('search') || '',
        level: fd.get('level') || '',
        ministry: fd.get('ministry') || '',
        location: fd.get('location') || '',
        status: fd.get('status') || '',
        myPayLevel: fd.get('myPayLevel') || '',
        quick: fd.get('quick') || ''
      };
      const name = (fd.get('name') || '').toString().trim() || autoSearchName(filters);
      const list = store.searches();
      if (existing) {
        store.setSearches(list.map(s => s.id === existing.id ? { ...s, name, filters } : s));
      } else {
        list.push({ id: U.uid('s'), name, filters, createdAt: Date.now(), lastRunAt: null, lastResultIds: [] });
        store.setSearches(list);
      }
      closeModal(); renderActive(); updateTabBadges(); toast('Search saved');
    });
    document.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
    if (window.lucide) lucide.createIcons();
  }

  function autoSearchName(f) {
    return [f.level, f.ministry, f.location].filter(Boolean).join(' · ') || 'Untitled search';
  }

  // ---------- Tracker ----------
  function renderTracker() {
    const panel = document.getElementById('panel-tracker');
    const tracker = store.tracker();

    panel.innerHTML = `
      <div class="md-kanban-toolbar">
        <div style="color:var(--text-secondary);font-size:0.9rem;">${tracker.length} application${tracker.length === 1 ? '' : 's'} in tracker · drag cards between stages</div>
        <div style="display:flex;gap:0.4rem;">
          <button class="md-btn" id="mdAddTracker"><i data-lucide="plus"></i>Add from bookmarks</button>
        </div>
      </div>
      <div class="md-kanban">
        ${STAGES.map(stage => {
          const cards = tracker.filter(t => t.stage === stage.id);
          return `
            <div class="md-col" data-stage="${stage.id}">
              <div class="md-col-head">
                <span>${U.escapeHtml(stage.label)}</span>
                <span class="md-col-count">${cards.length}</span>
              </div>
              ${cards.map(t => trackerCardHtml(t)).join('') || `<div class="md-card-empty" style="padding:0.5rem 0">—</div>`}
            </div>`;
        }).join('')}
      </div>`;

    bindKanban();
    panel.querySelector('#mdAddTracker')?.addEventListener('click', openAddFromBookmarksModal);
    panel.querySelectorAll('[data-edit-card]').forEach(c => c.addEventListener('click', () => openTrackerModal(c.dataset.editCard, false)));
    panel.querySelectorAll('.md-stage-select').forEach(sel => sel.addEventListener('change', e => moveTrackerStage(sel.dataset.vid, e.target.value)));
  }

  function trackerCardHtml(t) {
    const v = vacancyById.get(String(t.vacancyId));
    const title = v?.Post_Name || t.vacancyId;
    const ministry = v?.Ministry || '';
    const days = U.getDaysUntilDate(t.internalDeadline || t.officialDeadline);
    return `
      <div class="md-kanban-card" draggable="true" data-vid="${U.escapeHtml(t.vacancyId)}" data-edit-card="${U.escapeHtml(t.vacancyId)}">
        <div class="md-kanban-title">${U.escapeHtml(title)}</div>
        <div class="md-kanban-meta">${U.escapeHtml(ministry)}${t.nextAction ? ' · ' + U.escapeHtml(t.nextAction) : ''}</div>
        <div class="md-kanban-foot">
          ${days != null ? deadlinePill(t.internalDeadline || t.officialDeadline, days) : '<span class="md-pill">No deadline</span>'}
        </div>
        <select class="md-stage-select" data-vid="${U.escapeHtml(t.vacancyId)}" onclick="event.stopPropagation()">
          ${STAGES.map(s => `<option value="${s.id}" ${s.id === t.stage ? 'selected' : ''}>${U.escapeHtml(s.label)}</option>`).join('')}
        </select>
      </div>`;
  }

  function bindKanban() {
    let dragVid = null;
    document.querySelectorAll('.md-kanban-card').forEach(card => {
      card.addEventListener('dragstart', e => {
        dragVid = card.dataset.vid;
        card.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragVid = null; });
    });
    document.querySelectorAll('.md-col').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('drop-target'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
      col.addEventListener('drop', e => {
        e.preventDefault();
        col.classList.remove('drop-target');
        if (!dragVid) return;
        moveTrackerStage(dragVid, col.dataset.stage);
      });
    });
  }

  function moveTrackerStage(vid, newStage) {
    const list = store.tracker();
    const idx = list.findIndex(t => String(t.vacancyId) === String(vid));
    if (idx < 0) return;
    if (list[idx].stage === newStage) return;
    list[idx].stage = newStage;
    list[idx].stageHistory = list[idx].stageHistory || [];
    list[idx].stageHistory.push({ stage: newStage, at: Date.now(), note: '' });
    store.setTracker(list);
    syncRemindersFromTracker();
    renderActive(); renderWelcome(); updateTabBadges();
    toast(`Moved to ${STAGE_LABEL[newStage]}`);
  }

  function openAddFromBookmarksModal() {
    const bookmarks = store.bookmarks();
    const tracker = store.tracker();
    const trackedIds = new Set(tracker.map(t => String(t.vacancyId)));
    const available = bookmarks.filter(id => !trackedIds.has(String(id))).map(id => vacancyById.get(String(id))).filter(Boolean);

    if (!available.length) {
      showModal(`<h2 style="margin:0 0 0.5rem">Nothing to add</h2><p>All your bookmarks are already in the tracker. Bookmark more vacancies from the <a href="/index.html">vacancies page</a>.</p><div style="text-align:right"><button class="md-btn" data-cancel>Close</button></div>`);
      document.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
      return;
    }

    showModal(`
      <h2 style="margin:0 0 1rem">Add bookmarks to tracker</h2>
      <div style="max-height:400px;overflow-y:auto;display:flex;flex-direction:column;gap:0.4rem;">
        ${available.map(v => `
          <label style="display:flex;gap:0.6rem;align-items:center;padding:0.6rem 0.75rem;border:1px solid var(--border-color);border-radius:10px;cursor:pointer;">
            <input type="checkbox" value="${U.escapeHtml(v.Vacancy_ID)}">
            <div style="flex:1;">
              <div style="font-weight:600;color:var(--text-primary);">${U.escapeHtml(v.Post_Name || v.Vacancy_ID)}</div>
              <div style="font-size:0.82rem;color:var(--text-secondary);">${U.escapeHtml(v.Ministry || '')} · ${U.escapeHtml(U.formatLocation(v))}</div>
            </div>
          </label>`).join('')}
      </div>
      <div style="display:flex;gap:0.5rem;justify-content:flex-end;padding-top:1rem">
        <button class="md-btn" data-cancel>Cancel</button>
        <button class="md-btn primary" id="mdConfirmAdd"><i data-lucide="plus"></i>Add selected</button>
      </div>`);

    document.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
    document.getElementById('mdConfirmAdd').addEventListener('click', () => {
      const ids = [...document.querySelectorAll('#modalBody input[type=checkbox]:checked')].map(c => c.value);
      if (!ids.length) return closeModal();
      const list = store.tracker();
      ids.forEach(id => {
        const v = vacancyById.get(String(id));
        list.push({
          vacancyId: String(id),
          stage: 'saved',
          stageHistory: [{ stage: 'saved', at: Date.now(), note: 'Added from bookmarks' }],
          officialDeadline: v?.Last_Date_To_Apply || '',
          internalDeadline: '',
          nextAction: 'Review eligibility & start drafting',
          contactPerson: '',
          notes: ''
        });
      });
      store.setTracker(list);
      syncRemindersFromTracker();
      closeModal(); renderActive(); renderWelcome(); updateTabBadges(); toast(`${ids.length} added to tracker`);
    });
    if (window.lucide) lucide.createIcons();
  }

  function openTrackerModal(vacancyId, createIfMissing) {
    const list = store.tracker();
    let entry = list.find(t => String(t.vacancyId) === String(vacancyId));
    if (!entry && createIfMissing) {
      const v = vacancyById.get(String(vacancyId));
      entry = {
        vacancyId: String(vacancyId),
        stage: 'saved',
        stageHistory: [{ stage: 'saved', at: Date.now(), note: 'Added from bookmarks' }],
        officialDeadline: v?.Last_Date_To_Apply || '',
        internalDeadline: '',
        nextAction: '',
        contactPerson: '',
        notes: ''
      };
      list.push(entry);
      store.setTracker(list);
    }
    if (!entry) return;
    const v = vacancyById.get(String(vacancyId));

    showModal(`
      <h2 style="font-family:Sora,sans-serif;letter-spacing:-0.02em;margin:0;">${U.escapeHtml(v?.Post_Name || vacancyId)}</h2>
      <div style="color:var(--text-secondary);font-size:0.9rem;margin:0.3rem 0 1rem;">${U.escapeHtml(v?.Ministry || '')} · ${U.escapeHtml(U.formatLocation(v) || '')}</div>
      <form class="md-modal-form" id="mdTrackerForm">
        <div class="row">
          <div><label>Stage</label>${selectHtml('stage', STAGES.map(s => [s.id, s.label]), entry.stage)}</div>
          <div><label>Next action</label><input class="md-input" name="nextAction" value="${U.escapeHtml(entry.nextAction || '')}" placeholder="e.g. Send vigilance reminder"></div>
        </div>
        <div class="row">
          <div><label>Official deadline</label><input class="md-input" name="officialDeadline" type="date" value="${U.escapeHtml(entry.officialDeadline || '')}"></div>
          <div><label>Internal deadline</label><input class="md-input" name="internalDeadline" type="date" value="${U.escapeHtml(entry.internalDeadline || '')}"></div>
        </div>
        <div><label>Contact person</label><input class="md-input" name="contactPerson" value="${U.escapeHtml(entry.contactPerson || '')}" placeholder="Name, role, phone/email"></div>
        <div><label>Notes</label><textarea class="md-input" name="notes" rows="3" placeholder="e.g. File currently with Section Officer">${U.escapeHtml(entry.notes || '')}</textarea></div>
        ${(entry.stageHistory && entry.stageHistory.length) ? `
          <div>
            <label>Stage history</label>
            <div class="md-stage-history">
              ${entry.stageHistory.slice().reverse().map(h => `
                <div class="md-stage-history-row">
                  <span>${U.escapeHtml(STAGE_LABEL[h.stage] || h.stage)}${h.note ? ' — ' + U.escapeHtml(h.note) : ''}</span>
                  <span>${U.formatDisplayDate(new Date(h.at).toISOString())}</span>
                </div>`).join('')}
            </div>
          </div>` : ''}
        <div style="display:flex;gap:0.5rem;justify-content:space-between;padding-top:0.5rem;">
          <button type="button" class="md-btn danger" data-delete>Remove from tracker</button>
          <div style="display:flex;gap:0.5rem;">
            <button type="button" class="md-btn" data-cancel>Cancel</button>
            <button type="submit" class="md-btn primary"><i data-lucide="save"></i>Save</button>
          </div>
        </div>
      </form>`);

    document.getElementById('mdTrackerForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const newStage = fd.get('stage');
      const list2 = store.tracker();
      const i = list2.findIndex(t => String(t.vacancyId) === String(vacancyId));
      if (i < 0) return;
      if (list2[i].stage !== newStage) {
        list2[i].stageHistory = list2[i].stageHistory || [];
        list2[i].stageHistory.push({ stage: newStage, at: Date.now(), note: '' });
      }
      list2[i] = {
        ...list2[i],
        stage: newStage,
        nextAction: fd.get('nextAction') || '',
        officialDeadline: fd.get('officialDeadline') || '',
        internalDeadline: fd.get('internalDeadline') || '',
        contactPerson: fd.get('contactPerson') || '',
        notes: fd.get('notes') || ''
      };
      store.setTracker(list2);
      syncRemindersFromTracker();
      closeModal(); renderActive(); renderWelcome(); updateTabBadges(); toast('Saved');
    });
    document.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
    document.querySelector('[data-delete]')?.addEventListener('click', () => {
      if (!confirm('Remove this application from the tracker? Bookmark stays.')) return;
      store.setTracker(store.tracker().filter(t => String(t.vacancyId) !== String(vacancyId)));
      syncRemindersFromTracker();
      closeModal(); renderActive(); renderWelcome(); updateTabBadges(); toast('Removed from tracker');
    });
    if (window.lucide) lucide.createIcons();
  }

  // ---------- Documents ----------
  function mergedDocuments() {
    const stored = store.documents();
    const byKey = Object.fromEntries(stored.map(d => [d.docKey, d]));
    return DOC_TEMPLATE.map(t => ({
      docKey: t.key, name: t.name,
      status: byKey[t.key]?.status || 'missing',
      issuedOn: byKey[t.key]?.issuedOn || '',
      expiresOn: byKey[t.key]?.expiresOn || '',
      notes: byKey[t.key]?.notes || ''
    }));
  }

  function renderDocuments() {
    const panel = document.getElementById('panel-documents');
    const docs = mergedDocuments();
    const ready = docs.filter(d => d.status === 'ready').length;
    const required = docs.filter(d => REQUIRED_DOC_KEYS.has(d.docKey) && d.status !== 'na').length;
    const pct = required ? Math.round((ready / required) * 100) : 0;

    panel.innerHTML = `
      <div class="md-doc-banner">
        <i data-lucide="info"></i>
        <div>This is a checklist only. Files are <strong>not</strong> uploaded — keep them in your usual folder on your computer. Status, dates and notes are stored locally in your browser.</div>
      </div>
      <div class="md-doc-readiness">
        <span><strong>${ready}</strong> of <strong>${required}</strong> required ready</span>
        <div class="md-progress"><div class="md-progress-bar" style="width:${pct}%"></div></div>
        <span style="font-variant-numeric:tabular-nums">${pct}%</span>
      </div>
      <div class="md-doc-list">
        ${docs.map(d => `
          <div class="md-doc-row" data-key="${d.docKey}">
            <div class="md-doc-name">
              ${U.escapeHtml(d.name)}
              ${REQUIRED_DOC_KEYS.has(d.docKey) ? '<span class="md-pill" style="margin-left:0.4rem">Required</span>' : ''}
            </div>
            ${selectHtml('status', DOC_STATUSES.map(s => [s.value, s.label]), d.status, true)}
            <input type="date" name="issuedOn" value="${U.escapeHtml(d.issuedOn || '')}" placeholder="Issued">
            <input type="date" name="expiresOn" value="${U.escapeHtml(d.expiresOn || '')}" placeholder="Expires">
            <input type="text" name="notes" value="${U.escapeHtml(d.notes || '')}" placeholder="Notes (e.g. with Section Officer)">
            <button class="md-btn ghost sm" data-save-doc="${d.docKey}"><i data-lucide="save"></i></button>
          </div>`).join('')}
      </div>`;

    panel.querySelectorAll('[data-save-doc]').forEach(b => b.addEventListener('click', () => saveDocRow(b.dataset.saveDoc)));
    panel.querySelectorAll('.md-doc-row select, .md-doc-row input').forEach(el => {
      el.addEventListener('change', () => saveDocRow(el.closest('.md-doc-row').dataset.key));
    });
  }

  function saveDocRow(key) {
    const row = document.querySelector(`.md-doc-row[data-key="${key}"]`);
    if (!row) return;
    const data = {
      docKey: key,
      status: row.querySelector('[name=status]').value,
      issuedOn: row.querySelector('[name=issuedOn]').value,
      expiresOn: row.querySelector('[name=expiresOn]').value,
      notes: row.querySelector('[name=notes]').value
    };
    const list = store.documents().filter(d => d.docKey !== key);
    list.push(data);
    store.setDocuments(list);
    // soft re-render for readiness bar without reflowing inputs
    const docs = mergedDocuments();
    const ready = docs.filter(d => d.status === 'ready').length;
    const required = docs.filter(d => REQUIRED_DOC_KEYS.has(d.docKey) && d.status !== 'na').length;
    const pct = required ? Math.round((ready / required) * 100) : 0;
    const bar = document.querySelector('.md-doc-readiness');
    if (bar) bar.innerHTML = `
      <span><strong>${ready}</strong> of <strong>${required}</strong> required ready</span>
      <div class="md-progress"><div class="md-progress-bar" style="width:${pct}%"></div></div>
      <span style="font-variant-numeric:tabular-nums">${pct}%</span>`;
  }

  // ---------- Profile ----------
  function renderProfile() {
    const panel = document.getElementById('panel-profile');
    const p = store.profile();
    panel.innerHTML = `
      <form class="md-profile-form" id="mdProfileForm">
        <div class="md-field">
          <label>Current pay level</label>
          <select name="payLevel">
            <option value="">Select…</option>
            ${[...Array(18)].map((_, i) => `<option value="${i + 1}" ${String(p.payLevel) === String(i + 1) ? 'selected' : ''}>Level ${i + 1}</option>`).join('')}
          </select>
        </div>
        <div class="md-field">
          <label>Service / Cadre</label>
          <input name="service" value="${U.escapeHtml(p.service || '')}" placeholder="e.g. IRS, IAS, CSS">
        </div>
        <div class="md-field">
          <label>Cadre / State</label>
          <input name="cadre" value="${U.escapeHtml(p.cadre || '')}" placeholder="e.g. UP, Maharashtra">
        </div>
        <div class="md-field">
          <label>Years of service</label>
          <input name="yearsOfService" type="number" min="0" max="50" value="${U.escapeHtml(p.yearsOfService || '')}">
        </div>
        <div class="md-field">
          <label>Current ministry / org</label>
          <input name="currentMinistry" value="${U.escapeHtml(p.currentMinistry || '')}">
        </div>
        <div class="md-field">
          <label>Current post</label>
          <input name="currentPost" value="${U.escapeHtml(p.currentPost || '')}">
        </div>
        <div class="md-field full">
          <label>Preferred ministries (comma-separated)</label>
          <input name="preferredMinistries" value="${U.escapeHtml((p.preferredMinistries || []).join(', '))}" placeholder="e.g. Defence, Finance, External Affairs" list="mdMinistryList">
          <datalist id="mdMinistryList">${MINISTRY_OPTIONS.map(m => `<option value="${U.escapeHtml(m)}">`).join('')}</datalist>
        </div>
        <div class="md-field full">
          <label>Preferred locations (comma-separated)</label>
          <input name="preferredLocations" value="${U.escapeHtml((p.preferredLocations || []).join(', '))}" placeholder="e.g. Delhi / NCR, Bengaluru, North-East" list="mdLocationList">
          <datalist id="mdLocationList">${LOCATION_OPTIONS.map(l => `<option value="${U.escapeHtml(l)}">`).join('')}</datalist>
        </div>
        <div class="md-field full">
          <label>Experience tags (comma-separated keywords used in match score)</label>
          <input name="experienceTags" value="${U.escapeHtml((p.experienceTags || []).join(', '))}" placeholder="e.g. procurement, audit, infrastructure, IT, policy">
        </div>
        <div class="md-field">
          <label>Last deputation end date</label>
          <input name="lastDeputationEndDate" type="date" value="${U.escapeHtml(p.lastDeputationEndDate || '')}">
        </div>
        <div class="md-field">
          <label>Cooling-off years required</label>
          <input name="coolingOffYears" type="number" min="0" max="10" value="${U.escapeHtml(String(p.coolingOffYears ?? 3))}">
        </div>
        <div class="md-form-actions">
          <button type="submit" class="md-btn primary"><i data-lucide="save"></i>Save profile</button>
          <button type="button" class="md-btn" id="mdExport"><i data-lucide="download"></i>Export data (JSON)</button>
          <button type="button" class="md-btn" id="mdImport"><i data-lucide="upload"></i>Import data</button>
          <button type="button" class="md-btn danger" id="mdReset"><i data-lucide="trash-2"></i>Reset all my data</button>
          <input type="file" id="mdImportFile" accept="application/json" hidden>
        </div>
      </form>`;

    document.getElementById('mdProfileForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const next = {
        ...p,
        payLevel: fd.get('payLevel') || '',
        service: fd.get('service') || '',
        cadre: fd.get('cadre') || '',
        yearsOfService: fd.get('yearsOfService') || '',
        currentMinistry: fd.get('currentMinistry') || '',
        currentPost: fd.get('currentPost') || '',
        preferredMinistries: csvList(fd.get('preferredMinistries')),
        preferredLocations: csvList(fd.get('preferredLocations')),
        experienceTags: csvList(fd.get('experienceTags')),
        lastDeputationEndDate: fd.get('lastDeputationEndDate') || '',
        coolingOffYears: Number(fd.get('coolingOffYears') || 0)
      };
      store.setProfile(next);
      toast('Profile saved');
    });
    document.getElementById('mdExport').addEventListener('click', exportData);
    document.getElementById('mdImport').addEventListener('click', () => document.getElementById('mdImportFile').click());
    document.getElementById('mdImportFile').addEventListener('change', importData);
    document.getElementById('mdReset').addEventListener('click', resetAll);
  }

  function csvList(value) {
    return String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  }

  // ---------- Reminders ----------
  function computeReminders() {
    syncRemindersFromTracker(); // idempotent
    const list = store.reminders();
    return list
      .map(r => ({ ...r, _daysLeft: U.getDaysUntilDate(r.dueAt) }))
      .filter(r => !r.done)
      .sort((a, b) => (a._daysLeft ?? 9999) - (b._daysLeft ?? 9999));
  }

  function syncRemindersFromTracker() {
    const tracker = store.tracker();
    const existing = store.reminders();
    const generatedIds = new Set(existing.filter(r => r._generated).map(r => r.id));
    const next = existing.filter(r => !r._generated || isStillRelevant(r, tracker));

    tracker.forEach(t => {
      if (CLOSED_STAGES.has(t.stage)) return;
      [['officialDeadline', 'official'], ['internalDeadline', 'internal']].forEach(([field, kind]) => {
        const date = t[field];
        if (!date) return;
        const id = `gen_${t.vacancyId}_${kind}`;
        if (next.some(r => r.id === id)) return;
        const v = vacancyById.get(String(t.vacancyId));
        next.push({
          id, _generated: true, vacancyId: t.vacancyId, kind,
          title: `${kind === 'official' ? 'Official deadline' : 'Internal deadline'}: ${v?.Post_Name || t.vacancyId}`,
          dueAt: date, done: false
        });
      });
    });
    store.setReminders(next);
  }

  function isStillRelevant(reminder, tracker) {
    const t = tracker.find(x => String(x.vacancyId) === String(reminder.vacancyId));
    if (!t) return false;
    if (CLOSED_STAGES.has(t.stage)) return false;
    if (reminder.kind === 'official') return !!t.officialDeadline && t.officialDeadline === reminder.dueAt;
    if (reminder.kind === 'internal') return !!t.internalDeadline && t.internalDeadline === reminder.dueAt;
    return true;
  }

  function toggleReminderDone(id) {
    const list = store.reminders();
    const i = list.findIndex(r => r.id === id);
    if (i < 0) return;
    list[i].done = !list[i].done;
    store.setReminders(list);
    renderActive(); renderWelcome();
  }

  function openReminderModal() {
    showModal(`
      <h2 style="margin:0 0 1rem">New reminder</h2>
      <form class="md-modal-form" id="mdReminderForm">
        <div><label>Title</label><input class="md-input" name="title" required placeholder="e.g. Follow up with vigilance section"></div>
        <div class="row">
          <div><label>Due date</label><input class="md-input" name="dueAt" type="date" required></div>
          <div><label>Kind</label>${selectHtml('kind', [['personal', 'Personal'], ['internal', 'Internal'], ['official', 'Official']], 'personal')}</div>
        </div>
        <div style="display:flex;gap:0.5rem;justify-content:flex-end;padding-top:0.5rem;">
          <button type="button" class="md-btn" data-cancel>Cancel</button>
          <button type="submit" class="md-btn primary"><i data-lucide="bell-plus"></i>Add</button>
        </div>
      </form>`);
    document.getElementById('mdReminderForm').addEventListener('submit', e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const list = store.reminders();
      list.push({
        id: U.uid('r'), _generated: false,
        title: fd.get('title'),
        dueAt: fd.get('dueAt'),
        kind: fd.get('kind') || 'personal',
        done: false
      });
      store.setReminders(list);
      closeModal(); renderActive(); renderWelcome(); toast('Reminder added');
    });
    document.querySelector('[data-cancel]')?.addEventListener('click', closeModal);
    if (window.lucide) lucide.createIcons();
  }

  // ---------- Match score ----------
  function matchScore(vacancy, profile) {
    const factors = { level: 0, ministry: 0, location: 0, deadline: 0, experience: 0 };
    if (!vacancy) return { score: 0, factors };

    const userLevel = Number(profile.payLevel);
    const r1 = Number(vacancy.Req_Level1);
    const r2 = Number(vacancy.Req_Level2);
    if (userLevel && Number.isFinite(r1) && Number.isFinite(r2)) {
      const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
      factors.level = userLevel >= lo && userLevel <= hi ? 40 : 0;
    } else if (userLevel) {
      factors.level = 20;
    }

    const prefMin = (profile.preferredMinistries || []).map(s => U.normalizeText(s));
    const vMin = U.normalizeText(vacancy.Ministry || '');
    if (prefMin.length) {
      factors.ministry = prefMin.some(m => m && (vMin.includes(m) || m.includes(vMin))) ? 20 : 0;
    }

    const prefLoc = (profile.preferredLocations || []).map(s => U.normalizeText(s));
    const vLoc = U.normalizeText(U.formatLocation(vacancy));
    if (prefLoc.length) {
      const ncrWanted = prefLoc.some(l => l.includes('delhi') || l.includes('ncr'));
      const hit = prefLoc.some(l => l && vLoc.includes(l)) || (ncrWanted && U.isDelhiNcrLocation(vacancy));
      factors.location = hit ? 20 : 0;
    }

    const days = Number(vacancy.Days_Left);
    factors.deadline = days >= 7 ? 10 : days >= 0 ? 5 : 0;

    const tags = (profile.experienceTags || []).filter(Boolean);
    if (tags.length) {
      const text = (vacancy.Essential_Qualification || '') + ' ' + (vacancy.Desirable_Qualification || '');
      const hits = tags.filter(t => U.fuzzyIncludes(t, text)).length;
      factors.experience = Math.min(10, Math.round((hits / tags.length) * 10));
    }

    const score = Object.values(factors).reduce((a, b) => a + b, 0);
    return { score: Math.min(100, score), factors };
  }

  function matchTone(score) {
    if (score >= 70) return 'match-hi';
    if (score >= 40) return 'match-md';
    return 'match-lo';
  }

  function coolingOffPill(profile) {
    if (!profile.lastDeputationEndDate) return '';
    const start = new Date(profile.lastDeputationEndDate);
    if (Number.isNaN(start.getTime())) return '';
    const yrs = Number(profile.coolingOffYears || 0);
    const eligibleFrom = new Date(start.getFullYear() + yrs, start.getMonth(), start.getDate());
    const days = Math.round((eligibleFrom - new Date()) / 86400000);
    if (days <= 0) return '';
    return `<span class="md-pill critical"><i data-lucide="snowflake" style="width:12px;height:12px"></i> Cooling-off until ${U.formatDisplayDate(eligibleFrom.toISOString())}</span>`;
  }

  // ---------- Filter helpers (mirror app.js for saved-search counts) ----------
  function filterByCriteria(f) {
    if (!f) return vacancies.slice();
    return vacancies.filter(v => {
      if (f.search && !U.fuzzyIncludes(f.search, [v.Post_Name, v.Ministry, U.formatLocation(v), v.Level_Text, v.Essential_Qualification, v.Desirable_Qualification].filter(Boolean).join(' '))) return false;
      if (f.level && v.Level_Text !== f.level) return false;
      if (f.ministry && v.Ministry !== f.ministry) return false;
      if (f.location && U.formatLocation(v) !== f.location) return false;
      if (f.status && v.Status !== f.status) return false;
      if (f.myPayLevel) {
        const lvl = Number(f.myPayLevel);
        const lo = Math.min(Number(v.Req_Level1), Number(v.Req_Level2));
        const hi = Math.max(Number(v.Req_Level1), Number(v.Req_Level2));
        if (!(lvl >= lo && lvl <= hi)) return false;
      }
      if (f.quick === 'closing7' && !(Number(v.Days_Left) >= 0 && Number(v.Days_Left) <= 7)) return false;
      if (f.quick === 'closingToday' && Number(v.Days_Left) !== 0) return false;
      if (f.quick === 'delhiNcr' && !U.isDelhiNcrLocation(v)) return false;
      return true;
    });
  }

  function computeSearchNewCount(s) {
    if (!s || !s.filters) return 0;
    const current = filterByCriteria(s.filters).map(v => String(v.Vacancy_ID));
    const seen = new Set(s.lastResultIds || []);
    return current.filter(id => !seen.has(id)).length;
  }

  function uniqueVacancyValues(field, fn) {
    const set = new Set();
    vacancies.forEach(v => {
      const val = fn ? fn(v) : (field ? v[field] : '');
      if (val && U.hasMeaningfulValue(val)) set.add(String(val).trim());
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // ---------- Modal ----------
  function bindModal() {
    const modal = document.getElementById('modal');
    const close = document.getElementById('closeModal');
    if (close) close.addEventListener('click', closeModal);
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  }
  function showModal(html) {
    const modal = document.getElementById('modal');
    document.getElementById('modalBody').innerHTML = html;
    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }
  function closeModal() { document.getElementById('modal').style.display = 'none'; }

  // ---------- Misc UI helpers ----------
  function deadlinePill(date, daysLeft) {
    const d = daysLeft != null ? daysLeft : U.getDaysUntilDate(date);
    const tone = U.getDaysLeftTone(d);
    const text = d == null
      ? U.formatDisplayDate(date)
      : (d < 0 ? 'Expired' : d === 0 ? 'Closes today' : `${d} day${d === 1 ? '' : 's'}`);
    return `<span class="md-pill ${tone}"><i data-lucide="clock-3" style="width:12px;height:12px"></i>${text}</span>`;
  }

  function selectHtml(name, options, selected, isInline) {
    const opts = options.map(o => {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      const sel = String(selected ?? '') === String(val) ? 'selected' : '';
      return `<option value="${U.escapeHtml(val)}" ${sel}>${U.escapeHtml(label)}</option>`;
    }).join('');
    const cls = isInline ? '' : 'class="md-input"';
    return `<select name="${U.escapeHtml(name)}" ${cls}>${!Array.isArray(options[0]) ? '<option value="">Any</option>' : ''}${opts}</select>`;
  }

  function vacancyTitle(vid) {
    const v = vacancyById.get(String(vid));
    return v?.Post_Name || vid;
  }

  function updateTabBadges() {
    const bm = document.getElementById('tabBadgeBookmarks');
    const count = store.bookmarks().length;
    if (bm) { bm.textContent = count; bm.hidden = !count; }

    const ss = document.getElementById('tabBadgeSearches');
    const totalNew = store.searches().reduce((sum, s) => sum + computeSearchNewCount(s), 0);
    if (ss) { ss.textContent = totalNew; ss.hidden = !totalNew; }
  }

  function toast(message) {
    const el = document.getElementById('mdToast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- Export / Import / Reset ----------
  function exportData() {
    const payload = {};
    Object.entries(KEYS).forEach(([k, key]) => {
      const raw = localStorage.getItem(key);
      if (raw) payload[key] = JSON.parse(raw);
    });
    payload._exportedAt = new Date().toISOString();
    payload._app = 'deputation-control-room';
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-deputation-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Data exported');
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data._app !== 'deputation-control-room') {
          if (!confirm('This file may not be a My Deputation export. Import anyway?')) return;
        }
        Object.values(KEYS).forEach(key => {
          if (key in data) localStorage.setItem(key, JSON.stringify(data[key]));
        });
        toast('Data imported');
        renderActive(); renderWelcome(); updateTabBadges();
      } catch (err) {
        alert('Could not parse this file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function resetAll() {
    if (!confirm('Delete ALL My Deputation data (profile, bookmarks, tracker, documents, searches, reminders)? This cannot be undone.')) return;
    Object.values(KEYS).forEach(k => { if (k !== KEYS.theme) localStorage.removeItem(k); });
    toast('All data cleared');
    renderActive(); renderWelcome(); updateTabBadges();
  }
})();
