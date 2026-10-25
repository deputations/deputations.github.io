import importlib.util
from pathlib import Path


path = Path(__file__).resolve().parents[1] / "scripts" / "snapshot_staleness.py"
spec = importlib.util.spec_from_file_location("snapshot_staleness", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_database_change_requires_rebuild():
    assert module.needs_rebuild("2026-10-25T12:00:00Z", "2026-10-25T11:58:37Z")


def test_equal_or_older_database_does_not_rebuild():
    assert not module.needs_rebuild("2026-10-25T11:58:37Z", "2026-10-25T11:58:37Z")
    assert not module.needs_rebuild("2026-10-25T11:00:00Z", "2026-10-25T11:58:37Z")


def test_force_rebuilds_daily_snapshot():
    assert module.needs_rebuild("2026-10-25T11:00:00Z", "2026-10-25T11:58:37Z", force=True)
