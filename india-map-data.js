// ===== india-map-data.js =====
// Data layer for the India Map page.
//
// Counts are recomputed from last_date_to_apply at load time, exactly like
// app.js recomputeStatus() does for the dashboard — the JSON's Status field
// goes stale between the daily dump and the moment a visitor arrives.
//
// The enriched vacancies.json already carries state_abbr / district /
// location_scope per record (see scripts/enrich-districts.js), so this file
// reads those rather than re-deriving geography from free-text city names.

window.IndiaMapData = (() => {
  'use strict';

  let allVacancies = [];   // normalised, active-only
  let stateCounts = {};    // { MH: 42, DL: 28, ... }
  let districtCounts = {}; // { 'MH|Pune': 5, ... }
  let nationwideCount = 0;
  let multiStateCount = 0;
  let source = 'none';

  // Recompute Status from last_date_to_apply, mirroring app.js
  // recomputeStatus(): the JSON's Status was computed at dump time and
  // several days may have passed since.
  function isActive(v) {
    const iso = String(v.Last_Date_To_Apply || v.last_date_to_apply || '').trim();
    if (!iso) return true; // no closing date → treat as live
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d >= today;
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
      // Enriched geography — already resolved, never re-guessed here
      state_abbr: v.state_abbr || '',
      district: v.district || '',
      location_scope: v.location_scope || 'district',
      notificationLink: v.Official_Notification_Link || '',
    };
  }

  async function loadFromJSON() {
    // The dashboard reads the same file from the same relative path.
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
    stateCounts = {};
    rows.forEach(r => { stateCounts[r.state_abbr] = r.active || 0; });
    source = 'supabase';
    return true;
  }

  async function loadFromRawData() {
    // Third fallback: app.js already fetched & enriched the full dataset into
    // window.rawData (Supabase wins when available, JSON when not). If both
    // Supabase RPC and the bundled JSON are unavailable (e.g. NIC network
    // with empty JSON), derive counts directly from the in-memory rawData.
    if (!window.rawData || !window.rawData.length) return false;
    recomputeCountsFrom(window.rawData);
    source = 'rawdata';
    return true;
  }

  function recomputeCountsFrom(list) {
    stateCounts = {};
    districtCounts = {};
    nationwideCount = 0;
    multiStateCount = 0;
    list.forEach(v => {
      if (!isActive(v)) return;
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

  async function load() {
    // Order: Supabase RPC → bundled JSON → in-memory rawData (from app.js)
    try {
      await loadFromSupabase();
    } catch (e) {
      console.info('[map-data] Supabase RPC failed:', e.message);
      try {
        await loadFromJSON();
        recomputeCounts();
      } catch (e2) {
        console.info('[map-data] JSON also failed:', e2.message);
        if (!(await loadFromRawData())) {
          throw new Error('No data source available (Supabase, JSON, rawData all empty)');
        }
      }
    }
    return { total: getTotal(), source, stateCounts };
  }

  function recomputeCounts() {
    stateCounts = {};
    districtCounts = {};
    nationwideCount = 0;
    multiStateCount = 0;

    allVacancies.forEach(v => {
      if (!isActive(v)) return;
      if (v.location_scope === 'nationwide') { nationwideCount++; return; }
      if (v.location_scope === 'multi_state') { multiStateCount++; return; }
      if (!v.state_abbr) return;
      stateCounts[v.state_abbr] = (stateCounts[v.state_abbr] || 0) + 1;
      if (v.district) {
        const key = v.state_abbr + '|' + v.district.toLowerCase();
        districtCounts[key] = (districtCounts[key] || 0) + 1;
      }
    });
  }

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

  return {
    load, isActive,
    getStateCount, getStateCounts, getTotal, getSource, getAllVacancies,
    getNationwideCount, getMultiStateCount,
    getListingsForDistrict, normaliseVacancy,
  };
})();
