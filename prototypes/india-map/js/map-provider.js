// js/map-provider.js — Data provider and aggregation layer
// Adapter boundary: replace getListings() to accept enriched vacancy records.

import { POPULATED_LISTINGS, SCENARIO, EXCHANGES, FILTERS, ZERO_STATE,
         NATIONWIDE_LISTINGS, UNKNOWN_LISTINGS, MULTI_STATE_LISTINGS } from '../fixtures/mock-data.js';
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
export function init(scenario_ = SCENARIO) {
  scenario = scenario_;
  if (scenario === 'empty') {
    listings = [];
  } else {
    // Deep-clone so provider owns its data
    listings = JSON.parse(JSON.stringify(POPULATED_LISTINGS));
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
  // Multi-state records count once per state they mention
  // Nationwide records → nationwideCount; unknown → unknownCount
  const stateCounts = {};
  const statewideListings = {};

  active.forEach(l => {
    if (l.state === 'All India') return; // handled by nationwideCount

    if (!l.state) {
      // Unknown state — counted in unknownCount only
      return;
    }

    const states = l.state.split(',').map(s => s.trim());
    states.forEach(st => {
      if (!stateCounts[st]) {
        stateCounts[st] = 0;
        statewideListings[st] = [];
      }
      stateCounts[st]++;
      statewideListings[st].push(l);
    });
  });

  // 6. District counts per state (using canonical district names)
  const districtCounts = {};
  active.forEach(l => {
    if (!l.state || l.state === 'All India' || !l.district) return;
    const states = l.state.split(',').map(s => s.trim());
    states.forEach(st => {
      const key = `${st}::${l.district}`;
      if (!districtCounts[key]) districtCounts[key] = 0;
      districtCounts[key]++;
    });
  });

  // 7. Special buckets
  const nationwideCount = active.filter(l => l.state === 'All India').length;
  const unknownCount = active.filter(l => !l.state).length;

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
  return data.statewideListings[stateAbbr] || [];
}

export function getListingsForDistrict(stateAbbr, districtName) {
  const data = getData();
  // Resolve the GeoJSON name for this district; if the GeoJSON combines
  // multiple fixture names (e.g. MH "Mumbai" = "Mumbai City" + "Mumbai Suburban"),
  // aggregate results from all fixture districts that map to the same GeoJSON feature.
  const geoName = fixtureDistrictToGeoJSON(stateAbbr, districtName);
  const expandedNames = new Set([districtName, geoName]);

  return data.filteredListings.filter(l => {
    if (!l.state || l.state === 'All India') return false;
    const states = l.state.split(',').map(s => s.trim());
    if (!states.includes(stateAbbr)) return false;
    if (!l.district) return false;
    // Match if the listing's district is the requested one OR maps to the same GeoJSON
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
