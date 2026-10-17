"""Failure-path tests: publication must never destroy the last good pointer."""
import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
import gzip
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import public_snapshots as snapshots


class SnapshotTests(unittest.TestCase):
    def rows(self):
        return [dict(Vacancy_ID='active', Post_Name='Officer', Last_Date_To_Apply='2026-10-17',
                     reviewer_notes='private', raw_extraction={'secret': 'private'}),
                dict(Vacancy_ID='expired', Post_Name='Engineer', Last_Date_To_Apply='2026-10-16'),
                dict(Vacancy_ID='unknown', Post_Name='Director', Last_Date_To_Apply='')]

    def test_contract_partitions_checksums_and_preserves_old_artifacts(self):
        with tempfile.TemporaryDirectory() as root:
            m = snapshots.publish(self.rows(), root, today=date(2026, 10, 17))
            for d in [m['current'], *m['archive'].values()]:
                body = (Path(root) / d['path']).read_bytes()
                self.assertEqual(hashlib.sha256(body).hexdigest(), d['sha256'])
                self.assertEqual(len(json.loads(body)), d['count'])
                self.assertNotIn(b'private', body)
            self.assertEqual(m['active_count'], 1)
            self.assertEqual(m['inactive_count'], 1)
            snapshots.publish(self.rows(), root, today=date(2026, 10, 18))
            self.assertTrue((Path(root) / m['current']['path']).exists())

    def test_empty_duplicate_and_large_drop_preserve_pointer(self):
        with tempfile.TemporaryDirectory() as root:
            snapshots.publish(self.rows(), root, today=date(2026, 10, 17))
            pointer = Path(root) / 'vacancies-manifest.json'
            original = pointer.read_bytes()
            for bad in ([], [self.rows()[0]] * 3, self.rows()[:1]):
                with self.assertRaises(ValueError):
                    snapshots.publish(bad, root)
                self.assertEqual(pointer.read_bytes(), original)

    def test_interrupted_shard_write_keeps_old_manifest(self):
        with tempfile.TemporaryDirectory() as root:
            snapshots.publish(self.rows(), root)
            pointer = Path(root) / 'vacancies-manifest.json'
            original = pointer.read_bytes()
            with patch.object(snapshots, 'atomic_write', side_effect=OSError('disk unavailable')):
                with self.assertRaises(OSError):
                    snapshots.publish(self.rows(), root)
            self.assertEqual(pointer.read_bytes(), original)

    def test_undated_rule_and_calendar_validation(self):
        today = date(2026, 10, 17)
        for notified, expected in [('2026-08-18', 'Active'), ('2026-08-17', 'Unknown'),
                                   ('2026-10-18', 'Unknown'), ('bad', 'Unknown')]:
            self.assertEqual(snapshots.status_row(dict(Notification_Date=notified), today)['Status'], expected)
        self.assertIsNone(snapshots.iso_date('2026-02-30'))


class ExportTests(unittest.TestCase):
    def response(self, rows, count):
        class Response:
            headers = {'Content-Encoding': 'gzip', 'Content-Range': f'0-0/{count}'}
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, limit): return gzip.compress(json.dumps(rows).encode())[:limit]
        return Response()

    def test_export_uses_narrow_fields_and_rejects_partial_result(self):
        import build_data
        response = self.response([{'vacancy_id':'A', 'post_name':'Officer'}], 2)
        with patch.object(build_data.urllib.request, 'urlopen', return_value=response) as request:
            with self.assertRaisesRegex(RuntimeError, 'Partial export'):
                build_data.fetch_supabase_rows('https://example.invalid', 'test-only-token')
            req = request.call_args.args[0]
            select = parse_qs(urlsplit(req.full_url).query)['select'][0]
            self.assertNotIn('*', select)
            self.assertNotIn('reviewer_notes', select)
            self.assertIn('detailed_eligibility:raw_extraction->>detailed_eligibility', select)
            self.assertEqual(req.get_header('Accept-encoding'), 'gzip')

    def test_transfer_budget_fails_before_publication(self):
        import build_data
        with patch.dict('os.environ', {'SNAPSHOT_MAX_TRANSFER_BYTES':'1'}), patch.object(
                build_data.urllib.request, 'urlopen', return_value=self.response([{'vacancy_id':'A'}], 1)):
            with self.assertRaisesRegex(RuntimeError, 'transfer budget'):
                build_data.fetch_supabase_rows('https://example.invalid', 'test-only-token')

    def test_missing_server_credentials_fail_without_spreadsheet_fallback(self):
        import build_data
        with patch.dict('os.environ', {}, clear=True), patch.object(build_data, 'fetch_sheet_rows') as legacy:
            with self.assertRaisesRegex(RuntimeError, 'server-only'):
                build_data.main()
            legacy.assert_not_called()


if __name__ == '__main__':
    unittest.main()
