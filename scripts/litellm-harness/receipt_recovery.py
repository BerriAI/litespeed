"""Recover missing gateway usage only from uniquely matched persisted receipts.

Audit: receipt_recovery.py CAMPAIGN_ROOT AUDIT_JSON DATASET [DATASET ...]
Apply: receipt_recovery.py CAMPAIGN_ROOT AUDIT_JSON --apply
Use '.' for the original dataset. Stop the gateway after draining requests before
applying. The exclusive gateway lock and unchanged source hashes are mandatory.
No raw messages, tool output, prompts or reasoning are exported by this module.
"""
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import sys
from uuid import uuid4


MODEL = 'fireworks_ai/deepseek-v4p1-flash'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def known(record):
    usage = record.get('usage')
    return record.get('costKnown') is True or (
        'costKnown' not in record and isinstance(usage, dict)
        and all(number(usage.get(k)) for k in ['prompt_tokens', 'completion_tokens']))


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def tokens(usage, gateway=False):
    if gateway:
        return (usage.get('prompt_tokens'), usage.get('completion_tokens'),
                usage.get('prompt_tokens_details', {}).get('cached_tokens', 0))
    return usage.get('inputTokens'), usage.get('outputTokens'), usage.get('cachedTokens', 0)


def match_receipts(records, requests, units, messages):
    """Conservative round binding, independent of aggregate token differences."""
    matches = {}
    for record in records:
        request = requests.get(record['id'])
        if request is None:
            continue
        candidates = [unit for unit in units if number(unit.get('startedAt'))
            and number(unit.get('usage', {}).get('durationMs'))
            and 0 <= request['mtimeMs'] - unit['startedAt'] <= 250
            and abs(record.get('seconds', -999) * 1000 - unit['usage']['durationMs']) <= 250]
        if len(candidates) == 1:
            matches[record['id']] = candidates[0]
    uses = Counter(unit['id'] for unit in matches.values())
    verified, rejected, validation = [], [], []
    for record in records:
        if record['status'] != 'settled':
            continue
        request = requests.get(record['id'])
        unit = matches.get(record['id'])
        reason = None
        if request is None or unit is None:
            reason = 'No unique request timestamp and duration match'
        else:
            usage = unit['usage']
            values = tokens(usage)
            if uses[unit['id']] != 1:
                reason = 'Runner receipt maps to multiple admitted requests'
            elif not all(number(v) for v in values) or values[2] > values[0] or values[0] == 0:
                reason = 'Invalid or incomplete token receipt'
            else:
                assistants = [m for m in messages if m.get('role') == 'assistant'
                    and isinstance(m.get('usage'), dict) and tokens(m['usage']) == values
                    and abs(m['createdAt'] - unit['startedAt']) <= 50]
                body = request['body']
                last = (body.get('messages') or [{}])[-1]
                preceding = [m for m in messages if m.get('role') == 'tool'
                    and last.get('role') == 'tool' and m.get('toolCallId') == last.get('tool_call_id')
                    and m.get('content') == last.get('content')
                    and 0 <= unit['startedAt'] - m['createdAt'] <= 250]
                if body.get('model') != MODEL or unit.get('model') != MODEL:
                    reason = 'Wrong model'
                elif len(assistants) != 1:
                    reason = 'No unique persisted assistant receipt'
                elif len(preceding) != 1:
                    reason = 'No exact preceding tool output at the request boundary'
                elif known(record):
                    if isinstance(record.get('usage'), dict):
                        validation.append({'requestId': record['id'],
                                           'equalUsage': tokens(record['usage'], True) == values})
                else:
                    price = ((values[0] - values[2]) * .22 + values[2] * .007 + values[1] * .66) / 1e6
                    reported = usage.get('cost')
                    if reported is not None and not number(reported):
                        reason = 'Invalid reported cost'
                    else:
                        verified.append({'requestId': record['id'], 'receiptId': unit['id'],
                            'assistantMessageId': assistants[0]['id'], 'priorToolCallId': preceding[0]['toolCallId'],
                            'requestSha256': request['sha256'],
                            'startDeltaMs': request['mtimeMs'] - unit['startedAt'],
                            'durationDeltaMs': record['seconds'] * 1000 - usage['durationMs'],
                            'usage': {'prompt_tokens': values[0], 'completion_tokens': values[1],
                                      'prompt_tokens_details': {'cached_tokens': values[2]},
                                      **({'cost': reported} if reported is not None else {})},
                            'tokenPricedUsd': price, 'reconciledUsd': max(price, reported or 0),
                            'priorReservedUsd': record.get('chargedUsd', record['reservedUsd'])})
        if reason and not known(record):
            rejected.append({'requestId': record['id'], 'reason': reason})
    return verified, rejected, validation


def audit(root, datasets):
    root = Path(root).resolve()
    ledger = json.loads((root / 'spend.json').read_text())
    by_label = defaultdict(list)
    for record in ledger['records']:
        by_label[record['label']].append(record)
    unknown_labels = {r['label'] for r in ledger['records'] if r['status'] == 'settled' and not known(r)}
    verified, rejected, validation, hashes = [], [], [], {}
    def read(path):
        raw = path.read_bytes()
        hashes[str(path.relative_to(root))] = digest(raw)
        return json.loads(raw)
    for dataset in datasets:
        directory = (root / dataset).resolve()
        if not directory.is_relative_to(root):
            raise ValueError('Datasets must remain inside the campaign directory.')
        # Explicit dataset allowlist; never traverse a reserved sibling corpus.
        for summary in read(directory / 'analysis.json'):
            label = summary['run']
            if label not in unknown_labels:
                continue
            run = (directory / 'runs' / label).resolve()
            if run.parent != directory / 'runs':
                raise ValueError('Invalid run identity.')
            if not (run / 'messages.json').exists():
                continue
            result, messages = read(run / 'result.json'), read(run / 'messages.json')
            if (run / 'archives.json').exists():
                messages += [m for a in read(run / 'archives.json') for m in a['messages']]
            messages = list({m['id']: m for m in messages}.values())
            units = [u for u in result.get('usage', {}).get('breakdown', []) if isinstance(u.get('usage'), dict)]
            requests = {}
            for record in by_label[label]:
                path = root / 'requests' / (record['id'] + '.request.json')
                if path.exists():
                    body = read(path)
                    requests[record['id']] = {'body': body, 'mtimeMs': path.stat().st_mtime * 1000,
                                              'sha256': hashes[str(path.relative_to(root))]}
            good, bad, checks = match_receipts(by_label[label], requests, units, messages)
            verified.extend({**v, 'dataset': dataset, 'run': label} for v in good)
            rejected.extend(bad)
            validation.extend(checks)
    if len({v['requestId'] for v in verified}) != len(verified):
        raise ValueError('Duplicate recovery identity.')
    return {'schemaVersion': 1, 'status': 'audit-only', 'datasets': datasets,
            'verified': verified, 'rejected': rejected, 'knownReceiptValidation': validation,
            'sourceHashes': hashes, 'scope': 'Persisted runner usage, not an upstream invoice. Exact round binding and token pricing; no ledger mutation until offline application.'}


def apply_audit(root, approved):
    root = Path(root).resolve()
    lock = root / 'gateway.lock'
    # Same exclusive lock as the metering gateway. Never remove its live lock.
    descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.write(descriptor, json.dumps({'pid': os.getpid(), 'purpose': 'offline receipt reconciliation'}).encode())
        os.close(descriptor)
        ledger_path = root / 'spend.json'
        original = ledger_path.read_bytes()
        ledger = json.loads(original)
        if any(r['status'] == 'pending' for r in ledger['records']):
            raise ValueError('Drain every admitted request before reconciliation.')
        fresh = audit(root, approved['datasets'])
        if fresh != approved:
            raise ValueError('Evidence changed; produce and review a fresh audit.')
        if any(not row['equalUsage'] for row in fresh['knownReceiptValidation']):
            raise ValueError('Matching rule disagrees with a known gateway receipt.')
        changes = {v['requestId']: v for v in fresh['verified']}
        if not changes:
            return {'applied': 0}
        for record in ledger['records']:
            proof = changes.get(record['id'])
            if proof is None:
                continue
            if known(record) or record.get('chargedUsd', record['reservedUsd']) != proof['priorReservedUsd']:
                raise ValueError('A candidate charge is no longer unknown and unchanged.')
            record.update(chargedUsd=proof['reconciledUsd'], costKnown=True, usage=proof['usage'],
                          pricingSource='runner-usage', receiptRecovery={
                              'source': 'persisted-runner-usage', 'priorChargedUsd': proof['priorReservedUsd'],
                              'requestSha256': proof['requestSha256'], 'receiptId': proof['receiptId'],
                              'assistantMessageId': proof['assistantMessageId']})
        ledger['committedUsd'] = sum(r.get('chargedUsd', r['reservedUsd']) for r in ledger['records'])
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '-' + uuid4().hex[:8]
        backup = root / ('spend-before-receipt-recovery-' + stamp + '.json')
        with backup.open('xb') as handle:
            os.chmod(backup, 0o600)
            handle.write(original)
        temp = root / ('spend-recovery-' + stamp + '.tmp')
        with temp.open('x') as handle:
            os.chmod(temp, 0o600)
            json.dump(ledger, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, ledger_path)
        return {'applied': len(changes), 'previousCommittedUsd': json.loads(original)['committedUsd'],
                'committedUsd': ledger['committedUsd'], 'backup': backup.name}
    finally:
        lock.unlink()


if __name__ == '__main__':
    root, output, *datasets = sys.argv[1:]
    if datasets == ['--apply']:
        print(json.dumps(apply_audit(root, json.loads(Path(output).read_text()))))
    else:
        if not datasets:
            raise ValueError('Name development datasets explicitly; use . for the original dataset.')
        result = audit(root, datasets)
        Path(output).write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({'verified': len(result['verified']), 'knownValidation': len(result['knownReceiptValidation']),
                          'knownMismatches': sum(not v['equalUsage'] for v in result['knownReceiptValidation']),
                          'reservationDifference': sum(v['priorReservedUsd'] - v['reconciledUsd'] for v in result['verified'])}))
