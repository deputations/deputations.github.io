// ===== india-map-data.js =====
// Data layer for the India Map page.
//
// Canonical source: bundled vacancies.json (always available, full records).
// RPC overlay: Supabase get_map_state_counts (optional, faster counts).
// NIC fallback: in-memory rawData from app.js / enrich.js.
//
// "Functional" and "Education" are derived categorizations from Functional_Area
// free-text — they are NOT columns in the source JSON.

window.IndiaMapData = (() => {
  'use strict';

  let allVacancies = [];   // normalised, active-only
  let stateCounts = {};    // { MH: 42, DL: 28, ... }
  let districtCounts = {}; // { 'MH|Pune': 5, ... }
  let nationwideCount = 0;
  let multiStateCount = 0;
  let source = 'none';

  // ----- Active-date check (mirrors app.js recomputeStatus) -----
  // The JSON's Status was computed at dump time and several days may have
  // passed since. Recompute from Last_Date_To_Apply at load time.
  function isActive(v) {
    // Accept both raw-field and normalised-field names
    const iso = String(v.Last_Date_To_Apply || v.last_date_to_apply || v.closingDate || '').trim();
    if (!iso) return true; // no closing date => treat as live
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d >= today;
  }

  // ----- Category derivation -----
  // The source JSON has no Category column. Functional_Area is free-text.
  // Derive a coarse bucket from keywords. Default = 'General'.
  function deriveCategory(v) {
    const fa = String(v.Functional_Area || v.functional_area || '').toLowerCase();
    const title = String(v.Post_Name || v.title || '').toLowerCase();
    const combined = fa + ' ' + title;
    const eduKws = ['teach', 'faculty', 'professor', 'lecturer', 'education', 'academic',
      'institute', 'university', 'college', 'school', 'research fellow', 'scholar'];
    const funcKws = ['account', 'finance', 'admin', 'steno', 'secretary', 'clerk', 'assistant',
      'officer', 'manager', 'supervisor', 'inspector', 'audit', 'legal', 'it ', 'tech ',
      'engineer', 'programmer', 'analyst', 'translator', ' hindi', 'stenography'];
    for (const kw of eduKws) {
      if (combined.includes(kw)) return 'Education';
    }
    for (const kw of funcKws) {
      if (combined.includes(kw)) return 'Functional';
    }
    return 'General';
  }

  function normaliseVacancy(v) {
    if (!v || typeof v !== 'object') return null;
    return {
      id: v.Vacancy_ID || v.id || '',
      title: v.Post_Name || v.title || 'Untitled post',
      ministry: v.Ministry || '',
      organisation: v.Organisation || '',
      level: v.Level_Text || v.Level || '',
      city: v.Location_City || '',
      stateName: v.Location_State || '',
      closingDate: v.Last_Date_To_Apply || '',
      category: deriveCategory(v),
      functionalArea: v.Functional_Area || '',
      state_abbr: v.state_abbr || '',
      district: v.district || '',
      location_scope: v.location_scope || 'district',
      notificationLink: v.Official_Notification_Link || '',
    };
  }

  // ----- Source loaders -----
  async function loadFromJSON() {
    const res = await fetch('data/vacancies.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('vacancies.json HTTP ' + res.status);
    const raw = await res.json();
    const list = Array.isArray(raw) ? raw : Object.values(raw);
    allVacancies = list.map(normaliseVacancy).filter(Boolean);
    source = 'json';
  }

  async function loadFromSupabase() {
    if (!window.supabase || typeof window.supabase.rpc !== 'function') {
      throw new Error('supabase client not on window');
    }
    const { data: rows, error } = await window.supabase.rpc('get_map_state_counts');
    if (error) throw error;
    if (!rows) throw new Error('empty rpc response');
    const rpcCounts = {};
    rows.forEach(r => { rpcCounts[r.state_abbr] = r.active || 0; });
    const hasRpcData = Object.values(rpcCounts).some(v => v > 0);
    return { rpcCounts, hasRpcData };
  }

  async function loadFromRawData() {
    if (!window.rawData || !window.rawData.length) return false;
    // Recompute from raw (un-normalised) data — normalise on the fly
    allVacancies = window.rawData.map(normaliseVacancy).filter(Boolean);
    source = 'rawdata';
    return true;
  }

  // ----- Canonical load sequence (single definition) -----
  async function load() {
    // 1. Try Supabase RPC first (fast counts). Non-fatal if unreachable.
    let useRpc = false;
    let rpcCounts = {};
    try {
      const rpcResult = await loadFromSupabase();
      rpcCounts = rpcResult.rpcCounts;
      useRpc = rpcResult.hasRpcData;
    } catch (e) {
      console.info('[map-data] Supabase RPC skipped:', e.message);
    }

    // 2. Always load JSON for full vacancy records (drill-down, filters).
    //    This is the canonical data source.
    try {
      await loadFromJSON();
    } catch (e2) {
      console.info('[map-data] JSON failed:', e2.message);
      // 3. NIC fallback: app.js / enrich.js may have window.rawData
      if (!(await loadFromRawData())) {
        throw new Error('No data source available (Supabase, JSON, rawData all empty)');
      }
    }

    // 4. Recompute counts from loaded vacancies (canonical)
    recomputeCounts();

    // 5. If RPC had non-zero data, overlay its counts (supersedes JSON for
    //    state totals only — district/nationwide/multistate stay JSON-derived).
    if (useRpc && Object.keys(rpcCounts).length > 0) {
      Object.entries(rpcCounts).forEach(([abbr, count]) => {
        stateCounts[abbr] = count;
      });
    }

    source = useRpc ? 'supabase+json' : (allVacancies.length ? 'json' : source);
    return { total: getTotal(), source, stateCounts };
  }

  // ----- Count recomputation from loaded vacancies -----
  function recomputeCounts() {
    stateCounts = {};
    districtCounts = {};
    nationwideCount = 0;
    multiStateCount = 0;
    const seen = new Set(); // deduplicate by vacancy ID
    allVacancies.forEach(v => {
      if (!isActive(v)) return;
      if (seen.has(v.id)) return; // stable dedup by Vacancy_ID
      seen.add(v.id);
      if (v.location_scope === 'nationwide') { nationwideCount++; return; }
      if (v.location_scope === 'multi_state') { multiStateCount++; return; }
      const abbr = v.state_abbr || '';
      if (!abbr) return;
      stateCounts[abbr] = (stateCounts[abbr] || 0) + 1;
      const dist = v.district || '';
      if (dist) {
        const key = abbr + '|' + dist.toLowerCase();
        districtCounts[key] = (districtCounts[key] || 0) + 1;
      }
    });
  }

  // ----- Public API -----
  function getStateCount(abbr) { return stateCounts[abbr] || 0; }
  function getStateCounts() { return stateCounts; }
  function getDistrictCounts() { return districtCounts; }
  function getTotal() { return Object.values(stateCounts).reduce((s, c) => s + c, 0); }
  function getSource() { return source; }
  function getAllVacancies() { return allVacancies; }
  function getNationwideCount() { return nationwideCount; }
  function getMultiStateCount() { return multiStateCount; }

  function getListingsForDistrict(stateAbbr, districtName) {
    if (!stateAbbr || !districtName) return [];
    const key = String(stateAbbr) + '|' + String(districtName).toLowerCase();
    const count = districtCounts[key] || 0;
    if (count === 0) return [];
    return allVacancies.filter(v =>
      isActive(v) &&
      v.location_scope === 'district' &&
      v.state_abbr === stateAbbr &&
      String(v.district).toLowerCase() === String(districtName).toLowerCase()
    );
  }

  function getFiltered(abbr, opts = {}) {
    if (!abbr) return [];
    let list = allVacancies.filter(v =>
      isActive(v) &&
      v.state_abbr === abbr
    );
    if (opts.category) {
      const cat = String(opts.category);
      list = list.filter(v => v.category === cat);
    }
    return list;
  }

  // Realtime support: increment a state count by one for a new vacancy.
  function incrementStateCount(abbr, district) {
    if (!abbr) return;
    stateCounts[abbr] = (stateCounts[abbr] || 0) + 1;
    if (district && district.trim()) {
      const key = abbr + '|' + district.toLowerCase().trim();
      districtCounts[key] = (districtCounts[key] || 0) + 1;
    }
  }

  return {
    load, isActive,
    getStateCount, getStateCounts, getTotal, getSource, getAllVacancies,
    getNationwideCount, getMultiStateCount,
    getListingsForDistrict, getFiltered, normaliseVacancy, deriveCategory,
    incrementStateCount,
  };
})();
