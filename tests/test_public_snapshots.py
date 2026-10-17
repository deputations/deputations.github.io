"""Failure-path tests: publication must never destroy the last good pointer."""
import hashlib
import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

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


if __name__ == '__main__':
    unittest.main()
