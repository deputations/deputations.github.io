// js/map-provider.js — Data provider and aggregation layer
// This is the ADAPTER BOUNDARY. Later, replace getListings() to accept
// enriched vacancy records from app.js / enrich.js without changing map logic.

import { POPULATED_LISTINGS, SCENARIO, EXCHANGES, FILTERS, ZERO_STATE } from '../fixtures/mock-data.js';

// ====== STATE ======
let currentFilters = {
  exchange: 'all',
  qualification: 'Any',
  experience: 'Any',
  jobType: 'Any',
  jobTime: 'Any',
  jobShift: 'Any'
};

let listings = [];

// ====== INIT ======
export function init(scenario = SCENARIO) {
  if (scenario === 'empty') {
    listings = [];
  } else {
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
    exchange: 'all',
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
  // 1. Start with active listings only
  let filtered = listings.filter(l => l.active !== false);

  // 2. Apply exchange filter
  if (currentFilters.exchange !== 'all') {
    filtered = filtered.filter(l => l.category === currentFilters.exchange);
  }

  // 3. Apply other filters (intersection)
  if (currentFilters.qualification !== 'Any') {
    filtered = filtered.filter(l => l.qualification === currentFilters.qualification);
  }
  if (currentFilters.experience !== 'Any') {
    filtered = filtered.filter(l => l.experience === currentFilters.experience);
  }
  if (currentFilters.jobType !== 'Any') {
    filtered = filtered.filter(l => l.jobType === currentFilters.jobType);
  }
  if (currentFilters.jobTime !== 'Any') {
    filtered = filtered.filter(l => l.jobTime === currentFilters.jobTime);
  }
  if (currentFilters.jobShift !== 'Any') {
    filtered = filtered.filter(l => l.jobShift === currentFilters.jobShift);
  }

  const filteredIds = new Set(filtered.map(l => l.id));

  // 4. National count (distinct listings from filtered set)
  const nationalCount = filtered.length;

  // 5. Per-state counts from filtered set
  // Multi-state records count once per state they mention
  // Nationwide and unknown-location records are NOT counted in any state
  const stateCounts = {};
  const statewideListings = {};

  filtered.forEach(l => {
    if (!l.state || l.state === 'All India') return; // skip nationwide/unknown for state counts

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

  // 6. District counts per state
  const districtCounts = {};
  filtered.forEach(l => {
    if (!l.state || l.state === 'All India' || !l.district) return;
    const states = l.state.split(',').map(s => s.trim());
    states.forEach(st => {
      const key = `${st}::${l.district}`;
      if (!districtCounts[key]) districtCounts[key] = 0;
      districtCounts[key]++;
    });
  });

  // 7. Special buckets (already in filtered set, shown separately)
  const nationwideCount = filtered.filter(l => l.state === 'All India').length;
  const unknownCount = filtered.filter(l => !l.state).length;

  return {
    nationalCount,
    nationwideCount,
    unknownCount,
    stateCounts,
    districtCounts,
    statewideListings,
    filteredIds,
    filteredListings: filtered,
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
  return data.filteredListings.filter(l => {
    if (!l.state || l.state === 'All India') return false;
    const states = l.state.split(',').map(s => s.trim());
    if (!states.includes(stateAbbr)) return false;
    return l.district === districtName;
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
