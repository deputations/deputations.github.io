// js/india-map/map-data-loader.js
// Unified data loader for the India Map page.
// Strategy: Supabase RPC first → bundled vacancies.json fallback.
// Both paths produce the same data shape consumed by map-provider.js.

// Note: config.js is loaded as a plain <script> before this module.
// It exposes: window.SUPABASE_URL, window.SUPABASE_ANON_KEY,
//             window.ensureSupabaseAvailable, window.SUPABASE_READY,
//             window.SUPABASE_AVAILABLE, window.supabase (optional)

// ====== STATE NAME → ABBR MAP ======
const STATE_ABBR_MAP = {
  'andhra pradesh': 'AP', 'arunachal pradesh': 'AR', 'assam': 'AS', 'bihar': 'BR',
  'chhattisgarh': 'CG', 'goa': 'GA', 'gujarat': 'GJ', 'haryana': 'HR',
  'himachal pradesh': 'HP', 'jammu and kashmir': 'JK', 'jharkhand': 'JH',
  'karnataka': 'KA', 'kerala': 'KL', 'madhya pradesh': 'MP', 'maharashtra': 'MH',
  'manipur': 'MN', 'meghalaya': 'ML', 'mizoram': 'MZ', 'nagaland': 'NL',
  'odisha': 'OD', 'punjab': 'PB', 'rajasthan': 'RJ', 'sikkim': 'SK',
  'tamil nadu': 'TN', 'telangana': 'TG', 'tripura': 'TR', 'uttar pradesh': 'UP',
  'uttarakhand': 'UK', 'west bengal': 'WB', 'delhi': 'DL', 'ladakh': 'LA',
  'andaman and nicobar': 'AN', 'chandigarh': 'CH', 'dadra and nagar haveli': 'DN',
  'daman and diu': 'DD', 'jammu & kashmir': 'JK', 'odissa': 'OD',
  'pondicherry': 'PY', 'puducherry': 'PY', 'delhi ncr': 'DL',
};

// ====== LAZY SUPABASE CLIENT ======
let supabaseClient = null;
async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  if (!window.SUPABASE_READY || !window.SUPABASE_READY()) return null;
  try {
    // Use the global supabase client if already initialised (e.g. by app.js),
    // otherwise create our own.
    if (window.supabase && typeof window.supabase.rpc === 'function') {
      supabaseClient = window.supabase;
    } else {
      // Dynamic import of the CDN build
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      supabaseClient = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
  } catch {
    supabaseClient = null;
  }
  return supabaseClient;
}

// ====== DATA SHAPE (what map-provider.js expects) ======
// {
//   nationalCount, nationwideCount, multiStateCount, unknownCount,
//   stateCounts: { MH: 42, DL: 28, ... },
//   districtCounts: { 'MH::Pune': 5, 'DL::New Delhi': 12, ... },
//   statewideListings: { MH: [...], DL: [...], ... },
//   districtListings: { 'DL::New Delhi': [...], ... },
//   filteredListings: [...],
//   totalListings: 798,
//   _source: 'supabase' | 'json'
// }

// ====== LOAD FROM SUPABASE ======
async function loadFromSupabase() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase not available');

  const [stateRows, bucketRows] = await Promise.all([
    supabase.rpc('get_map_state_counts', { p_central_only: false }),
    supabase.rpc('get_map_bucket_counts'),
  ]);

  if (stateRows.error) throw new Error(stateRows.error.message);
  if (bucketRows.error) throw new Error(bucketRows.error.message);

  const stateCounts = {};
  stateRows.data.forEach(r => { stateCounts[r.state_abbr] = r.active; });

  const nationwideCount = bucketRows.data?.[0]?.nationwide ?? 0;
  const multiStateCount = bucketRows.data?.[0]?.multi_state ?? 0;
  const districtCount = bucketRows.data?.[0]?.district ?? 0;

  return {
    nationalCount: districtCount,
    nationwideCount,
    multiStateCount,
    unknownCount: 0,
    stateCounts,
    districtCounts: {},
    statewideListings: {},     // populated on drill-down via get_map_state_listings
    districtListings: {},      // populated on drill-down via get_map_district_listings
    filteredListings: [],
    totalListings: districtCount + nationwideCount + multiStateCount,
    _source: 'supabase',
  };
}

// ====== FIELD NORMALISATION ======
// Supabase returns snake_case columns; the frontend was written against the
// TitleCase JSON shape used by mock-data.js. Convert each row once at the
// edge so the rest of the page can stay readable.
function normaliseVacancy(v) {
  const postType = (v.deputation_type || '').toLowerCase();
  const orgType = (v.organisation_type || '').toLowerCase();
  const status = (v.status || '').toLowerCase();
  const minExp = parseInt(v.min_years_experience || '0', 10);
  const level = (v.level_text || '').toLowerCase();

  // Derive category from organisation type
  let category = 'govt';
  if (orgType.includes('private') || orgType.includes('psce')) category = 'private';
  else if (orgType.includes('educational') || orgType.includes('university')) category = 'campus';
  else if (orgType.includes('intern') || orgType.includes('trainee')) category = 'internship';
  else if (orgType.includes('contract') || orgType.includes('manpower')) category = 'manpower';

  // Derive qualification from level
  let qualification = 'Graduate';
  if (level.includes('level-15') || level.includes('level-17')) qualification = 'Doctorate';
  else if (level.includes('level-14') || level.includes('level-13')) qualification = 'Post Graduate';
  else if (level.includes('level-12') || level.includes('level-11') || level.includes('level-10')) qualification = 'Graduate';
  else if (level.includes('level-8') || level.includes('level-9')) qualification = '12th Pass';
  else if (level.includes('level-4') || level.includes('level-5') || level.includes('level-6')) qualification = '10th Pass';

  // Derive experience from min years
  let experience = 'Any';
  if (minExp >= 10) experience = '5+ years';
  else if (minExp >= 5) experience = '3-5 years';
  else if (minExp >= 1) experience = '1-2 years';
  else if (minExp > 0) experience = 'Fresher';

  // Derive job type from deputation type
  let jobType = 'Full-time';
  if (postType.includes('contract') || postType.includes('fixed tenure')) jobType = 'Contract';
  else if (postType.includes('part')) jobType = 'Part-time';
  else if (postType.includes('temporary')) jobType = 'Temporary';

  // Derive job shift from post name or mode
  let jobShift = 'On-site';
  const postLower = (v.post_name || '').toLowerCase();
  const mode = (v.mode_of_application || '').toLowerCase();
  if (postLower.includes('remote') || mode.includes('online')) jobShift = 'Remote';
  else if (postLower.includes('hybrid') || mode.includes('hybrid')) jobShift = 'Hybrid';

  return {
    id:                 v.id || v.Vacancy_ID,
    Vacancy_ID:         v.vacancy_id ?? v.Vacancy_ID,
    Post_Name:          v.post_name ?? v.Post_Name,
    title:              v.post_name ?? v.Post_Name,
    Ministry:           v.ministry ?? v.Ministry,
    Organisation:       v.organisation ?? v.Organisation,
    Organisation_Type:  v.organisation_type ?? v.Organisation_Type,
    Location_City:      v.location_city ?? v.Location_City,
    Location_State:     v.location_state ?? v.Location_State,
    // Map state name to state_abbr if not already present
    state_abbr:         v.state_abbr || STATE_ABBR_MAP[(v.location_state || '').toLowerCase()] || '',
    state:              v.state_abbr ?? v.state,
    district:           v.district,
    location_scope:     v.location_scope,
    location_label:     v.location_label,
    level:              v.level ?? v.level_text,
    Level_Text:         v.level_text ?? v.Level_Text,
    No_of_Posts:        v.no_of_posts ?? v.No_of_Posts,
    posts:              v.no_of_posts ? parseInt(v.no_of_posts, 10) || 1 : 1,
    closingDate:        v.last_date_to_apply,
    Last_Date_To_Apply: v.last_date_to_apply ?? v.Last_Date_Apply,
    qualification,
    experience,
    category,
    jobType,
    jobTime: 'Day Shift',
    jobShift,
    active:             status === 'active' || status === '',
    Status:             v.status ?? v.Status,
    Deputation_Type:    v.deputation_type ?? v.Deputation_Type,
    Official_Notification_Link: v.official_notification_link,
    _raw: v,
  };
}

// ====== LOAD FROM JSON ======
async function loadFromJSON() {
  const resp = await fetch('data/vacancies.json', { cache: 'no-store' });
  if (!resp.ok) throw new Error(`vacancies.json fetch failed: ${resp.status}`);
  const vacancies = await resp.json();
  const entries = Array.isArray(vacancies) ? vacancies : Object.values(vacancies);

  const stateCounts = {};
  const districtCounts = {};
  const statewideListings = {};
  const districtListings = {};
  let nationalCount = 0;

  entries.forEach(v => {
    const nv = normaliseVacancy(v);
    if (nv.location_scope === 'nationwide') {
      nationalCount++;
      return;
    }
    if (v.location_scope === 'multi_state') {
      // Count in each listed state
      if (v.location_states) {
        v.location_states.forEach(st => {
          stateCounts[st] = (stateCounts[st] || 0) + 1;
          if (!statewideListings[st]) statewideListings[st] = [];
          statewideListings[st].push(v);
        });
      }
      return;
    }

    // district scope — use normalised state_abbr, not raw data
    const abbr = nv.state_abbr;
    const dist = nv.district;
    if (!abbr) return;

    stateCounts[abbr] = (stateCounts[abbr] || 0) + 1;
    if (!statewideListings[abbr]) statewideListings[abbr] = [];
    statewideListings[abbr].push(v);

    if (dist) {
      const dk = `${abbr}::${dist}`;
      districtCounts[dk] = (districtCounts[dk] || 0) + 1;
      if (!districtListings[dk]) districtListings[dk] = [];
      districtListings[dk].push(v);
    }
  });

  return {
    nationalCount,
    nationwideCount: entries.filter(v => normaliseVacancy(v).location_scope === 'nationwide').length,
    multiStateCount: entries.filter(v => normaliseVacancy(v).location_scope === 'multi_state').length,
    unknownCount: 0,
    stateCounts,
    districtCounts,
    statewideListings,
    districtListings,
    filteredListings: entries.map(normaliseVacancy),
    totalListings: entries.length,
    _source: 'json',
  };
}

// ====== PUBLIC API ======

/** Fetch all map data (counts + listings). */
export async function loadMapData() {
  // Probe Supabase availability first
  const available = await ensureSupabaseAvailable();
  if (available) {
    try {
      const data = await loadFromSupabase();
      return data;
    } catch (err) {
      console.warn('Supabase map data load failed, falling back to JSON:', err.message);
    }
  }
  // Fallback: bundled JSON
  console.info('Loading map data from bundled vacancies.json');
  return loadFromJSON();
}

/** Fetch listings for a specific state (drill-down). */
export async function loadStateListings(stateAbbr) {
  const available = await ensureSupabaseAvailable();
  if (available) {
    try {
      const { data, error } = await getSupabase()
        .rpc('get_map_state_listings', { p_state_abbr: stateAbbr });
      if (!error && data) return data;
    } catch (err) {
      console.warn('Supabase state listings failed, falling back:', err.message);
    }
  }
  // Fallback: from already-loaded JSON data
  return window.__mapData?.statewideListings?.[stateAbbr] || [];
}

/** Fetch listings for a specific district (drill-down). */
export async function loadDistrictListings(stateAbbr, districtName) {
  const available = await ensureSupabaseAvailable();
  if (available) {
    try {
      const { data, error } = await getSupabase()
        .rpc('get_map_district_listings', { p_state_abbr: stateAbbr, p_district: districtName });
      if (!error && data) return data;
    } catch (err) {
      console.warn('Supabase district listings failed, falling back:', err.message);
    }
  }
  // Fallback: from already-loaded JSON data
  const dk = `${stateAbbr}::${districtName}`;
  return window.__mapData?.districtListings?.[dk] || [];
}

/** Store loaded data globally so fallback drill-downs can use it. */
export function cacheMapData(data) {
  window.__mapData = data;
}
