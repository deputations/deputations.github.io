"""Ledger alias-bridge tests: a 0027 rename must not make a row re-post.

These exercise admin/whatsapp/whatsapp_feed.py's posted_keys() with a fake
alias file + ledger — no browser, no network, no Supabase.
"""
import json
from pathlib import Path

import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "admin" / "whatsapp")]

import whatsapp_feed  # noqa: E402


def test_posted_keys_bridges_renamed_composite_key(monkeypatch, tmp_path):
    alias_file = tmp_path / "vacancy-aliases.json"
    alias_file.write_text(json.dumps({"schema": 1, "aliases": {
        "AUTO-2d86cef2-136": "DONER-2026-L10-004"}}), encoding="utf-8")
    monkeypatch.setattr(whatsapp_feed, "ALIAS_FILE", alias_file)

    ledger = {"posted": {"AUTO-2d86cef2-136|2026-10-13|UDC": {"posted_at": "t"}}}
    keys = whatsapp_feed.posted_keys(ledger)
    # old key survives, and the new key is bridged in too
    assert "AUTO-2d86cef2-136|2026-10-13|UDC" in keys
    assert "DONER-2026-L10-004|2026-10-13|UDC" in keys


def test_posted_keys_identity_when_alias_file_absent(monkeypatch, tmp_path):
    monkeypatch.setattr(whatsapp_feed, "ALIAS_FILE", tmp_path / "missing.json")
    ledger = {"posted": {"abc|2026-01-01|Post"}}
    assert whatsapp_feed.posted_keys(ledger) == {"abc|2026-01-01|Post"}


def test_posted_keys_ignores_uuid_and_malformed_entries(monkeypatch, tmp_path):
    alias_file = tmp_path / "vacancy-aliases.json"
    alias_file.write_text(json.dumps({"aliases": {"abc": "xyz"}}), encoding="utf-8")
    monkeypatch.setattr(whatsapp_feed, "ALIAS_FILE", alias_file)

    ledger = {"posted": {
        "abc|2026-01-01|Post",     # composite, aliased -> bridged
        "deadbeef-uuid",           # supabase-source key: never bridged
        "only-two-parts",          # malformed: skipped
    }}
    keys = whatsapp_feed.posted_keys(ledger)
    assert "xyz|2026-01-01|Post" in keys
    assert "deadbeef-uuid" in keys
    assert "only-two-parts" in keys
    assert "deadbeef-xyz" not in keys
