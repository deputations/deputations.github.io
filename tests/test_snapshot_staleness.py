import gzip
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import chdir, contextmanager, redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import build_data
import public_snapshots
import snapshot_source
import snapshot_staleness


STAMP = "2026-11-22T18:00:36.123456Z"


def vacancy(i, status="approved"):
    return {"id": str(i), "vacancy_id": f"V-{i}", "updated_at": STAMP, "created_at": STAMP,
            "post_name": "Officer", "status": status, "location_city": "Delhi"}


class FakeRest:
    def __init__(self):
        self.rows = [vacancy(i) for i in range(4)]
        self.aliases = [{"old_id": "old", "new_id": "V-1"}]
        self.selects = []

    def __call__(self, req, timeout):
        parsed = urlsplit(req.full_url)
        query = parse_qs(parsed.query)
        columns = query["select"][0].split(",")
        self.selects.append(columns)
        if parsed.path.endswith("/vacancies"):
            assert query["status"] == ["eq.approved"] and query["order"] == ["id.asc"]
            rows = sorted((r for r in self.rows if r["status"] == "approved"), key=lambda r: r["id"])
        else:
            assert parsed.path.endswith("/vacancy_id_aliases") and query["order"] == ["old_id.asc"]
            rows = sorted(self.aliases, key=lambda r: r["old_id"])
        start, limit = int(query["offset"][0]), int(query["limit"][0])
        page = [{k: row.get(k) for k in columns} for row in rows[start:start + limit]]
        response = io.BytesIO(gzip.compress(json.dumps(page).encode()))
        response.headers = {"Content-Encoding": "gzip", "Content-Range": f"*/{len(rows)}"}
        return response


class FreshnessTests(unittest.TestCase):
    def setUp(self):
        root = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(chdir(root))
        self.enterContext(redirect_stdout(io.StringIO()))
        self.enterContext(patch.object(snapshot_staleness, "META", Path("data/meta.json")))
        self.enterContext(patch.object(snapshot_source, "ALIAS_FILE", Path("data/vacancy-aliases.json")))
        self.enterContext(patch.dict(os.environ, {"SUPABASE_URL": "https://example.invalid",
            "SUPABASE_SERVICE_ROLE_KEY": "test-only", "GITHUB_OUTPUT": "out", "FORCE_BUILD": "false"}))
        self.db = FakeRest()
        self.enterContext(patch("urllib.request.urlopen", side_effect=self.db))
        self.build = build_data.main

    def stale(self, forced=False):
        Path("out").write_text("")
        with patch.dict(os.environ, {"FORCE_BUILD": str(forced)}):
            snapshot_staleness.main()
        return Path("out").read_text().strip() == "changed=true"

    def test_bootstrap_then_ignore_newer_draft_and_rejected(self):
        self.assertTrue(self.stale())
        self.assertEqual(self.db.selects, [])
        self.build()
        self.db.rows.extend(dict(vacancy(i, status), updated_at="2026-11-24T03:40:30.72498Z")
                            for i, status in [(4, "draft"), (5, "rejected")])
        self.db.selects.clear()
        self.assertFalse(self.stale())
        self.assertEqual(self.db.selects, [list(snapshot_source.REVISION_COLUMNS), ["old_id", "new_id"]])
        self.assertEqual(json.loads(Path("data/meta.json").read_text())["vacancies_updated_at_utc"], STAMP)

    def test_same_second_edit_on_nonmaximum_row_then_stable(self):
        self.db.rows[0]["updated_at"] = "2026-11-22T18:00:36.123454Z"
        self.build()
        self.db.rows[0].update(updated_at="2026-11-22T18:00:36.123455Z", post_name="Director")
        self.assertTrue(self.stale())
        self.build()
        self.assertFalse(self.stale())
        self.assertIn("Director", Path("data/vacancies.json").read_text())
        self.db.rows[0]["updated_at"] = "2026-11-22T23:30:36.123455+05:30"
        self.assertFalse(self.stale())

    def test_removal_status_transitions_and_same_count_replacement(self):
        self.build()
        self.db.rows[-1]["status"] = "draft"
        self.assertTrue(self.stale())
        self.db.rows.append(vacancy(10))  # same count and max as the original
        self.assertTrue(self.stale())
        self.build()
        self.db.rows[-2]["status"] = "approved"
        self.assertTrue(self.stale())
        self.build()
        self.db.rows.pop(0)
        self.assertTrue(self.stale())

    def test_primary_key_public_id_and_alias_only_edits(self):
        self.build()
        self.db.rows[0]["id"] = "replacement"
        self.assertTrue(self.stale())
        self.build()
        self.db.rows[0]["vacancy_id"] = "renamed"
        self.assertTrue(self.stale())
        self.db.aliases.append({"old_id": "V-0", "new_id": "renamed"})
        self.build()
        self.assertFalse(self.stale())
        self.db.aliases[0]["new_id"] = "renamed"
        self.assertTrue(self.stale())
        self.build()
        self.assertEqual(json.loads(Path("data/vacancy-aliases.json").read_text())["aliases"]["old"], "renamed")

    def test_full_forced_run_is_byte_stable_and_reclassifies_deadline(self):
        start = datetime(2026, 11, 25, 4, 34, tzinfo=timezone.utc)
        self.db.rows[0]["last_date_to_apply"] = start.date().isoformat()

        @contextmanager
        def clock(instant):
            class Clock(datetime):
                @classmethod
                def now(cls, tz=None):
                    return instant.astimezone(tz)
            with patch.object(public_snapshots, "datetime", Clock), patch.object(build_data, "datetime", Clock):
                yield

        with clock(start):
            self.build()

        def artifacts():
            return {p: p.read_bytes() for p in [*Path("data").rglob("*.json"), Path("feed.xml")]}
        before = artifacts()
        self.db.selects.clear()
        self.assertTrue(self.stale(forced=True))
        self.assertEqual(self.db.selects, [])
        # Simulate a later build clock within the same deadline day.
        previous = json.loads(Path("data/vacancies-manifest.json").read_text())
        with clock(start + timedelta(hours=1)):
            self.build()
        self.assertEqual(artifacts(), before)
        with clock(start + timedelta(days=1)):
            self.build()
        manifest = json.loads(Path("data/vacancies-manifest.json").read_text())
        self.assertNotEqual(manifest["version"], previous["version"])
        self.assertIn("V-0", manifest["index"])
        self.assertNotIn("V-0", previous["index"])

    def test_mid_export_edit_refuses_publication(self):
        self.build()
        old = Path("data/vacancies-manifest.json").read_bytes()
        original = build_data.live_digest
        def edited(url, key):
            self.db.rows[0]["updated_at"] = "2026-11-22T18:00:36.123457Z"
            return original(url, key)
        with patch.object(build_data, "live_digest", side_effect=edited):
            with self.assertRaisesRegex(RuntimeError, "changed during export"):
                self.build()
        self.assertEqual(Path("data/vacancies-manifest.json").read_bytes(), old)
        self.assertTrue(self.stale())

    def test_second_page_change_and_zero_rows(self):
        self.db.rows = [vacancy(i) for i in range(1001)]
        first = snapshot_source.live_digest("https://example.invalid", "test")
        self.assertEqual(len(self.db.selects), 3)
        self.db.rows[999]["vacancy_id"] = "zz"  # last in id.asc string order
        self.assertNotEqual(snapshot_source.live_digest("https://example.invalid", "test"), first)
        self.db.rows.clear()
        with self.assertRaisesRegex(RuntimeError, "Zero-row"):
            self.build()

    def test_missing_alias_table_preserves_published_redirects(self):
        def missing(*args, **kwargs):
            raise HTTPError("https://example.invalid", 404, "missing", {},
                            io.BytesIO(b'{"code":"PGRST205"}'))
        with patch("urllib.request.urlopen", side_effect=missing):
            self.assertEqual(snapshot_source.fetch_vacancy_id_aliases("https://example.invalid", "test"), {})
        self.build()
        before = Path("data/vacancy-aliases.json").read_bytes()
        with patch("urllib.request.urlopen", side_effect=missing), self.assertRaises(HTTPError):
            snapshot_source.fetch_vacancy_id_aliases("https://example.invalid", "test")
        self.assertEqual(Path("data/vacancy-aliases.json").read_bytes(), before)
