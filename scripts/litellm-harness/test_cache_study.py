import unittest
import tempfile
import json
from pathlib import Path
from cache_study import aggregate, summarize
from prefix_study import advance


class CacheMeasurementTests(unittest.TestCase):
    def test_chronological_notice_preserves_the_sent_prefix(self):
        original = [{'role': 'system', 'content': 'instructions'},
                    {'role': 'system', 'content': 'initial'},
                    {'role': 'user', 'content': 'source'}]
        history = original.copy()
        advance(history, 'chronological-event', 0, 'OK')
        self.assertEqual(history[:len(original)], original)
        self.assertEqual(history[-2]['content'], 'Background command completion: job-1 exited with code 0.')
        changed = original.copy()
        advance(changed, 'early-envelope', 0, 'OK')
        self.assertNotEqual(changed[1], original[1])
        self.assertEqual(changed[2], original[2])

    def row(self, tokens, cached, seconds=1):
        return {'usage': {'prompt_tokens': tokens, 'prompt_tokens_details': {'cached_tokens': cached}},
                'seconds': seconds, 'responseIsOK': True, 'finishReason': 'stop'}

    def test_weights_cache_ratio_by_tokens(self):
        result=aggregate([self.row(100,100),self.row(900,0,3)])
        self.assertAlmostEqual(result['cacheRatio'],.1)
        self.assertAlmostEqual(result['inputEstimatedUsd'],(900*.22+100*.007)/1e6)
        self.assertEqual(result['meanSeconds'],2)

    def test_missing_or_invalid_cache_is_not_zero(self):
        for invalid in [self.row(100,None),self.row(100,101),self.row(100,True)]:
            result=aggregate([self.row(100,50),invalid])
            self.assertEqual(result['validMeasurements'],1)
            self.assertFalse(result['completeMeasurements'])
            self.assertIsNone(result['cacheRatio'])
            self.assertIsNone(result['inputEstimatedUsd'])

    def test_failed_output_remains_in_measurements(self):
        row=self.row(100,50);row['finishReason']='length';row['responseIsOK']=False
        result=aggregate([row])
        self.assertTrue(result['completeMeasurements'])
        self.assertFalse(result['allResponsesOK'])
        self.assertEqual(result['cacheRatio'],.5)

    def test_declared_arm_direction_is_used_for_deltas(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            plan = {'targetSourceCharacters': [100], 'repetitions': 1, 'roundsPerArm': 2,
                    'arms': ['early-envelope', 'chronological-event'],
                    'control': 'early-envelope', 'candidate': 'chronological-event'}
            (root / 'plan.json').write_text(json.dumps(plan))
            for arm, cached in [('early-envelope', 0), ('chronological-event', 90)]:
                for step in range(2):
                    row = {**self.row(100, cached), 'sourceCharacters': 100,
                           'rep': 1, 'arm': arm, 'round': step}
                    (root / f'100-r1-{arm}-step{step:02d}.result.json').write_text(json.dumps(row))
            result = summarize(root)
            self.assertEqual(result['status'], 'complete')
            self.assertAlmostEqual(result['comparisons'][0]['cacheRatioDelta'], .9)
            self.assertLess(result['comparisons'][0]['inputEstimatedUsdDelta'], 0)
            plan['candidate'] = plan['control']
            (root / 'plan.json').write_text(json.dumps(plan))
            with self.assertRaises(ValueError):
                summarize(root)

    def test_declared_replacement_excludes_original_attempt_receipts(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            plan={'targetSourceCharacters':[100], 'repetitions':1, 'arms':['omitted-user','stable-user'],
                  'roundsPerArm':2, 'scenarioAttempts':{'100-r1':'oom1'}}
            (root/'plan.json').write_text(json.dumps(plan))
            for arm in plan['arms']:
                for step in range(2):
                    for attempt,cached in [('',0),('-oom1',50)]:
                        row={**self.row(100,cached),'sourceCharacters':100,'rep':1,'arm':arm,'round':step}
                        (root/f'100-r1{attempt}-{arm}-step{step:02d}.result.json').write_text(json.dumps(row))
            result=summarize(root)
            self.assertEqual(result['status'],'complete')
            self.assertEqual(len(result['comparisons']),1)
            for trial in result['trials']:
                self.assertEqual(trial['attempt'],'oom1')
                self.assertEqual(trial['postInitial']['cacheRatio'],.5)
            plan['scenarioAttempts']['100-r1']='../outside'
            (root/'plan.json').write_text(json.dumps(plan))
            with self.assertRaises(ValueError):summarize(root)
