// js/state-geo.js — State/UT name ↔ abbreviation mapping
// SarvaLinks-compatible abbreviations (36 entries)

export const STATE_ABBR = {
  "Andaman and Nicobar": "AN",
  "Andhra Pradesh": "AP",
  "Arunachal Pradesh": "AR",
  "Assam": "AS",
  "Bihar": "BR",
  "Chandigarh": "CH",
  "Chhattisgarh": "CG",
  "Dadra and Nagar Haveli and Daman and Diu": "DNH-&-DD",
  "Dadra and Nagar Haveli": "DNH-&-DD",
  "Daman and Diu": "DNH-&-DD",
  "Delhi": "DL",
  "Goa": "GA",
  "Gujarat": "GJ",
  "Haryana": "HR",
  "Himachal Pradesh": "HP",
  "Jammu and Kashmir": "JK",
  "Jharkhand": "JH",
  "Karnataka": "KA",
  "Kerala": "KL",
  "Lakshadweep": "LD",
  "Ladakh": "LA",
  "Madhya Pradesh": "MP",
  "Maharashtra": "MH",
  "Manipur": "MN",
  "Meghalaya": "ML",
  "Mizoram": "MZ",
  "Nagaland": "NL",
  "Odisha": "OD",
  "Orissa": "OD",
  "Puducherry": "PY",
  "Punjab": "PB",
  "Rajasthan": "RJ",
  "Sikkim": "SK",
  "Tamil Nadu": "TN",
  "Telangana": "TS",
  "Tripura": "TR",
  "Uttar Pradesh": "UP",
  "Uttarakhand": "UK",
  "Uttaranchal": "UK",
  "West Bengal": "WB"
};

export const ABBR_TO_NAME = {};
for (const [name, abbr] of Object.entries(STATE_ABBR)) {
  if (!ABBR_TO_NAME[abbr]) ABBR_TO_NAME[abbr] = name;
}

export const STATE_LIST = Object.keys(STATE_ABBR).sort();

// ====== DISTRICT ALIASES ======
// Map state abbreviation → (canonical name in GeoJSON ↔ fixture aliases).
// The MH.geojson bundle uses the historic "Mumbai" (not Mumbai City / Mumbai Suburban).
// The KA.geojson uses "Bengaluru Urban" (renamed in 2014 from Bangalore Urban).
//
// We canonicalize via this map: when the renderer encounters the GeoJSON's
// "Mumbai" feature, it rewrites district name to match whichever Mumbai fixture
// would be most likely.  Since both Mumbai City and Mumbai Suburban listings
// exist in the fixture, we surface them as separate items under the same polygon.
//
// Strategy: each alias key represents a *fixture* district name.  We map
// from each fixture name to a single canonical GeoJSON district name.  When
// the GeoJSON side says "Mumbai", we expose two virtual districts by
// post-splitting the geometry — but that's complex.  Instead, the
// DISTICT_ALIASES_FROM_GEOJSON map tells the renderer to create ONE extra
// virtual feature for each aliased fixture so they can still be clickable.
//
// In practice: the renderer uses GEOJSON_TO_CANONICAL (GeoJSON name → primary
// fixture name) for matching, and CANONICAL_TO_FIXTURES (canonical name →
// list of fixture names) for routing clicks.  We render ONE geometry
// (the GeoJSON polygon) but expose both district names as overlays.

export const GEOJSON_TO_CANONICAL = {
  // MH.geojson uses "Mumbai" (combines Mumbai City + Mumbai Suburban)
  MH: { "Mumbai": "Mumbai" },
  // KA.geojson uses "Bengaluru Urban" (renamed)
  KA: { "Bangalore Urban": "Bengaluru Urban" }
};

export const CANONICAL_TO_FIXTURES = {
  MH: {
    "Mumbai": ["Mumbai City", "Mumbai Suburban"]
  },
  KA: {
    "Bengaluru Urban": ["Bangalore Urban"]
  }
};

// Alias from fixture name to GeoJSON name
export const DISTRICT_ALIASES = {};
for (const [stateAbbr, m] of Object.entries(GEOJSON_TO_CANONICAL)) {
  DISTRICT_ALIASES[stateAbbr] = {};
  for (const [geoName, canonical] of Object.entries(m)) {
    for (const fixtureName of (CANONICAL_TO_FIXTURES[stateAbbr]?.[canonical] || [canonical])) {
      // We render geometry with its GeoJSON name, but when querying
      // fixture counts we use the GeoJSON name (canonical)
      DISTRICT_ALIASES[stateAbbr][geoName] = canonical;
    }
  }
  // Also: the fixture-side alias: when looking up "Mumbai City" fixture count
  // we need to know the GeoJSON name.  So we expose a reverse-lookup table.
}
