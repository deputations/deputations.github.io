import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import build_openai_embeddings as builder


class BuildTests(unittest.TestCase):
    @patch.object(builder, 'request_json')
    @patch.object(builder, 'embed_batch', return_value=[[0.1] * 768])
    @patch.object(builder, 'existing_hashes')
    @patch.object(builder, 'write_state')
    def test_only_changed_rows_are_written_and_ready_marked_last(self, state, hashes, embed, request):
        hashes.return_value = {'old': builder.content_hash('unchanged')}
        builder.build('https://example.test', 'service', 'secret', [('old', 'unchanged'), ('new', 'finance')])
        embed.assert_called_once_with(['finance'], 'secret')
        self.assertEqual(request.call_count, 1)
        self.assertEqual(state.call_args_list[0].args[3], '')
        self.assertEqual(state.call_args_list[-1].args[3], builder.MODEL)

    @patch.object(builder, 'embed_batch', side_effect=RuntimeError('failed'))
    @patch.object(builder, 'existing_hashes', return_value={})
    @patch.object(builder, 'write_state')
    def test_failed_build_never_marks_index_ready(self, state, hashes, embed):
        with self.assertRaises(RuntimeError):
            builder.build('https://example.test', 'service', 'secret', [('new', 'finance')])
        self.assertEqual([c.args[3] for c in state.call_args_list], [''])

    @patch.object(builder, 'request_json')
    def test_reads_all_pages_of_existing_hashes(self, request):
        request.side_effect = [[{'vacancy_id': str(i), 'content_hash': 'h'} for i in range(500)],
                               [{'vacancy_id': '500', 'content_hash': 'h'}]]
        self.assertEqual(len(builder.existing_hashes('https://example.test', 'service')), 501)


if __name__ == '__main__':
    unittest.main()
