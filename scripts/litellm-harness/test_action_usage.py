import unittest
from action_usage import action_usage


class ActionUsageTests(unittest.TestCase):
    def test_mixed_reply_is_charged_once_and_unattributed_usage_stays_visible(self):
        usage = dict(inputTokens=100, cachedTokens=80, outputTokens=10, durationMs=1200)
        messages = [dict(role='assistant', usage=usage, toolCalls=[{'name': 'read_file'}, {'name': 'edit_file'}]),
                    dict(role='tool', usage=usage), dict(role='assistant')]
        extra = dict(inputTokens=50, cachedTokens=0, outputTokens=4)
        result = action_usage(messages, [{'usage': usage}, {'usage': extra}, {}])
        row = result['groups']['mixed-tools']
        self.assertEqual(row['requests'], 1)
        self.assertAlmostEqual(row['estimatedUsd'], (20 * .22 + 80 * .007 + 10 * .66) / 1e6)
        self.assertEqual(row['reportedModelSeconds'], 1.2)
        self.assertEqual(result['reconciliation']['inputTokens']['difference'], 50)
        self.assertEqual(result['assistantMessagesWithoutValidUsage'], 1)
        self.assertEqual(result['breakdownRecordsWithoutValidUsage'], 1)

    def test_invalid_cache_and_negative_reconciliation_are_not_hidden(self):
        usage = dict(inputTokens=100, outputTokens=5)
        result = action_usage([dict(role='assistant', usage=usage),
            dict(role='assistant', usage={**usage, 'cachedTokens': 101}),
            dict(role='assistant', usage={**usage, 'inputTokens': True})], [])
        self.assertEqual(result['groups']['text-only']['cacheUnreportedRequests'], 1)
        self.assertEqual(result['groups']['text-only']['durationUnreportedRequests'], 1)
        self.assertEqual(result['assistantMessagesWithoutValidUsage'], 2)
        self.assertEqual(result['reconciliation']['inputTokens']['difference'], -100)

    def test_background_receipt_does_not_double_charge_poll(self):
        usage = dict(inputTokens=100, outputTokens=5, cachedTokens=10)
        calls = [[{'name': 'bash', 'execution': {'checkKey': 'pytest'}}], [{'name': 'bash_output'}], [{'name': 'wait'}]]
        messages = [dict(role='assistant', usage=usage, toolCalls=c) for c in calls]
        result = action_usage(messages, [{'usage': usage}] * 3)
        self.assertEqual(result['groups']['check-command']['requests'], 1)
        self.assertEqual(result['groups']['job-poll-or-wait']['requests'], 2)
        self.assertEqual(result['reconciliation']['inputTokens']['difference'], 0)


if __name__ == '__main__':
    unittest.main()
