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
    const iso = String(v.Last_Date_To_Apply || v.last_date_to_apply || v.closingDate || '').trim();
    if (!iso) return true;
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return d >= today;
  }

  // Derive state abbreviation from Location_State name.
  // Maps both abbreviations and full names to the 2-letter abbr.
  // Must match STATE_ABBR from india-map-view.js (which maps abbr -> name).
  const NAME_TO_ABBR = {
    'Delhi':'DL','Delhi NCR':'DL','NCT of Delhi':'DL',
    'Maharashtra':'MH','Andhra Pradesh':'AP','Karnataka':'KA',
    'Tamil Nadu':'TN','Uttar Pradesh':'UP','Kerala':'KL',
    'Gujarat':'GJ','Rajasthan':'RJ','West Bengal':'WB','Madhya Pradesh':'MP',
    'Bihar':'BR','Chhattisgarh':'CG','Odisha':'OD','Telangana':'TS',
    'Jharkhand':'JH','Assam':'AS','Punjab':'PB','Haryana':'HR',
    'Himachal Pradesh':'HP','Jammu and Kashmir':'JK','Jammu & Kashmir':'JK',
    'Uttarakhand':'UK','Goa':'GA','Tripura':'TR','Manipur':'MN',
    'Meghalaya':'ML','Mizoram':'MZ','Nagaland':'NL','Arunachal Pradesh':'AR',
    'Sikkim':'SK','Andaman and Nicobar Islands':'AN','Chandigarh':'CH',
    'Dadra and Nagar Haveli and Daman and Diu':'DNH','Puducherry':'PY',
    'Lakshadweep':'LD','Ladakh':'LA',
    // Multi-state keywords → empty (handled by location_scope)
    'Multiple States':'','All India':'','Multiple':'','Across India':'',
  };

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

  // ----- City → district resolution -----
  // Location_City is free text; the map's districts come from
  // geo/india-districts-all.geojson. A vacancy matches a district when any
  // candidate taken from its city (the whole string, the parts inside or
  // before parentheses, the parts between commas, minus a "DRT"/"DRTs"/"DRAT"
  // prefix) equals the district name after normKey(), either directly or via
  // the alias table below. Aliases are scoped by state so "Aurangabad" (BR vs
  // MH) or "Bilaspur" (CG vs HP) never cross state lines. Keys are normKey()'d
  // city names; values are district names exactly as the GeoJSON spells them.
  const CITY_DISTRICT_ALIASES = {
    AN: { srivijayapuram: 'South Andaman', portblair: 'South Andaman' },
    AP: { mangalagiri: 'Guntur', amaravati: 'Guntur', vijayawada: 'Krishna',
          vishakhapatnam: 'Visakhapatnam', vizag: 'Visakhapatnam',
          tirupati: 'Chittoor', nellore: 'S.P.S. Nellore', kadapa: 'Y.S.R. Kadapa',
          rajahmundry: 'East Godavari', rajamahendravaram: 'East Godavari',
          kakinada: 'East Godavari', anantapuramu: 'Anantapur' },
    AR: { itanagar: 'Papum Pare', jote: 'Papum Pare', pasighat: 'East Siang' },
    AS: { guwahati: 'Kamrup Metropolitan', dispur: 'Kamrup Metropolitan',
          silchar: 'Cachar', biswanathchariali: 'Biswanath', tezpur: 'Sonitpur' },
    GA: { panaji: 'North Goa', panjim: 'North Goa', vascodagama: 'South Goa',
          margao: 'South Goa', madgaon: 'South Goa' },
    GJ: { gandhidham: 'Kutch', baroda: 'Vadodara' },
    HR: { hissar: 'Hisar', gurgaon: 'Gurugram', manesar: 'Gurugram', kundli: 'Sonipat' },
    JH: { jamshedpur: 'East Singhbhum' },
    KA: { bengaluru: 'Bengaluru Urban', bangalore: 'Bengaluru Urban',
          hubli: 'Dharwad', hubballi: 'Dharwad', mysore: 'Mysuru',
          mangalore: 'Dakshina Kannada', mangaluru: 'Dakshina Kannada',
          belgaum: 'Belagavi', gulbarga: 'Kalaburagi' },
    KL: { kochi: 'Ernakulam', cochin: 'Ernakulam', ernakulum: 'Ernakulam',
          kakkanad: 'Ernakulam', calicut: 'Kozhikode', trivandrum: 'Thiruvananthapuram',
          trichur: 'Thrissur' },
    MH: { chatrapatisambhajinagar: 'Aurangabad', chhatrapatisambhajinagar: 'Aurangabad',
          sambhajinagar: 'Aurangabad', kamptee: 'Nagpur', navimumbai: 'Thane',
          bombay: 'Mumbai', poona: 'Pune', nasik: 'Nashik' },
    ML: { shillong: 'East Khasi Hills', umsaw: 'Ribhoi', umiam: 'Ribhoi', tura: 'West Garo Hills' },
    MP: { budni: 'Sehore', mhow: 'Indore', narmadapuram: 'Hoshangabad' },
    OD: { bhubaneswar: 'Khordha', bhubaneshwar: 'Khordha', gopalpur: 'Ganjam',
          rourkela: 'Sundargarh' },
    PB: { mohali: 'S.A.S. Nagar', banur: 'S.A.S. Nagar', ropar: 'Rupnagar' },
    TR: { agartala: 'West Tripura' },
    TS: { secunderabad: 'Hyderabad', bibinagar: 'Yadadri Bhuvanagiri' },
    UK: { rishikesh: 'Dehradun', mussoorie: 'Dehradun', srinagargarhwal: 'Pauri Garhwal',
          roorkee: 'Haridwar', tanakpur: 'Champawat', gopeshwar: 'Chamoli',
          haldwani: 'Nainital', rudrapur: 'Udham Singh Nagar' },
    UP: { kanpur: 'Kanpur Nagar', noida: 'Gautam Buddha Nagar',
          greaternoida: 'Gautam Buddha Nagar', allahabad: 'Prayagraj', faizabad: 'Ayodhya' },
    WB: { falta: 'South 24 Parganas', siliguri: 'Darjeeling', kharagpur: 'Paschim Medinipur' },
  };

  function normKey(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  function cityCandidates(city) {
    const s = String(city || '').replace(/^\s*(drts?|drat)\s+/i, '').trim();
    if (!s) return [];
    return [s, ...s.split(/[(),]/).map(p => p.trim()).filter(Boolean)];
  }

  // normKey()'d district names this vacancy can match. An explicit district
  // (enriched data or the Delhi rule) is authoritative; otherwise every
  // city candidate is offered, plus its alias when the state has one.
  function districtKeysFor(abbr, district, city) {
    if (district) return [normKey(district)];
    const aliases = CITY_DISTRICT_ALIASES[abbr] || {};
    const keys = [];
    for (const c of cityCandidates(city)) {
      const k = normKey(c);
      if (!k) continue;
      if (aliases[k]) keys.push(normKey(aliases[k]));
      keys.push(k);
    }
    return Array.from(new Set(keys));
  }

  function normaliseVacancy(v) {
    const out = buildVacancy(v);
    if (out) out.districtKeys = districtKeysFor(out.state_abbr, out.district, out.city);
    return out;
  }

  function buildVacancy(v) {
    if (!v || typeof v !== 'object') return null;
    const rawState = v.Location_State || '';
    // Trust an already-resolved abbreviation only if it's a known valid one;
    // otherwise derive from Location_State name. Unknown strings never become state IDs.
    const VALID_ABBRS = new Set(Object.values(NAME_TO_ABBR).filter(a => a.length === 2));
    const preAbbr = v.state_abbr && VALID_ABBRS.has(v.state_abbr) ? v.state_abbr : null;
    const abbr = preAbbr || NAME_TO_ABBR[rawState] || '';
    return {
      id: v.Vacancy_ID || v.id || '',
      title: v.Post_Name || v.title || 'Untitled post',
      ministry: v.Ministry || '',
      organisation: v.Organisation || '',
      level: v.Level_Text || v.Level || '',
      city: v.Location_City || '',
      stateName: rawState,
      state_abbr: abbr,
      closingDate: v.Last_Date_To_Apply || '',
      category: deriveCategory(v),
      functionalArea: v.Functional_Area || '',
      district: (() => {
        const d = v.district || '';
        if (d) return d;
        if (abbr === 'DL') {
          const c = String(v.Location_City || '').toLowerCase().trim();
          if (c === 'new delhi') return 'New Delhi';
          // Generic "Delhi" stays district-unknown — no authoritative rule maps it to a specific district
          return '';
        }
        return '';
      })(),
      location_scope: v.location_scope || '',
      districtKeys: [],
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

  // Diagnostic: compare JSON counts with RPC counts for freshness monitoring.
  // Does NOT modify visible state counts. Returns diff object.
  function rpcDiagnostic() {
    return new Promise((resolve) => {
      if (!window.supabase || typeof window.supabase.rpc !== 'function') {
        resolve(null); return;
      }
      window.supabase.rpc('get_map_state_counts').then(({ data: rows, error }) => {
        if (error || !rows) { resolve(null); return; }
        const rpc = {};
        rows.forEach(r => { rpc[r.state_abbr] = r.active || 0; });
        const diff = {};
        Object.keys(stateCounts).forEach(abbr => {
          const j = stateCounts[abbr] || 0;
          const r = rpc[abbr] || 0;
          if (j !== r) diff[abbr] = { json: j, rpc: r };
        });
        resolve({ diff, totalJson: getTotal(), totalRpc: Object.values(rpc).reduce((s,c)=>s+c,0) });
      }).catch(() => resolve(null));
    });
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
    // 1. Load JSON first (canonical source for full vacancy records).
    try {
      await loadFromJSON();
    } catch (e2) {
      console.info('[map-data] JSON failed:', e2.message);
      if (!(await loadFromRawData())) {
        throw new Error('No data source available');
      }
    }

    // 2. Recompute counts from loaded vacancies (canonical)
    recomputeCounts();

    // 3. Supabase RPC is available for diagnostic/freshness via rpcDiagnostic().
    //    Do NOT overlay RPC-only counts — visible counts must be record-coherent.
    source = allVacancies.length ? 'json' : source;
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
    const target = normKey(districtName);
    if (!target) return [];
    const seen = new Set();
    return allVacancies.filter(v => {
      if (!isActive(v)) return false;
      if (v.state_abbr !== stateAbbr) return false;
      // Nationwide / multi-state records never belong to one district
      if (v.location_scope === 'nationwide' || v.location_scope === 'multi_state') return false;
      if (!(v.districtKeys || []).includes(target)) return false;
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      return true;
    });
  }

  function getFiltered(abbr, opts = {}) {
    if (!abbr) return [];
    const seen = new Set(); // same dedup contract as recomputeCounts
    return allVacancies.filter(v => {
      if (!isActive(v)) return false;
      if (v.state_abbr !== abbr) return false;
      if (seen.has(v.id)) return false;
      seen.add(v.id);
      if (opts.category && v.category !== opts.category) return false;
      return true;
    });
  }

  // Realtime support: ingest a new vacancy with ID dedup and active-date scope.
  // Updates allVacancies, stateCounts, districtCounts so that filtered counts,
  // tooltip breakdowns, and district listings all stay consistent.
  function recordNewVacancy(raw) {
    const v = normaliseVacancy(raw);
    if (!v || !v.id) return false;
    // Dedup: drop existing entry with same ID (and its counts)
    const idx = allVacancies.findIndex(existing => existing.id === v.id);
    if (idx >= 0) {
      const old = allVacancies[idx];
      // Only decrement counters if the old record WAS active and counted.
      // If old was inactive, it never contributed to counts, so don't subtract.
      const oldWasActive = isActive(old);
      allVacancies.splice(idx, 1);
      if (oldWasActive) {
        if (old.location_scope === 'nationwide') { nationwideCount--; }
        else if (old.location_scope === 'multi_state') { multiStateCount--; }
        else if (old.state_abbr) {
          stateCounts[old.state_abbr] = Math.max((stateCounts[old.state_abbr] || 0) - 1, 0);
          if (old.district) {
            const key = old.state_abbr + '|' + old.district.toLowerCase();
            districtCounts[key] = Math.max((districtCounts[key] || 0) - 1, 0);
          }
        }
      }
    }
    allVacancies.push(v);
    // Increment counts only if active
    if (isActive(v)) {
      if (v.location_scope === 'nationwide') { nationwideCount++; return true; }
      if (v.location_scope === 'multi_state') { multiStateCount++; return true; }
      if (v.state_abbr) {
        stateCounts[v.state_abbr] = (stateCounts[v.state_abbr] || 0) + 1;
        if (v.district) {
          const key = v.state_abbr + '|' + v.district.toLowerCase();
          districtCounts[key] = (districtCounts[key] || 0) + 1;
        }
      }
    }
    return true;
  }

  // ----- District geometry codes -----
  // State/UT abbreviation → st_code(s) used by geo/india-districts-all.geojson.
  // This is the ONLY resolver for district geometry; india-map-view.js calls
  // getDistrictCodes() for rendering and zoom. Values match the bundled
  // GeoJSON exactly (verified by tests/test_india_map.py::TestDistrictGeoContract):
  // Andhra Pradesh is 37 (not the pre-2014 28), and the merged
  // Dadra and Nagar Haveli and Daman and Diu has all three districts under 26.
  const ABBR_TO_DISTRICT_CODES = {
    JK:'01', HP:'02', PB:'03', CH:'04', UK:'05', HR:'06', DL:'07', RJ:'08',
    UP:'09', BR:'10', SK:'11', AR:'12', NL:'13', MN:'14', MZ:'15', TR:'16',
    ML:'17', AS:'18', WB:'19', JH:'20', OD:'21', CG:'22', MP:'23', GJ:'24',
    DNH:'26', MH:'27', KA:'29', GA:'30', LD:'31', KL:'32', TN:'33', PY:'34',
    AN:'35', TS:'36', AP:'37', LA:'38',
  };

  // Always returns a fresh array (never a bare string), so callers test
  // membership with Array#includes rather than substring matching.
  function getDistrictCodes(abbr) {
    const v = ABBR_TO_DISTRICT_CODES[abbr];
    if (!v) return [];
    return Array.isArray(v) ? v.slice() : [v];
  }

  // Testing helper: reset all internal state (not for production use)
  function reset() {
    allVacancies = [];
    stateCounts = {};
    districtCounts = {};
    nationwideCount = 0;
    multiStateCount = 0;
    source = 'none';
  }

  return {
    load, isActive,
    getStateCount, getStateCounts, getTotal, getSource, getAllVacancies,
    getNationwideCount, getMultiStateCount,
    getDistrictCounts, getDistrictCodes,
    getListingsForDistrict, getFiltered, normaliseVacancy, deriveCategory,
    recordNewVacancy, rpcDiagnostic, reset,
  };
})();
