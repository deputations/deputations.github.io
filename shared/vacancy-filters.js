/* shared/vacancy-filters.js — the dashboard's sidebar filter rules, shared by
 * the home page (app.js) and the India map (india-map-filters.js), exposed
 * as window.DepFilters.
 *
 *  • matches(item, state, opts) — the sidebar filters (search, My Pay Level +
 *    experience, Pay Level, Ministry, Organisation, Organisation Type, Region,
 *    Location, Status) exactly as app.js#getFilteredData applies them. Quick
 *    chips, the watchlist and KPI cards stay in app.js (home page only).
 *  • orgKey / buildOrgIndex / fuzzyIncludes / formatLocation — moved here
 *    from app.js unchanged, so both pages group and match identically.
 *  • A selection is one "state" object. It is saved per browser tab
 *    (sessionStorage) in the home page's existing URL parameter format
 *    (?search=…&myPayLevel=…&level=a,b&org=…&location=…&status=…), so a
 *    filter chosen on one page is still applied when the other page opens.
 */
(function () {
  'use strict';

  function safe(value) {
    return value == null ? '' : String(value).trim();
  }

  function normalizeText(text) {
    return safe(text)
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
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

  // Matching key for an organisation name, so spellings of the same body
  // collapse into one filter option:
  //   "Central Water Commission (CWC)"                ┐
  //   "Central Water Commission"                      ┘→ "central water commission"
  //   "Footwear Design & Development Institute"       ┐
  //   "Footwear Design and Development Institute (FDDI)" ┘→ same key
  //   "AIIMS, Rishikesh" / "AIIMS Rishikesh"           → same key
  // A bracket is dropped only when it is a short form (its first word is in
  // capitals: "(CWC)", "(AIIMS Nagpur)", "(SPM-NIWAS)"); descriptive brackets
  // such as "(Handicrafts)" or "(Storage and Research Division)" stay part of
  // the key, so genuinely different offices remain separate options.
  const orgKeyMemo = new Map();
  function orgKey(name) {
    const raw = safe(name);
    if (!raw) return '';
    let key = orgKeyMemo.get(raw);
    if (key === undefined) {
      key = raw
        .replace(/\(([^()]*)\)/g, (m, inner) =>
          isShortFormWord(inner.trim().split(/\s+/)[0]) ? ' ' : ` ${inner} `)
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      orgKeyMemo.set(raw, key);
    }
    return key;
  }
  function isShortFormWord(w) {
    return !!w && /^[A-Z0-9][A-Z0-9&.\-]*$/.test(w) && /[A-Z]/.test(w);
  }

  // Per organisation key: the name to display and its short (mobile) label.
  //  • Display name: among the spellings in the data, prefer one that carries
  //    its official short form in brackets (so "(CFQCTI)" wins over an
  //    auto-built acronym), then the most frequent, then the longest.
  //  • Short label: "IIT Goa" → "IITG"; an explicit bracket is used whole and
  //    text after it is kept ("AIIMS Nagpur", "AIIMS, Jodhpur") so campuses
  //    differ. Organisations with no short
  //    form, or one shared with another organisation (IIT Goa / IIT
  //    Gandhinagar → "IITG"), get none and show their full name instead, so
  //    the list is never ambiguous.
  function buildOrgIndex(rows) {
    const acronymFor = window.DepEnrich && window.DepEnrich.acronymFor;
    const variants = {};   // key → { name → row count }
    rows.forEach(r => {
      const name = safe(r.Organisation);
      const key = orgKey(name);
      if (!key) return;
      const v = variants[key] || (variants[key] = {});
      v[name] = (v[name] || 0) + 1;
    });
    const hasShortForm = (n) => {
      const m = n.match(/\(([^()]*)\)/);
      return !!m && isShortFormWord(m[1].trim().split(/\s+/)[0]);
    };
    const names = {}, shortOf = {};
    Object.keys(variants).forEach(key => {
      const counts = variants[key];
      const name = Object.keys(counts).sort((a, b) =>
        (hasShortForm(b) - hasShortForm(a)) || (counts[b] - counts[a]) || (b.length - a.length))[0];
      names[key] = name;
      const acr = acronymFor ? acronymFor(name) : '';
      if (!acr) return;
      // An explicit bracket that starts with the acronym is used whole
      // ("(AIIMS Nagpur)" → "AIIMS Nagpur"), plus any text after it.
      const m = name.match(/^(.*?)\(\s*([^()]+?)\s*\)\s*(.*)$/);
      const explicit = m && m[2].startsWith(acr) ? m : null;
      const base = explicit ? explicit[2] : acr;
      const tail = explicit ? explicit[3].trim() : '';
      shortOf[key] = tail ? `${base}${tail.startsWith(',') ? '' : ' '}${tail}` : base;
    });
    const uses = {};
    Object.values(shortOf).forEach(sh => { uses[sh] = (uses[sh] || 0) + 1; });
    const short = {};
    Object.keys(shortOf).forEach(key => { if (uses[shortOf[key]] === 1) short[key] = shortOf[key]; });
    return { names, short, forRows: rows };
  }

  function formatLocation(item) {
    const city = safe(item.Location_City);
    const state = safe(item.Location_State);
    if (city && state) return `${city}, ${state}`;
    return city || state || '';
  }

  // Department_Organisation and Desirable_Qualification are Sheets-era column
  // names that the Supabase pipeline never fills; Organisation is the real
  // field. search_text is the pre-built blob from enrich.js/build_data.py (it
  // carries acronym expansions). The legacy keys are harmless when absent.
  function searchableText(item) {
    return [
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
  }

  // Search hits memoised per query: option counts re-run the filters once per
  // dropdown on every render, and fuzzy-matching every row each time would
  // multiply the cost of a keystroke. Reset whenever the query changes.
  let searchMemo = { query: null, hits: new WeakMap() };
  function matchesSearch(item, query) {
    if (searchMemo.query !== query) searchMemo = { query, hits: new WeakMap() };
    let hit = searchMemo.hits.get(item);
    if (hit === undefined) {
      hit = fuzzyIncludes(query, searchableText(item));
      searchMemo.hits.set(item, hit);
    }
    return hit;
  }

  // ----- Selection state -------------------------------------------------
  // { search, myPayLevel, experience, levels[], ministry, orgs[] (orgKey),
  //   orgType, region, locations[], status, quick[], watchlist }
  function emptyState() {
    return { search: '', myPayLevel: '', experience: '', levels: [], ministry: '', orgs: [],
      orgType: '', region: '', locations: [], status: 'Active', quick: [], watchlist: false };
  }

  // The sidebar filters on `item`. `exclude` names one filter to ignore
  // ('myPayLevel', 'level', 'ministry', 'organisation', 'orgType', 'region',
  // 'location', 'status') — used for each dropdown's faceted "(N)" counts.
  function matches(item, state, opts = {}) {
    const exclude = opts.exclude || '';
    const applyStatus = opts.applyStatus !== false;
    const s = state || emptyState();
    const search = safe(s.search).toLowerCase();
    if (search && !matchesSearch(item, search)) return false;
    if (exclude !== 'level' && s.levels && s.levels.length && !s.levels.includes(safe(item.Level_Text))) return false;
    if (exclude !== 'organisation' && s.orgs && s.orgs.length && !s.orgs.includes(orgKey(item.Organisation))) return false;
    if (exclude !== 'ministry' && s.ministry && safe(item.Ministry) !== s.ministry) return false;
    if (exclude !== 'orgType' && s.orgType && safe(item.Organisation_Type) !== s.orgType) return false;
    if (exclude !== 'region' && s.region && safe(item.Region) !== s.region) return false;
    if (exclude !== 'location' && s.locations && s.locations.length && !s.locations.includes(formatLocation(item))) return false;
    if (applyStatus && exclude !== 'status' && s.status && safe(item.Status) !== s.status) return false;
    if (exclude !== 'myPayLevel' && s.myPayLevel) {
      // Tier-aware eligibility: matches the candidate's level + years-at-level
      // against the vacancy's eligibility_tiers (see enrich.js#isEligible).
      // Experience only narrows results when a pay level is also chosen.
      const isEligible = window.DepEnrich && window.DepEnrich.isEligible;
      if (isEligible && !isEligible(item, s.myPayLevel, s.experience || '')) return false;
    }
    return true;
  }

  // How many of the filters both pages offer are set (not Status, the quick
  // chips or the watchlist, which only the home page has).
  function activeCount(state) {
    const s = state || emptyState();
    return [s.search, s.myPayLevel, s.ministry, s.orgType, s.region].filter(Boolean).length
      + ((s.levels || []).length ? 1 : 0) + ((s.orgs || []).length ? 1 : 0)
      + ((s.locations || []).length ? 1 : 0);
  }

  // ----- URL format (the home page's ?search=… links) -----------------------
  const PARAM_KEYS = ['search', 'myPayLevel', 'experience', 'ministry', 'orgType', 'region',
    'level', 'org', 'location', 'status', 'quick', 'watchlist'];

  function hasFilterParams(params) {
    return PARAM_KEYS.some(k => params.has(k));
  }

  function toParams(state) {
    const s = state || emptyState();
    const p = new URLSearchParams();
    if (s.search) p.set('search', s.search);
    if (s.myPayLevel) p.set('myPayLevel', s.myPayLevel);
    if (s.experience) p.set('experience', s.experience);
    if (s.ministry) p.set('ministry', s.ministry);
    if (s.orgType) p.set('orgType', s.orgType);
    if (s.region) p.set('region', s.region);
    if ((s.levels || []).length) p.set('level', s.levels.join(','));
    (s.orgs || []).forEach(o => p.append('org', o));
    (s.locations || []).forEach(l => p.append('location', l));
    // Status is always written: "" is a real choice (All), distinct from absent.
    p.set('status', s.status || '');
    if ((s.quick || []).length) p.set('quick', s.quick.join(','));
    if (s.watchlist) p.set('watchlist', '1');
    return p;
  }

  function fromParams(params) {
    const s = emptyState();
    const list = (v) => (v || '').split(',').map(x => x.trim()).filter(Boolean);
    s.search = params.get('search') || '';
    s.myPayLevel = params.get('myPayLevel') || '';
    s.experience = params.get('experience') || '';
    s.ministry = params.get('ministry') || '';
    s.orgType = params.get('orgType') || '';
    s.region = params.get('region') || '';
    s.levels = list(params.get('level'));
    // Organisation names and places contain commas ("AIIMS, Patna",
    // "Patna, Bihar"), so one param each
    s.orgs = [...new Set(params.getAll('org').map(orgKey).filter(Boolean))];
    s.locations = [...new Set(params.getAll('location').map(safe).filter(Boolean))];
    if (params.has('status')) s.status = params.get('status') || '';
    s.quick = list(params.get('quick'));
    s.watchlist = params.get('watchlist') === '1';
    return s;
  }

  // ----- Saved selection (this browser tab) -------------------------------
  const STORE_KEY = 'dep_filters_v1';

  function save(state) {
    try { sessionStorage.setItem(STORE_KEY, toParams(state).toString()); } catch (e) { /* storage off */ }
  }

  function savedParams() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      return raw == null ? null : new URLSearchParams(raw);
    } catch (e) { return null; }
  }

  function load() {
    const p = savedParams();
    return p ? fromParams(p) : null;
  }

  // ----- Option ordering shared by both pages ------------------------------
  const LEVEL_RX = /(\d+)([\s-]*A\b)?/;
  function levelRank(value) {
    const m = safe(value).toUpperCase().match(LEVEL_RX);
    if (!m) return null;
    return parseInt(m[1], 10) + (m[2] ? 0.5 : 0);
  }
  function compareLevels(a, b) {
    const va = levelRank(a), vb = levelRank(b);
    if (va == null && vb == null) return a.localeCompare(b);
    if (va == null) return 1;
    if (vb == null) return -1;
    if (vb !== va) return vb - va;            // higher pay level first
    return a.localeCompare(b);
  }
  const REGION_ORDER = ['North', 'South', 'East', 'West', 'Central', 'NorthEast'];
  const REGION_LABEL = { NorthEast: 'North-East' };
  // My Pay Level choices: 18 … 1, with 13A between 14 and 13
  function myPayLevelValues() {
    const out = [];
    for (let i = 18; i >= 1; i--) { out.push(String(i)); if (i === 14) out.push('13A'); }
    return out;
  }

  window.DepFilters = {
    safe, normalizeText, fuzzyIncludes, orgKey, isShortFormWord, buildOrgIndex, formatLocation,
    searchableText, matches, activeCount, emptyState,
    PARAM_KEYS, hasFilterParams, toParams, fromParams,
    STORE_KEY, save, load, savedParams,
    levelRank, compareLevels, REGION_ORDER, REGION_LABEL, myPayLevelValues,
  };
})();
