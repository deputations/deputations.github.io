"""Tests for scripts/build_tour_map.py — the pre-baked map geometry used by the
site tour (tour/tour-map.json).

Pure Python: no browser, no server.

Run:
    pytest tests/test_tour_map.py -v
"""
from __future__ import annotations

import json
import re
import runpy
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
BUILDER = REPO_ROOT / "scripts" / "build_tour_map.py"
STATES = REPO_ROOT / "geo" / "india-states.geojson"
DISTRICTS = REPO_ROOT / "geo" / "india-districts-all.geojson"
OUTPUT = REPO_ROOT / "tour" / "tour-map.json"

_NUM = re.compile(r"-?\d+(?:\.\d+)?")


@pytest.fixture(scope="module")
def out() -> dict:
    mod = runpy.run_path(str(BUILDER))
    return mod["build"](STATES, DISTRICTS, focus_state="Karnataka")


def _points(d: str) -> list[tuple[float, float]]:
    nums = [float(n) for n in _NUM.findall(d)]
    return list(zip(nums[0::2], nums[1::2]))


def test_states_complete(out):
    assert out["viewBox"] == "0 0 1000 800"
    assert len(out["states"]) == 36
    for s in out["states"]:
        assert s["abbr"], s
        assert s["name"], s
        assert s["d"].startswith("M"), s["name"]


def test_projection_matches_site(out):
    pts = [p for s in out["states"] for p in _points(s["d"])]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    # Same fit as india-map-view.js computeProjection(features, NATIONAL_FILL=0.97):
    # the drawing is centred on the 1000x800 canvas.
    assert abs((minx + maxx) / 2 - 500) < 1
    assert abs((miny + maxy) / 2 - 400) < 1
    # ...and the limiting axis spans exactly fill * canvas size.
    span_x, span_y = maxx - minx, maxy - miny
    assert abs(span_x - 970) < 1 or abs(span_y - 776) < 1


def test_focus_districts(out):
    f = out["focus"]
    assert f["state"] == "Karnataka"
    assert f["abbr"] == "KA"
    assert len(f["districts"]) == 31
    names = [d["name"] for d in f["districts"]]
    assert names.count(None) == 1
    assert "Bengaluru Urban" in names
    x, y, w, h = (float(v) for v in f["viewBox"].split())
    for d in f["districts"]:
        assert x <= d["cx"] <= x + w, d["name"]
        assert y <= d["cy"] <= y + h, d["name"]
        assert d["d"].startswith("M")


def test_file_size():
    assert OUTPUT.exists(), "run: python scripts/build_tour_map.py"
    assert OUTPUT.stat().st_size < 80_000
    data = json.loads(OUTPUT.read_text(encoding="utf-8"))
    assert len(data["states"]) == 36
