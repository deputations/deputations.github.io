// js/map-provider.js — Data provider and aggregation layer
// Adapter boundary: replace getListings() to accept enriched vacancy records.

import { POPULATED_LISTINGS, SCENARIO, EXCHANGES, FILTERS, ZERO_STATE,
         NATIONWIDE_LISTINGS, UNKNOWN_LISTINGS, MULTI_STATE_LISTINGS } from './mock-data.js';
import { fixtureDistrictToGeoJSON } from './state-geo.js';

// ====== STATE ======
let currentFilters = {
  category: 'Any',
  qualification: 'Any',
  experience: 'Any',
  jobType: 'Any',
  jobTime: 'Any',
  jobShift: 'Any'
};

let listings = [];
let scenario = 'populated';

// ====== INIT ======
// If preLoadedData is provided (from map-data-loader.js), use it directly.
// Otherwise fall back to mock data for development/testing.
export function init(scenario_ = SCENARIO, preLoadedData = null) {
  scenario = scenario_;
  if (preLoadedData) {
    // Use real data from Supabase or JSON
    listings = preLoadedData.filteredListings || [];
  } else if (scenario === 'empty') {
    listings = [];
  } else {
    // Deep-clone so provider owns its data; include edge-case fixtures
    listings = [
      ...JSON.parse(JSON.stringify(POPULATED_LISTINGS)),
      ...JSON.parse(JSON.stringify(MULTI_STATE_LISTINGS)),
      ...JSON.parse(JSON.stringify(NATIONWIDE_LISTINGS)),
      ...JSON.parse(JSON.stringify(UNKNOWN_LISTINGS))
    ];
  }
  return getData();
}

// ====== FILTERING ======
export function setFilter(key, value) {
  currentFilters[key] = value;
  return getData();
}

export function clearFilters() {
  currentFilters = {
    category: 'Any',
    qualification: 'Any',
    experience: 'Any',
    jobType: 'Any',
    jobTime: 'Any',
    jobShift: 'Any'
  };
  return getData();
}

export function getFilters() {
  return { ...currentFilters };
}

// ====== AGGREGATION ======
export function getData() {
  // 1. Start with active listings only, deduplicated by id
  const seenIds = new Set();
  let active = listings.filter(l => {
    if (l.active === false) return false;
    if (seenIds.has(l.id)) return false;
    seenIds.add(l.id);
    return true;
  });

  // 2. Apply category filter (replaces old "exchange" filter)
  if (currentFilters.category !== 'Any') {
    active = active.filter(l => l.category === currentFilters.category);
  }

  // 3. Apply other filters (intersection)
  if (currentFilters.qualification !== 'Any') {
    active = active.filter(l => l.qualification === currentFilters.qualification);
  }
  if (currentFilters.experience !== 'Any') {
    active = active.filter(l => l.experience === currentFilters.experience);
  }
  if (currentFilters.jobType !== 'Any') {
    active = active.filter(l => l.jobType === currentFilters.jobType);
  }
  if (currentFilters.jobTime !== 'Any') {
    active = active.filter(l => l.jobTime === currentFilters.jobTime);
  }
  if (currentFilters.jobShift !== 'Any') {
    active = active.filter(l => l.jobShift === currentFilters.jobShift);
  }

  const filteredIds = new Set(active.map(l => l.id));

  // 4. National count = distinct filtered listings (not posts)
  const nationalCount = active.length;

  // 5. Per-state counts from filtered set
  // Uses enriched state_abbr + location_scope fields
  const stateCounts = {};
  const statewideListings = {};

  active.forEach(l => {
    const abbr = l.state_abbr;
    if (!abbr) return; // nationwide / multi-state handled below
    if (!stateCounts[abbr]) {
      stateCounts[abbr] = 0;
      statewideListings[abbr] = [];
    }
    stateCounts[abbr]++;
    statewideListings[abbr].push(l);
  });

  // 6. District counts per state (using enriched district field)
  const districtCounts = {};
  active.forEach(l => {
    const abbr = l.state_abbr;
    const dist = l.district;
    if (!abbr || !dist) return;
    const key = `${abbr}::${dist}`;
    if (!districtCounts[key]) districtCounts[key] = 0;
    districtCounts[key]++;
  });

  // 7. Special buckets (using location_scope)
  const nationwideCount = active.filter(l => l.location_scope === 'nationwide').length;
  const multiStateCount = active.filter(l => l.location_scope === 'multi_state').length;

  return {
    nationalCount,
    nationwideCount,
    unknownCount,
    stateCounts,
    districtCounts,
    statewideListings,
    filteredIds,
    filteredListings: active,
    totalListings: listings.filter(l => l.active).length
  };
}

// ====== GET FILTERED LISTINGS FOR A REGION ======
export function getListingsForState(stateAbbr) {
  const data = getData();
  return data.statewideListings?.[stateAbbr] || [];
}

export async function getListingsForDistrict(stateAbbr, districtName) {
  const data = getData();
  // 1. Try Supabase RPC first (live data)
  try {
    if (window.SUPABASE_AVAILABLE !== false && window.ensureSupabaseAvailable) {
      const ok = await window.ensureSupabaseAvailable();
      if (ok && window.supabase?.rpc) {
        const { data: rows, error } = await window.supabase.rpc('get_map_district_listings', {
          p_state_abbr: stateAbbr,
          p_district: districtName,
        });
        if (!error && rows && rows.length) return rows;
      }
    }
  } catch {
    // fall through to local
  }

  // 2. Local fallback from cached JSON data
  const geoName = fixtureDistrictToGeoJSON(stateAbbr, districtName);
  const expandedNames = new Set([districtName, geoName]);

  return (data.filteredListings || []).filter(l => {
    if (l.location_scope === 'nationwide' || l.location_scope === 'multi_state') return false;
    if (l.state_abbr !== stateAbbr) return false;
    if (!l.district) return false;
    return expandedNames.has(l.district) || fixtureDistrictToGeoJSON(stateAbbr, l.district) === geoName;
  });
}

// ====== FUNCTION CATEGORY COUNTS ======
export function getFunctionCounts(stateAbbr, districtName) {
  let pool;
  if (districtName) {
    pool = getListingsForDistrict(stateAbbr, districtName);
  } else if (stateAbbr) {
    pool = getListingsForState(stateAbbr);
  } else {
    const data = getData();
    pool = data.filteredListings;
  }

  const counts = {};
  pool.forEach(l => {
    if (l.function) {
      counts[l.function] = (counts[l.function] || 0) + 1;
    }
  });
  return counts;
}
