import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from reflect_chunks import excerpt, reflect, request, trace_evidence


class WindowedReflectionTests(unittest.TestCase):
    def test_lifecycle_index_links_archived_launch_to_later_output_without_changing_v2(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            launch = {'role': 'assistant', 'sessionId': 's1', 'createdAt': 1, 'toolCalls': [
                {'id': 'c1', 'name': 'bash', 'args': {}, 'execution': {
                    'command': 'pytest -q test_auth.py', 'jobId': 'job-11', 'status': 'exited', 'exitCode': 0},
                 'output': 'Started background job job-11.'}]}
            later = [
                {'role': 'assistant', 'sessionId': 's1', 'createdAt': 2, 'toolCalls': [
                    {'id': 'c2', 'name': 'wait', 'args': {'job_ids': ['job-11']},
                     'output': 'job-11: Status: exited (code 0).'}]},
                {'role': 'assistant', 'sessionId': 's1', 'createdAt': 3, 'toolCalls': [
                    {'id': 'c3', 'name': 'bash_output', 'args': {'job_id': 'job-11'},
                     'output': 'Status: exited (code 0).\n' + 'warning\n' * 500 + '981 passed, 78 warnings'}]},
            ]
            (root / 'archives.json').write_text(json.dumps([{'messages': [launch]}]))
            (root / 'messages.json').write_text(json.dumps([launch, *later]))
            _, original, _ = trace_evidence(root)
            _, linked, _ = trace_evidence(root, include_job_outputs=True)
            self.assertNotIn('jobObservations', original[0])
            self.assertEqual(linked[0]['output'], 'Started background job job-11.')
            self.assertEqual(linked[0]['jobId'], 'job-11')
            observations = linked[0]['jobObservations']
            self.assertEqual([x['step'] for x in observations], [2, 3])
            self.assertFalse(observations[0]['containsCommandOutput'])
            self.assertTrue(observations[1]['containsCommandOutput'])
            self.assertIn('981 passed, 78 warnings', observations[1]['output'])

    def test_job_links_do_not_cross_sessions_or_infer_a_missing_command(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            messages = [
                {'role': 'assistant', 'sessionId': 's1', 'createdAt': 1, 'toolCalls': [
                    {'id': 'c1', 'name': 'bash', 'args': {}, 'execution': {
                        'command': 'pytest -q test_one.py', 'jobId': 'job-1'}}]},
                {'role': 'assistant', 'sessionId': 's2', 'createdAt': 2, 'toolCalls': [
                    {'id': 'c2', 'name': 'bash_output', 'args': {'job_id': 'job-1'}, 'output': 'foreign output'}]},
                {'role': 'assistant', 'sessionId': 's1', 'createdAt': 3, 'toolCalls': [
                    {'id': 'c3', 'name': 'wait', 'args': {'job_ids': ['job-1', 'missing']}, 'output': 'status only'}]},
            ]
            (root / 'messages.json').write_text(json.dumps(messages))
            _, linked, coverage = trace_evidence(root, include_job_outputs=True)
            self.assertEqual([x['step'] for x in linked[0]['jobObservations']], [3])
            self.assertNotIn('foreign output', json.dumps(linked[0]))
            self.assertEqual(coverage['unmatchedJobObservations'], 2)
            unmatched = [x for x in linked if x.get('command') is None]
            self.assertEqual(len(unmatched), 2)
            self.assertEqual(unmatched[0]['jobObservations'][0]['output'], 'foreign output')

    def test_archived_steps_and_global_check_evidence_survive_deduplication(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            old = {'role': 'assistant', 'createdAt': 1, 'content': 'testing', 'toolCalls': [
                {'id': 'c1', 'name': 'bash', 'args': {}, 'execution': {'command': 'pytest -q test_x.py', 'exitCode': 0}, 'output': '1 passed'}]}
            latest = [{'role': 'assistant', 'createdAt': n, 'content': str(n)} for n in range(2, 28)]
            (root / 'archives.json').write_text(json.dumps([{'messages': [old]}]))
            (root / 'messages.json').write_text(json.dumps([old] + latest))
            chunks, checks, coverage = trace_evidence(root)
            self.assertEqual([s['step'] for c in chunks for s in c], list(range(1, 28)))
            self.assertEqual(coverage['windows'], 3)
            self.assertEqual(checks, [{'step': 1, 'tool': 'bash', 'command': 'pytest -q test_x.py', 'status': None, 'exitCode': 0, 'checkVerdictRecognized': False, 'output': '1 passed'}])
            self.assertIn('[omitted 90 characters]', excerpt('a' * 100, 10))

    def test_reserved_task_rejected_before_loading_reference_or_sending_request(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); run = root / 'runs' / 'reserved'; run.mkdir(parents=True)
            (run / 'task.json').write_text(json.dumps({'split': 'test'}))
            with patch('reflect_chunks.request') as send:
                with self.assertRaisesRegex(ValueError, 'Reserved'):
                    reflect(root, run)
                send.assert_not_called()

    def test_resynthesis_refuses_missing_saved_windows_before_a_paid_request(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary); run = root / 'runs' / 'training'; run.mkdir(parents=True)
            case = root / 'cases' / 'case'; case.mkdir(parents=True)
            (run / 'task.json').write_text(json.dumps({'id': 'case', 'split': 'dev'}))
            (case / 'validation.json').write_text(json.dumps({'valid': True}))
            (run / 'messages.json').write_text(json.dumps([
                {'role': 'assistant', 'createdAt': 1, 'content': 'Finished.'}]))
            with patch('reflect_chunks.request') as send:
                with self.assertRaisesRegex(ValueError, 'preserved v2 windows'):
                    reflect(root, run, protocol=3)
                send.assert_not_called()
            self.assertFalse((run / 'windowed-reflection-v3').exists())

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
