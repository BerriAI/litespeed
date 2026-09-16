import unittest
import json
from unittest.mock import patch
from pathlib import Path
from tempfile import TemporaryDirectory
from study import main, paired_summary, supplemental_result
from trace_metrics import activations
from completion import completion_reason


class StudyTests(unittest.TestCase):
    def test_incident_keeps_raw_outcomes_but_invalidates_comparison_regardless_of_score(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan = {'protocol': 7, 'repetitions': 1, 'runs': []}
            analysis = []
            for name, passed in [('control', True), ('candidate', False)]:
                plan['runs'].append(dict(dataset='', case='billing', name=name, label=name, commit='abc', effort='medium'))
                analysis.append(dict(id='billing', run=name, label=name, harnessCommit='abc', evaluationProtocol=7,
                                     effort='medium', acceptance={'passed': passed}, completed=True, seconds=1))
            (root/'plan.json').write_text(json.dumps(plan))
            (root/'analysis.json').write_text(json.dumps(analysis))
            with patch('sys.argv', ['study.py', str(root), str(root/'plan.json'), str(root/'output.json')]), \
                 patch('study.incident_runs', return_value={'control':'outage', 'candidate':'outage'}), patch('builtins.print'):
                main()
            output = json.loads((root/'output.json').read_text())
            self.assertEqual(output['status'], 'infrastructure-interrupted')
            self.assertEqual([r['success'] for r in output['trials']], [True, False])
            self.assertEqual(sum(r['evaluated'] for r in output['variants']), 2)
            self.assertEqual(sum(r['eligibleEvaluated'] for r in output['qualityEligibleVariants']), 0)
            self.assertEqual(sum(r['incidentAllocations'] for r in output['qualityEligibleVariants']), 2)
            self.assertEqual(output['comparisons'][0]['pairedTasks'], 0)

    def test_timeout_override_is_verified_against_the_actual_trial(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            row = dict(dataset='', case='stream', name='control', label='study',
                       commit='abc', effort='medium', timeoutSeconds=1800)
            plan = {'protocol': 7, 'repetitions': 1, 'timeoutSeconds': 900, 'runs': [row]}
            record = dict(id='stream', run='stream', label='study', harnessCommit='abc',
                          evaluationProtocol=7, effort='medium', timeoutSeconds=900,
                          acceptance={'passed': True}, completed=True, seconds=1)
            (root/'plan.json').write_text(json.dumps(plan))
            for actual in [900, None]:
                record['timeoutSeconds'] = actual
                (root/'analysis.json').write_text(json.dumps([record]))
                with patch('sys.argv', ['study.py', str(root), str(root/'plan.json'), str(root/'output.json')]):
                    with self.assertRaisesRegex(ValueError, 'Trial timeout'):
                        main()
            record['timeoutSeconds'] = 1800
            (root/'analysis.json').write_text(json.dumps([record]))
            with patch('sys.argv', ['study.py', str(root), str(root/'plan.json'), str(root/'output.json')]), patch('builtins.print'):
                main()
            self.assertEqual(json.loads((root/'output.json').read_text())['trials'][0]['timeoutSeconds'], 1800)
            del row['timeoutSeconds']
            (root/'plan.json').write_text(json.dumps(plan))
            with patch('sys.argv', ['study.py', str(root), str(root/'plan.json'), str(root/'output.json')]):
                with self.assertRaisesRegex(ValueError, 'Trial timeout'):
                    main()

    def test_declared_codex_route_rejects_a_flash_trial_with_the_same_label(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            row = dict(dataset='', case='stream', name='control', label='study',
                       commit='abc', effort='high', kind='codex')
            plan = {'protocol': 6, 'repetitions': 1, 'runs': [row]}
            record = dict(id='stream', run='stream', label='study', harnessCommit='abc',
                          evaluationProtocol=6, effort='high', kind='litellm-specific',
                          acceptance={'passed': True}, completed=True, seconds=1)
            (root/'analysis.json').write_text(json.dumps([record]))
            (root/'plan.json').write_text(json.dumps(plan))
            with patch('sys.argv', ['study.py', str(root), str(root/'plan.json'), str(root/'output.json')]):
                with self.assertRaisesRegex(ValueError, 'solver route'):
                    main()
            record['kind'] = 'codex'
            (root/'analysis.json').write_text(json.dumps([record]))
            with patch('sys.argv', ['study.py', str(root), str(root/'plan.json'), str(root/'output.json')]), patch('builtins.print'):
                main()
            result = json.loads((root/'output.json').read_text())
            self.assertEqual(result['trials'][0]['kind'], 'codex')
            self.assertIsNone(result['variants'][0]['tokenPricedUsd'])
            self.assertEqual(result['variants'][0]['trialsWithoutTokenPrice'], 1)

    def test_missing_control_cannot_silently_produce_empty_comparisons(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root/'plan.json').write_text(json.dumps({'runs': [{'name': 'medium'}, {'name': 'high'}]}))
            with patch('sys.argv', ['study.py', str(root), str(root/'plan.json'), str(root/'output.json')]):
                with self.assertRaisesRegex(ValueError, 'control variant'):
                    main()

    def test_per_trial_supplement_does_not_block_unrelated_cases(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan = {'protocol': 6, 'repetitions': 1, 'runs': []}
            analysis = []
            for case in ['router', 'budget']:
                row = dict(dataset='', case=case, name='control', label='study', commit='abc', effort='medium')
                if case == 'router':
                    row['supplemental'] = {'artifact': 'probe.json', 'expectedChecks': 1}
                plan['runs'].append(row)
                analysis.append(dict(id=case, run=case, label='study', harnessCommit='abc', evaluationProtocol=6, effort='medium', acceptance={'passed': True}, completed=True, seconds=1))
                (root/'runs'/case).mkdir(parents=True)
            (root/'analysis.json').write_text(json.dumps(analysis))
            (root/'plan.json').write_text(json.dumps(plan))
            with patch('sys.argv', ['study.py', str(root), str(root/'plan.json'), str(root/'output.json')]), patch('builtins.print'):
                main()
            rows = json.loads((root/'output.json').read_text())['trials']
            self.assertFalse(rows[0]['evaluated'])
            self.assertTrue(rows[1]['evaluated'])
            self.assertTrue(rows[1]['success'])

    def test_supplemental_probe_requires_every_declared_check(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            spec = {'artifact': 'probe.json', 'expectedChecks': 2}
            self.assertIsNone(supplemental_result(root, spec))
            source = root / 'probe.json'
            # A successful process and claimed success cannot hide a failed case.
            source.write_text(json.dumps({'exit': 0, 'passed': True, 'rows': [{'pass': True}, {'pass': False}]}))
            self.assertFalse(supplemental_result(root, spec)['passed'])
            source.write_text(json.dumps({'exit': 0, 'rows': [{'pass': True}]}))
            self.assertFalse(supplemental_result(root, spec)['passed'])
            source.write_text(json.dumps({'exit': 0, 'rows': [{'pass': True}, {'pass': True}]}))
            self.assertTrue(supplemental_result(root, spec)['passed'])
            with self.assertRaises(ValueError):
                supplemental_result(root, {'artifact': '../probe.json', 'expectedChecks': 2})

    def test_idle_guard_stop_is_not_a_completed_task(self):
        result = {'kind': 'litellm-specific', 'status': 'idle', 'acceptance': {'passed': True},
                  'final': 'I stopped because the model requested the same tools three times in a row. The third batch was not executed.'}
        self.assertEqual(completion_reason(result), 'repeated-tools-guard')
        result['final'] = '[Stopped: several rounds produced no new information. Summarize what was learned and what is blocking.]'
        self.assertEqual(completion_reason(result), 'no-progress-guard')
        result['final'] = '   '
        self.assertEqual(completion_reason(result), 'empty-handoff')
        result['final'] = 'Implemented and verified the change.'
        self.assertEqual(completion_reason(result), 'completed')
        result['timedOut'] = True
        self.assertEqual(completion_reason(result), 'timeout')

    def test_activation_requires_observed_payload(self):
        messages = [{'role': 'system', 'content': 'Background command completion: job-1 finished'}, {'role': 'system', 'content': 'LiteLLM starting locations\n<workspace_reference>\n{"playbooks":[{"id":"router"}]}\n</workspace_reference>'},
                    {'role': 'system', 'content': 'LiteLLM change review.\nRelevant repository lessons for this final audit: [{"id":"review-only"}]\n'}]
        calls = [{'name': 'read_file', 'args': {}}, {'name': 'read_file', 'args': {'limit': 20}},
                 {'name': 'litellm_context', 'output': '{"playbooks":[{"id":"router"}]}'},
                 {'name': 'litellm_context', 'output': 'truncated'},
                 {'name': 'edit_file', 'status': 'completed', 'args': {'edits': [{}, {}]}},
                 {'name': 'edit_file', 'status': 'error', 'args': {'edits': [{}, {}, {}]}}]
        result = activations(messages, calls)
        self.assertEqual(result['guideIdsShown'], ['router'])
        self.assertEqual(result['finalReviewNotices'], 1)
        self.assertEqual(result['backgroundCommandNotices'], 1)
        self.assertEqual(result['guidedFinalReviewNotices'], 1)
        self.assertEqual(result['finalReviewGuideIdsShown'], ['review-only'])
        self.assertEqual(result['batchedEditCalls'], 2)
        self.assertEqual(result['completedBatchedEditCalls'], 1)
        self.assertEqual(result['batchEditsRequested'], 5)
        self.assertEqual(result['batchSizes'], [2, 3])
        self.assertIsNone(result['defaultWindowReadCalls'])
        self.assertEqual(result['readCallsByEffectiveLimit'], {'missing': 1, '20': 1})
        self.assertEqual(result['unparsedContextPayloads'], 1)

    def test_incomplete_pair_is_not_compared(self):
        rows = []
        for case in ['a', 'b']:
            for name, success in [('control', False), ('no-guides', True)]:
                for _ in range(2):
                    rows.append(dict(dataset='', case=case, name=name, evaluated=True, success=success, seconds=1))
        result = paired_summary(rows, 2)[0]
        self.assertTrue(result['complete'])
        self.assertEqual(result['successDelta'], 1)
        self.assertEqual(result['taskBootstrap95'], [1, 1])
        rows[-1]['evaluated'] = False
        result = paired_summary(rows, 2)[0]
        self.assertFalse(result['complete'])
        self.assertEqual(result['pairedTasks'], 1)
        self.assertIsNone(result['taskBootstrap95'])


if __name__ == '__main__':
    unittest.main()
