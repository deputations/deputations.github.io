"""Shared constants for the smoke suite.

**Keep these in sync with `config.js`.** A drift test in `test_constants_in_sync.py`
greps `config.js` in CI to catch drift; if you change `config.js`, change this file.
"""
from __future__ import annotations

from pathlib import Path

# Repo root, used by the static-serve fixture in conftest.py
REPO_ROOT: Path = Path(__file__).resolve().parents[2]

# Supabase project — mirrored from config.js lines 13-14
SUPA_HOST: str = "djaxutkmhazufsxeobal.supabase.co"
SUPA_URL: str = f"https://{SUPA_HOST}"

# Public anon key (safe-by-design, RLS-gated to status=eq.approved). Mirrored
# from config.js. The smoke stubs use it only to assert that the browser sent
# it; we never forward to Supabase.
ANON_KEY: str = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqYXh1dGttaGF6dWZzeGVvYmFsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMjgzNTksImV4cCI6MjA5NTcwNDM1OX0."
    "AHfWNpMS69KhxGX6Px1fS9dVddo9lUiXvc96hM5UTbU"
)

# Local static-serve port. Chosen not to collide with verify_admin.py (8771)
# or the local preview server in .claude/launch.json (8123).
TEST_PORT: int = 8780
