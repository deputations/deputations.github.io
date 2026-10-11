"""Unit tests for scripts/location_defaults.py — the owner's rule for a
vacancy whose notification names no place (HANDOVER shq-2026-10-11-002)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from location_defaults import fill_missing_locations  # noqa: E402


def row(org="", city="", state="", link="", job="", notified="", **extra):
    return {"Organisation": org, "Location_City": city, "Location_State": state,
            "Official_Notification_Link": link, "Ingest_Job_ID": job,
            "Notification_Date": notified, **extra}


def place(r):
    return (r["Location_City"], r["Location_State"], r.get("Location_Assumed"))


def test_no_place_anywhere_goes_to_new_delhi():
    rows = [row(org="Cabinet Secretariat")]
    assert fill_missing_locations(rows) == {"default": 1}
    assert place(rows[0]) == ("New Delhi", "Delhi", "default")


def test_takes_the_place_of_the_same_notification():
    rows = [
        row(org="Chennai Metro Rail Limited", city="Chennai", state="Tamil Nadu", link="https://x/ad.pdf"),
        row(org="Chennai Metro Rail Limited", link="https://x/ad.pdf"),
    ]
    fill_missing_locations(rows)
    assert place(rows[1]) == ("Chennai", "Tamil Nadu", "notification")


def test_same_upload_organisation_and_date_count_as_one_notification():
    rows = [
        row(org="NIAM", city="Jaipur", state="Rajasthan", job="j1", notified="2026-06-13"),
        row(org="NIAM", job="j1", notified="2026-06-13"),
    ]
    fill_missing_locations(rows)
    assert place(rows[1]) == ("Jaipur", "Rajasthan", "notification")


def test_falls_back_to_the_organisations_one_place():
    rows = [
        row(org="Inland Waterways Authority of India (IWAI)", city="Noida", state="Uttar Pradesh", link="a"),
        row(org="inland waterways authority of india", link="b"),
    ]
    fill_missing_locations(rows)
    assert place(rows[1]) == ("Noida", "Uttar Pradesh", "organisation")


def test_disagreeing_places_are_not_guessed():
    rows = [
        row(org="BSF", city="Jodhpur", state="Rajasthan", link="a"),
        row(org="BSF", city="Shillong", state="Meghalaya", link="b"),
        row(org="BSF", link="c"),
        row(org="NCB", city="Mumbai", state="Maharashtra", link="d"),
        row(org="NCB", city="Kolkata", state="West Bengal", link="d"),
        row(org="NCB", link="d"),
    ]
    fill_missing_locations(rows)
    assert place(rows[2]) == ("New Delhi", "Delhi", "default")
    assert place(rows[5]) == ("New Delhi", "Delhi", "default")


def test_rows_naming_any_place_are_untouched():
    rows = [row(org="X", city="Pune"), row(org="Y", state="Kerala"), row(org="Z", city="Delhi", state="Delhi")]
    assert fill_missing_locations(rows) == {}
    assert [place(r) for r in rows] == [("Pune", "", None), ("", "Kerala", None), ("Delhi", "Delhi", None)]


def test_different_spellings_are_not_matched():
    rows = [
        row(org="CCS National Institute of Agricultural Marketing (CCS NIAM)", city="Jaipur", state="Rajasthan", link="a"),
        row(org="Chaudhary Charan Singh National Institute of Agricultural Marketing", link="b"),
    ]
    fill_missing_locations(rows)
    assert place(rows[1]) == ("New Delhi", "Delhi", "default")
