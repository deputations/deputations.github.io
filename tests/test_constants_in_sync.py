"""Drift guard: fixtures/constants.py must mirror config.js.

`tests/fixtures/constants.py` ships a copy of SUPA_HOST and ANON_KEY because
the static-serve fixture in conftest.py needs them at import time (before any
DOM is available). If they drift from the live `config.js`, every smoke test
sends stubs to a Supabase project the browser never calls — and the stubs
silently no-op against a real bug (new host, new anon key).

This test parses `config.js` and asserts SUPA_URL/ANON_KEY match.
"""
from __future__ import annotations

import re

from tests.fixtures.constants import ANON_KEY, REPO_ROOT, SUPA_URL


def _read_config_js() -> str:
    """Load `config.js` from repo root — its location is fixed."""
    return (REPO_ROOT / "config.js").read_text(encoding="utf-8")


def _extract(pattern: str, source: str, *, label: str, expected: str) -> None:
    """Grep `pattern` (one group) out of `source`, assert it equals `expected`."""
    m = re.search(pattern, source)
    assert m, f"could not find {label!r} in config.js — regex needs an update?"
    got = m.group(1)
    if got != expected:
        # Keep the diff short — anon keys are 200+ chars.
        snippet = (got[:32] + "..." + got[-32:]) if len(got) > 80 else got
        same_exp = (expected[:32] + "..." + expected[-32:]) if len(expected) > 80 else expected
        raise AssertionError(
            f"{label} drifted between config.js and tests/fixtures/constants.py\n"
            f"  config.js : {snippet}\n"
            f"  constants : {same_exp}"
        )


def test_supa_url_matches_config_js():
    """SUPA_URL mirrors `window.SUPABASE_URL = "https://...supabase.co"`."""
    _extract(
        r'window\.SUPABASE_URL\s*=\s*"([^"]+)"',
        _read_config_js(),
        label="SUPABASE_URL",
        expected=SUPA_URL,
    )


def test_anon_key_matches_config_js():
    """ANON_KEY mirrors `window.SUPABASE_ANON_KEY = "eyJ..."`."""
    _extract(
        r'window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"',
        _read_config_js(),
        label="SUPABASE_ANON_KEY",
        expected=ANON_KEY,
    )
