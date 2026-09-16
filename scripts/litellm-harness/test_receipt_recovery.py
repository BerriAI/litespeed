import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from receipt_recovery import MODEL, audit, apply_audit, match_receipts


class RecoveryTests(unittest.TestCase):
    def fixture(self):
        record = {'id': 'request-a', 'label': 'run-a', 'status': 'settled',
                  'reservedUsd': .25, 'chargedUsd': .25, 'seconds': 1.005}
        body = {'model': MODEL, 'messages': [{'role': 'tool', 'tool_call_id': 'call-a', 'content': 'observed output'}]}
        requests = {'request-a': {'body': body, 'mtimeMs': 1005, 'sha256': 'hash'}}
        usage = {'inputTokens': 1000, 'outputTokens': 20, 'cachedTokens': 800, 'durationMs': 1000}
        units = [{'id': 'usage-a', 'model': MODEL, 'startedAt': 1000, 'usage': usage}]
        messages = [{'id': 'tool-a', 'role': 'tool', 'toolCallId': 'call-a', 'content': 'observed output', 'createdAt': 999},
                    {'id': 'assistant-a', 'role': 'assistant', 'createdAt': 999, 'usage': usage}]
        return [record], requests, units, messages

    def test_exact_round_requires_timing_receipt_and_prior_tool_content(self):
        data = self.fixture()
        good, bad, _ = match_receipts(*data)
        self.assertEqual(len(good), 1)
        self.assertFalse(bad)
        self.assertAlmostEqual(good[0]['reconciledUsd'], .0000628)
        data[1]['request-a']['body']['messages'][-1]['content'] = 'different output'
        self.assertFalse(match_receipts(*data)[0])

    def test_ambiguous_or_reused_receipts_do_not_release_reservations(self):
        records, requests, units, messages = self.fixture()
        self.assertFalse(match_receipts(records, requests, units + [copy.deepcopy(units[0])], messages)[0])
        records.append({**records[0], 'id': 'request-b'})
        requests['request-b'] = copy.deepcopy(requests['request-a'])
        self.assertFalse(match_receipts(records, requests, units, messages)[0])

    def test_known_receipt_mismatch_is_visible_and_reported_cost_is_preserved(self):
        data = self.fixture()
        data[0][0].update(costKnown=True, usage={'prompt_tokens': 999, 'completion_tokens': 20})
        good, _, validation = match_receipts(*data)
        self.assertFalse(good)
        self.assertEqual(validation, [{'requestId': 'request-a', 'equalUsage': False}])
        data = self.fixture()
        data[2][0]['usage']['cost'] = .02
        self.assertEqual(match_receipts(*data)[0][0]['reconciledUsd'], .02)

    def test_invalid_model_counts_or_request_timing_remain_unknown(self):
        for change in ['model', 'cache', 'timing', 'duration']:
            data = self.fixture()
            if change == 'model':
                data[1]['request-a']['body']['model'] = 'different-model'
            elif change == 'cache':
                data[2][0]['usage']['cachedTokens'] = 1001
            elif change == 'timing':
                data[1]['request-a']['mtimeMs'] = 2000
            else:
                data[0][0]['seconds'] = 10
            self.assertFalse(match_receipts(*data)[0], change)

    def write_fixture(self, root):
        records, requests, units, messages = self.fixture()
        (root / 'requests').mkdir()
        request = root / 'requests/request-a.request.json'
        request.write_text(json.dumps(requests['request-a']['body']))
        os.utime(request, (1.005, 1.005))
        run = root / 'runs/run-a'
        run.mkdir(parents=True)
        (run / 'result.json').write_text(json.dumps({'usage': {'breakdown': units}}))
        (run / 'messages.json').write_text(json.dumps(messages))
        (root / 'analysis.json').write_text(json.dumps([{'run': 'run-a'}]))
        (root / 'spend.json').write_text(json.dumps({'limitUsd': 100, 'committedUsd': .25, 'records': records}))

    def test_offline_apply_preserves_history_and_cannot_repeat(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_fixture(root)
            proof = audit(root, ['.'])
            (root / 'gateway.lock').write_text('live owner')
            with self.assertRaises(FileExistsError):
                apply_audit(root, proof)
            self.assertEqual((root / 'gateway.lock').read_text(), 'live owner')
            (root / 'gateway.lock').unlink()
            result = apply_audit(root, proof)
            self.assertEqual(result['applied'], 1)
            ledger = json.loads((root / 'spend.json').read_text())
            record = ledger['records'][0]
            self.assertEqual(ledger['limitUsd'], 100)
            self.assertEqual(record['reservedUsd'], .25)
            self.assertEqual(record['receiptRecovery']['priorChargedUsd'], .25)
            self.assertTrue(record['costKnown'])
            self.assertAlmostEqual(ledger['committedUsd'], .0000628)
            self.assertEqual(json.loads((root / result['backup']).read_text())['committedUsd'], .25)
            with self.assertRaisesRegex(ValueError, 'Evidence changed'):
                apply_audit(root, proof)
            self.assertFalse((root / 'gateway.lock').exists())

    def test_changed_sources_and_pending_requests_block_application(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_fixture(root)
            proof = audit(root, ['.'])
            request = root / 'requests/request-a.request.json'
            request.write_text(request.read_text() + '\n')
            with self.assertRaisesRegex(ValueError, 'Evidence changed'):
                apply_audit(root, proof)
            ledger = json.loads((root / 'spend.json').read_text())
            ledger['records'][0]['status'] = 'pending'
            (root / 'spend.json').write_text(json.dumps(ledger))
            with self.assertRaisesRegex(ValueError, 'Drain every'):
                apply_audit(root, proof)
            self.assertEqual(json.loads((root / 'spend.json').read_text())['committedUsd'], .25)

    def test_a_known_mismatch_blocks_recovery_of_another_unknown_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_fixture(root)
            ledger = json.loads((root / 'spend.json').read_text())
            ledger['records'].append({**ledger['records'][0], 'id': 'request-b', 'costKnown': True,
                                      'usage': {'prompt_tokens': 999, 'completion_tokens': 20}})
            (root / 'spend.json').write_text(json.dumps(ledger))
            body = {'model': MODEL, 'messages': [{'role': 'tool', 'tool_call_id': 'call-b', 'content': 'second output'}]}
            request = root / 'requests/request-b.request.json'
            request.write_text(json.dumps(body))
            os.utime(request, (2.005, 2.005))
            result_path = root / 'runs/run-a/result.json'
            result = json.loads(result_path.read_text())
            unit = copy.deepcopy(result['usage']['breakdown'][0])
            unit.update(id='usage-b', startedAt=2000)
            result['usage']['breakdown'].append(unit)
            result_path.write_text(json.dumps(result))
            path = root / 'runs/run-a/messages.json'
            messages = json.loads(path.read_text())
            messages.extend([{'id': 'tool-b', 'role': 'tool', 'toolCallId': 'call-b', 'content': 'second output', 'createdAt': 1999},
                             {'id': 'assistant-b', 'role': 'assistant', 'createdAt': 1999, 'usage': unit['usage']}])
            path.write_text(json.dumps(messages))
            proof = audit(root, ['.'])
            self.assertEqual(len(proof['verified']), 1)
            self.assertFalse(proof['knownReceiptValidation'][0]['equalUsage'])
            before = (root / 'spend.json').read_bytes()
            with self.assertRaisesRegex(ValueError, 'disagrees with a known'):
                apply_audit(root, proof)
            self.assertEqual((root / 'spend.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
