# Geometry and Data Provenance

## State and district boundaries

| Asset file | Source | Version / vintage | License | Transformations applied |
|------------|--------|-------------------|---------|------------------------|
| `geo/india-states.geojson` | DataMeet `maps` repository, [github.com/datameet/maps](https://github.com/datameet/maps) | Census 2011 boundaries (vintage varies by state; see column notes) | CC BY 4.0 (DataMeet default; individual files retain their original licence) | Simplified to ~10% of original vertex count using mapshaper `-simplify dp 10%`; coordinate system preserved (WGS84, EPSG:4326). State/district names standardised to current official names. |
| `geo/india-states-sarvalinks.geojson` | Same upstream as above (SarvaLinks-compatible variant). | Same vintage. | CC BY 4.0 | Renamed fields for compatibility; geometry unchanged from source. |
| `geo/MH.geojson` | Derived from DataMeet `maps` repository. | Census 2011. | CC BY 4.0 | Simplified. The single "Mumbai" district combines the Census 2011 "Mumbai City" and "Mumbai Suburban" districts — see `js/state-geo.js` alias map. |
| `geo/KA.geojson` | Derived from DataMeet `maps` repository. | Census 2011. | CC BY 4.0 | Simplified. District names updated to reflect 2014 renaming (Bangalore → Bengaluru). |

### Notes on vintage heterogeneity

The DataMeet source assets were digitised from Census of India maps. The underlying geometries reflect boundaries as of **2011 Census**. Some states carry update tags in their properties (`update2014`, `2016_c`, `2019`) reflecting later administrative adjustments. This prototype **does not** carry state-by-state vintage metadata. A production deployment should annotate each feature with its authoritative boundary date.

### Delhi

Delhi district boundaries in the source asset are **approximate rectangles** (the DataMeet file only encodes district centroids connected as convex hulls, not real boundaries). This is a known limitation of the source data, not a rendering error. The prototype currently displays Delhi at the national level only. District-level Delhi drill-down is deferred until real boundaries are available or a clearly labelled list fallback is implemented.

## Fidelity classification

| State/UT | Boundary fidelity | Notes |
|----------|-------------------|-------|
| All states (national view) | **Approximate** — usable for state-level browsing and counts | Simplified from Census 2011 |
| Maharashtra (district view) | **Approximate** — district-level geometry present | Mumbai City + Mumbai Suburban are aggregated into one "Mumbai" polygon |
| Karnataka (district view) | **Approximate** — district-level geometry present | Names updated to Bengaluru Urban |
| Delhi (district view) | **Not available** — centroid-only | See above; no district drill-down |

## Reuse and attribution

DataMeet's [data-license section](https://github.com/datameet/maps#data-license) states CC BY 4.0 unless otherwise specified. Attribution should be preserved in any derivative work. Coordinate data alone (OSM-derived) is not an automatic indicator of CC0 — the source geometry comes from DataMeet, which is CC BY 4.0.

## Mock fixture data

| File | Source | License |
|------|--------|---------|
| `fixtures/mock-data.js` | Synthesised for prototype testing | None (internal; do not distribute as open data) |

---

*Last updated: 2026-08 session.*
