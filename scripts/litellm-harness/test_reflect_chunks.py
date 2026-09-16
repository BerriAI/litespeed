import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from reflect_chunks import excerpt, reflect, request, trace_evidence


class WindowedReflectionTests(unittest.TestCase):
    def test_archived_steps_and_global_check_evidence_survive_deduplication(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            old = {'role': 'assistant', 'createdAt': 1, 'content': 'testing', 'toolCalls': [
                {'id': 'c1', 'name': 'bash', 'args': {}, 'execution': {'checkKey': 'pytest', 'command': 'pytest -q test_x.py', 'exitCode': 0}, 'output': '1 passed'}]}
            latest = [{'role': 'assistant', 'createdAt': n, 'content': str(n)} for n in range(2, 28)]
            (root / 'archives.json').write_text(json.dumps([{'messages': [old]}]))
            (root / 'messages.json').write_text(json.dumps([old] + latest))
            chunks, checks, coverage = trace_evidence(root)
            self.assertEqual([s['step'] for c in chunks for s in c], list(range(1, 28)))
            self.assertEqual(coverage['windows'], 3)
            self.assertEqual(checks, [{'step': 1, 'tool': 'bash', 'command': 'pytest -q test_x.py', 'exitCode': 0}])
            self.assertIn('[omitted 90 characters]', excerpt('a' * 100, 10))

    def test_reserved_task_rejected_before_loading_reference_or_sending_request(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); run = root / 'runs' / 'reserved'; run.mkdir(parents=True)
            (run / 'task.json').write_text(json.dumps({'split': 'test'}))
            with patch('reflect_chunks.request') as send:
                with self.assertRaisesRegex(ValueError, 'Reserved'):
                    reflect(root, run)
                send.assert_not_called()

    def test_ambiguous_prior_submission_is_not_automatically_retried(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); target = root / 'window.json'
            target.with_suffix('.request.json').write_text('{}')
            with patch('urllib.request.urlopen') as send:
                with self.assertRaises(FileExistsError):
                    request(root, target, 'label', 'system', {}, 100)
                send.assert_not_called()


if __name__ == '__main__':
    unittest.main()
