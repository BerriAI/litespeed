import unittest
from cache_study import aggregate


class CacheMeasurementTests(unittest.TestCase):
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
