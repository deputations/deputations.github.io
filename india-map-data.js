// ===== india-map-data.js =====
// Migrated from prototypes/india-map/js/india-map/map-data-loader.js
// Loads vacancy data for the India map (Supabase first, JSON fallback)

window.IndiaMapData = (() => {
  let allVacancies = [];
  let stateCounts = {};
  let districtCounts = {};
  let source = 'none';

  // Normalise a single vacancy entry from Supabase or JSON
  function normaliseVacancy(v) {
    if (!v || typeof v !== 'object') return null;
    const status = String(v.Status || v.status || '').toLowerCase();
    const isActive = status === '' || status === 'active' || status === 'published' || status === 'open';
    const loc = String(v.Location_State || v.location_state || v.state || '').trim();
    return {
      id: v.Vacancy_ID || v.id || v.vacancy_id || Math.random().toString(36).slice(2, 9),
      title: v.Post || v.title || v.post || 'Unknown',
      ministry: v.Ministry || v.ministry || '',
      state: loc,
      district: v.Location_District || v.location_district || v.district || '',
      status: status || 'active',
      active: isActive,
      payLevel: v.Pay_Level || v.pay_level || v.payLevel || '',
      functional: v.Functional_Group || v.functional_group || '',
      education: v.Educational_Qualification || v.educational_qualification || '',
      closingDate: v.Last_Date || v.closing_date || v.last_date || '',
    };
  }

  // State name → abbreviation mapping
  const STATE_ABBR_MAP = {
    'andhra pradesh':'AP','arunachal pradesh':'AR','assam':'AS','bihar':'BR',
    'chhattisgarh':'CG','goa':'GA','gujarat':'GJ','haryana':'HR',
    'himachal pradesh':'HP','jammu and kashmir':'JK','jharkhand':'JH','karnataka':'KA',
    'kerala':'KL','madhya pradesh':'MP','maharashtra':'MH','manipur':'MN',
    'meghalaya':'ML','mizoram':'MZ','nagaland':'NL','odisha':'OD','punjab':'PB',
    'rajasthan':'RJ','sikkim':'SK','tamil nadu':'TN','telangana':'TS','tripura':'TR',
    'uttar pradesh':'UP','uttarakhand':'UK','west bengal':'WB',
    'andaman and nicobar':'AN','chandigarh':'CH','dadra and nagar haveli':'DN','daman and diu':'DD',
    'lakshadweep':'LD','delhi':'DL','puducherry':'PY',
    'jammu & kashmir':'JK','andaman & nicobar':'AN','nct of delhi':'DL',
    'delhi, nct of':'DL',
  };

  function getStateAbbr(stateName) {
    if (!stateName) return '';
    const key = stateName.toLowerCase().trim();
    if (STATE_ABBR_MAP[key]) return STATE_ABBR_MAP[key];
    // Try partial match
    for (const [k, v] of Object.entries(STATE_ABBR_MAP)) {
      if (key.includes(k) || k.includes(key)) return v;
    }
    // 2-3 char codes already
    if (key.length <= 3) return key.toUpperCase();
    return '';
  }

  function getListingsForDistrict(stateAbbr, districtName) {
    if (!districtName) return [];
    return allVacancies.filter(v =>
      v.active && v.stateAbbr === stateAbbr &&
      v.district && v.district.toLowerCase() === districtName.toLowerCase()
    );
  }

  function countDistrictListings(stateAbbr, fixtureNames) {
    const seen = new Set();
    let count = 0;
    fixtureNames.forEach(fn => {
      getListingsForDistrict(stateAbbr, fn).forEach(l => {
        if (!seen.has(l.id)) { seen.add(l.id); count++; }
      });
    });
    return count;
  }

  // Load from bundled JSON
  async function loadFromJSON() {
    try {
      const res = await fetch('vacancies.json?v=1');
      if (!res.ok) throw new Error('vacancies.json not found');
      const raw = await res.json();
      const list = Array.isArray(raw) ? raw : (raw.vacancies || raw.data || []);
      allVacancies = list.map(normaliseVacancy).filter(Boolean);
      source = 'json';
    } catch (e) {
      console.warn('[map-data] JSON load failed:', e);
      allVacancies = [];
      source = 'none';
    }
  }

  // Load from Supabase
  async function loadFromSupabase() {
    try {
      if (!window.supabase || typeof window.supabase.rpc !== 'function') {
        throw new Error('supabase.rpc not available');
      }
      const SUP_HOST = new URL(window.SUPABASE_URL).host;
      const [{ data: stateRows, error: sErr }, { data: bucketRows, error: bErr }] =
        await Promise.all([
          window.supabase.rpc('get_map_state_counts', { p_central_only: false }),
          window.supabase.rpc('get_map_bucket_counts'),
        ]);
      if (sErr) throw sErr;
      if (bErr) throw bErr;
      stateCounts = {};
      (stateRows || []).forEach(r => { stateCounts[r.state_abbr] = r.count || 0; });
      source = 'supabase';
      return true;
    } catch (e) {
      console.warn('[map-data] Supabase load failed:', e);
      return false;
    }
  }

  // Main load: try Supabase, fall back to JSON
  async function load() {
    // Try Supabase first
    const sbOk = await loadFromSupabase();
    if (!sbOk) {
      await loadFromJSON();
    }
    // Normalise and compute counts
    allVacancies = allVacancies.map(normaliseVacancy).filter(Boolean);
    const rawActive = allVacancies.filter(v => v.active);
    stateCounts = {};
    districtCounts = {};
    rawActive.forEach(v => {
      const abbr = v.stateAbbr || getStateAbbr(v.state);
      v.stateAbbr = abbr;
      if (!abbr) return;
      stateCounts[abbr] = (stateCounts[abbr] || 0) + 1;
      if (v.district) {
        const dk = abbr + '|' + v.district.toLowerCase();
        districtCounts[dk] = (districtCounts[dk] || 0) + 1;
      }
    });
    return { total: rawActive.length, source, stateCounts, districtCounts };
  }

  function getStateCount(abbr) { return stateCounts[abbr] || 0; }
  function getTotal() { return Object.values(stateCounts).reduce((s, c) => s + c, 0); }
  function getSource() { return source; }
  function getAllVacancies() { return allVacancies; }
  function getFiltered(stateAbbr, filters = {}) {
    return allVacancies.filter(v => {
      if (!v.active) return false;
      if (stateAbbr && v.stateAbbr !== stateAbbr) return false;
      if (filters.functional && filters.functional !== 'all' && v.functional !== filters.functional) return false;
      if (filters.education && filters.education !== 'all' && !v.education?.includes(filters.education)) return false;
      return true;
    });
  }

  return {
    load, getStateCount, getTotal, getSource, getAllVacancies, getFiltered,
    getListingsForDistrict, countDistrictListings, normaliseVacancy,
    getStateAbbr, STATE_ABBR_MAP,
  };
})();
