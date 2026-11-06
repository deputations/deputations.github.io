#!/usr/bin/env python3
"""Pre-bake the India map geometry used by the site tour.

Reads geo/india-states.geojson and geo/india-districts-all.geojson and writes
tour/tour-map.json: every state as a simplified SVG path on the same 1000x800
canvas the India Map page draws (india-map-view.js computeProjection with
NATIONAL_FILL = 0.97), plus one focus state's districts in that SAME national
coordinate space, so the tour camera can dive into the state without a cut.

The tour never downloads the 1.2 MB districts file; this output stays small.
Re-run only when the geojson changes:

    python scripts/build_tour_map.py
"""
from __future__ import annotations

import json
import math
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
STATES_PATH = REPO_ROOT / "geo" / "india-states.geojson"
DISTRICTS_PATH = REPO_ROOT / "geo" / "india-districts-all.geojson"
OUTPUT_PATH = REPO_ROOT / "tour" / "tour-map.json"

MAP_W, MAP_H = 1000, 800
NATIONAL_FILL = 0.97          # india-map-view.js NATIONAL_FILL
STATE_TOLERANCE = 0.8         # Douglas-Peucker tolerance, canvas units
DISTRICT_TOLERANCE = 0.12
STATE_DECIMALS = 1
DISTRICT_DECIMALS = 2
FOCUS_PAD = 0.04              # padding around the focus state's bbox


# --- geometry helpers (mirror india-map-view.js) -------------------------

def _has_real_extent(ring) -> bool:
    """india-map-view.js hasRealExtent: drop slivers."""
    lons = [c[0] for c in ring]
    lats = [c[1] for c in ring]
    return (max(lons) - min(lons)) > 0.005 and (max(lats) - min(lats)) > 0.005


def _valid_rings(geom) -> list:
    if not geom:
        return []
    if geom["type"] == "Polygon":
        return [r for r in geom["coordinates"] if _has_real_extent(r)]
    if geom["type"] == "MultiPolygon":
        return [r for poly in geom["coordinates"] for r in poly if _has_real_extent(r)]
    return []


def _fit_projection(features) -> dict:
    """india-map-view.js computeProjection(features, fill)."""
    lons, lats = [], []
    for f in features:
        for ring in _valid_rings(f.get("geometry")):
            for lon, lat, *_ in ring:
                lons.append(lon)
                lats.append(lat)
    if lons:
        min_lon, max_lon, min_lat, max_lat = min(lons), max(lons), min(lats), max(lats)
    else:
        min_lon, max_lon, min_lat, max_lat = 68, 97, 6, 37
    lon_range = (max_lon - min_lon) or 1
    lat_range = (max_lat - min_lat) or 1
    scale = min(MAP_W / lon_range, MAP_H / lat_range) * NATIONAL_FILL
    return {
        "min_lon": min_lon,
        "min_lat": min_lat,
        "scale": scale,
        "offset_x": (MAP_W - lon_range * scale) / 2,
        "offset_y": MAP_H - (MAP_H - lat_range * scale) / 2,
    }


def _project(p: dict, lon: float, lat: float) -> tuple[float, float]:
    return ((lon - p["min_lon"]) * p["scale"] + p["offset_x"],
            p["offset_y"] - (lat - p["min_lat"]) * p["scale"])


def _perp_dist(pt, a, b) -> float:
    (x, y), (x1, y1), (x2, y2) = pt, a, b
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))


def _simplify(points: list, tol: float) -> list:
    """Iterative Douglas-Peucker."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i, j = stack.pop()
        best, idx = 0.0, -1
        for k in range(i + 1, j):
            dist = _perp_dist(points[k], points[i], points[j])
            if dist > best:
                best, idx = dist, k
        if idx != -1 and best > tol:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [pt for pt, k in zip(points, keep) if k]


def _ring_area_centroid(pts: list) -> tuple[float, float, float]:
    """Signed-area polygon centroid; falls back to the vertex mean."""
    a = cx = cy = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    a /= 2
    if abs(a) < 1e-9:
        return 0.0, sum(p[0] for p in pts) / n, sum(p[1] for p in pts) / n
    return abs(a), cx / (6 * a), cy / (6 * a)


def _shape(geom, proj: dict, tol: float, decimals: int) -> dict | None:
    """Projected, simplified SVG path + centroid of the largest ring."""
    rings = []
    for ring in _valid_rings(geom):
        pts = [_project(proj, c[0], c[1]) for c in ring]
        pts = _simplify(pts, tol)
        if len(pts) >= 3:
            rings.append(pts)
    if not rings:
        return None
    fmt = f"{{:.{decimals}f}}"
    parts = []
    for pts in rings:
        coords = [f"{fmt.format(x)},{fmt.format(y)}" for x, y in pts]
        parts.append("M" + coords[0] + "L" + "L".join(coords[1:]) + "Z")
    biggest = max((_ring_area_centroid(pts) for pts in rings), key=lambda t: t[0])
    _, cx, cy = biggest
    return {"d": "".join(parts), "cx": round(cx, decimals), "cy": round(cy, decimals),
            "points": [p for pts in rings for p in pts]}


# --- build -----------------------------------------------------------------

def build(states_path: Path, districts_path: Path, focus_state: str = "Karnataka") -> dict:
    states_fc = json.loads(Path(states_path).read_text(encoding="utf-8"))
    districts_fc = json.loads(Path(districts_path).read_text(encoding="utf-8"))
    proj = _fit_projection(states_fc["features"])

    states, focus_abbr, focus_points = [], None, []
    for f in states_fc["features"]:
        props = f.get("properties") or {}
        shape = _shape(f.get("geometry"), proj, STATE_TOLERANCE, STATE_DECIMALS)
        if not shape:
            continue
        name, abbr = props.get("NAME_1"), props.get("abbr")
        states.append({"abbr": abbr, "name": name, "d": shape["d"],
                       "cx": shape["cx"], "cy": shape["cy"]})
        if name == focus_state:
            focus_abbr, focus_points = abbr, shape["points"]

    if not focus_points:
        raise SystemExit(f"focus state {focus_state!r} not found in {states_path}")

    districts = []
    for f in districts_fc["features"]:
        props = f.get("properties") or {}
        if props.get("st_nm") != focus_state:
            continue
        shape = _shape(f.get("geometry"), proj, DISTRICT_TOLERANCE, DISTRICT_DECIMALS)
        if not shape:
            continue
        districts.append({"name": props.get("district"), "d": shape["d"],
                          "cx": shape["cx"], "cy": shape["cy"]})

    xs = [p[0] for p in focus_points]
    ys = [p[1] for p in focus_points]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    pad = max(w, h) * FOCUS_PAD
    view = [min(xs) - pad, min(ys) - pad, w + 2 * pad, h + 2 * pad]

    return {
        "viewBox": f"0 0 {MAP_W} {MAP_H}",
        "states": states,
        "focus": {
            "state": focus_state,
            "abbr": focus_abbr,
            "viewBox": " ".join(f"{v:.1f}" for v in view),
            "districts": districts,
        },
    }


def main() -> None:
    data = build(STATES_PATH, DISTRICTS_PATH)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False),
                           encoding="utf-8")
    size = OUTPUT_PATH.stat().st_size
    print(f"wrote {OUTPUT_PATH.relative_to(REPO_ROOT)}: {len(data['states'])} states, "
          f"{len(data['focus']['districts'])} {data['focus']['state']} districts, {size:,} bytes")


if __name__ == "__main__":
    main()
