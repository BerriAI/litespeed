"""Summarize only the trials named in a predeclared feature study.

Usage: study.py CAMPAIGN_DIRECTORY PLAN_JSON OUTPUT_JSON
Run analyze.py for each included dataset first. This script never traverses
unlisted datasets or selects a harness automatically. Interim pairs are labeled.
"""
from collections import defaultdict
import json
from pathlib import Path
import random
from statistics import mean
import sys


def supplemental_result(directory, specification):
    """Recompute host probe verdicts; never trust its process exit alone."""
    filename = specification['artifact']
    expected = specification['expectedChecks']
    if not isinstance(filename, str) or Path(filename).name != filename or filename in {'.', '..'}:
        raise ValueError('Supplemental artifact must be a filename inside the run directory.')
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 1:
        raise ValueError('Supplemental checks must have a positive expected count.')
    source = directory / filename
    if not source.exists():
        return None
    data = json.loads(source.read_text())
    checks = data.get('rows', [])
    passed = sum(row.get('pass') is True for row in checks)
    return {'artifact': filename, 'checks': len(checks), 'expectedChecks': expected,
            'checksPassed': passed, 'exit': data.get('exit'),
            'passed': data.get('exit') == 0 and len(checks) == expected and passed == expected}


def paired_summary(rows, repetitions, control='control'):
    groups = defaultdict(list)
    for row in rows:
        if row.get('evaluated'):
            groups[(row['dataset'], row['case'], row['name'])].append(row)
    variants = sorted({r['name'] for r in rows} - {control})
    cases = sorted({(r['dataset'], r['case']) for r in rows})
    comparisons = []
    for variant in variants:
        pairs = []
        for dataset, case in cases:
            baseline = groups[(dataset, case, control)]
            candidate = groups[(dataset, case, variant)]
            if len(baseline) != repetitions or len(candidate) != repetitions:
                continue
            pairs.append({'dataset': dataset, 'case': case,
                          'successDelta': mean(r['success'] for r in candidate) - mean(r['success'] for r in baseline),
                          'secondsDelta': mean(r['seconds'] for r in candidate) - mean(r['seconds'] for r in baseline)})
        entry = {'variant': variant, 'control': control, 'pairedTasks': len(pairs),
                 'expectedTasks': len(cases), 'complete': len(pairs) == len(cases), 'pairs': pairs}
        if pairs:
            deltas = [p['successDelta'] for p in pairs]
            rng = random.Random(17062026)
            # Resample tasks, keeping repeated attempts together. This remains
            # descriptive on a small development set, not a promotion test.
            samples = sorted(mean(rng.choices(deltas, k=len(deltas))) for _ in range(10000)) if len(pairs) > 1 else []
            entry.update(successDelta=mean(deltas), secondsDelta=mean(p['secondsDelta'] for p in pairs),
                         taskBootstrap95=[samples[249], samples[9749]] if samples else None)
            if not samples:
                entry['uncertaintyNote'] = 'One task cannot estimate variation between tasks; no bootstrap interval is reported.'
        comparisons.append(entry)
    return comparisons


def main():
    root, plan_path, output = map(Path, sys.argv[1:])
    root = root.resolve()
    plan = json.loads(plan_path.read_text())
    control = plan.get('control', 'control')
    if control not in {item['name'] for item in plan['runs']}:
        raise ValueError('Study must name a control variant present in its planned runs.')
    cache = {}
    rows = []
    identities = set()
    for item in plan['runs']:
        dataset = (root / item['dataset']).resolve()
        if not dataset.is_relative_to(root):
            raise ValueError('Study dataset must be inside the campaign directory.')
        if dataset not in cache:
            source = dataset / 'analysis.json'
            cache[dataset] = json.loads(source.read_text()) if source.exists() else []
        identity = (item['dataset'], item['case'], item['label'])
        if identity in identities:
            raise ValueError('Study contains a duplicate trial identity.')
        identities.add(identity)
        matches = [r for r in cache[dataset] if r['id'] == item['case'] and r['label'] == item['label']]
        if len(matches) > 1:
            raise ValueError('More than one allocated result for a predeclared trial.')
        row = {k: item[k] for k in ['dataset', 'case', 'name', 'label', 'commit', 'effort']}
        if 'kind' in item:
            row['kind'] = item['kind']
        timeout = item.get('timeoutSeconds', plan.get('timeoutSeconds'))
        if timeout is not None:
            if type(timeout) is not int or not 60 <= timeout <= 3600:
                raise ValueError('Study timeout must be an integer from 60 to 3600 seconds.')
            row['timeoutSeconds'] = timeout
        row['evaluated'] = False
        if matches:
            result = matches[0]
            if timeout is not None and result.get('timeoutSeconds') != timeout:
                raise ValueError('Trial timeout differs from its predeclared configuration.')
            if 'kind' in item and result.get('kind') != item['kind']:
                raise ValueError('Trial solver route differs from its predeclared configuration.')
            if result['harnessCommit'] != item['commit'] or result['evaluationProtocol'] != plan['protocol'] or result['effort'] != item['effort']:
                raise ValueError('Trial runtime/protocol differs from its predeclared configuration.')
            acceptance = result.get('acceptance')
            if acceptance is not None:
                row.update(evaluated=True, success=bool(result['completed'] and acceptance.get('passed')),
                           completed=result['completed'], completionReason=result.get('completionReason'),
                           seconds=result['seconds'], acceptance=acceptance,
                           computedUsd=result.get('computedUsd'), activations=result.get('activations'))
                specification = item.get('supplemental', plan.get('supplemental'))
                if specification:
                    row['originalSuccess'] = row['success']
                    directory = (dataset / 'runs' / result['run']).resolve()
                    if directory.parent != (dataset / 'runs').resolve():
                        raise ValueError('Result must identify one run directory.')
                    extra = supplemental_result(directory, specification)
                    row['supplemental'] = extra
                    row['evaluated'] = extra is not None
                    row['success'] = bool(row['originalSuccess'] and extra and extra['passed'])
        rows.append(row)
    summaries = []
    for name in sorted({r['name'] for r in rows}):
        selected = [r for r in rows if r['name'] == name and r['evaluated']]
        summary = {'variant': name, 'evaluated': len(selected), 'expected': sum(r['name'] == name for r in rows)}
        if selected:
            prices = [r['computedUsd'] for r in selected if r.get('computedUsd') is not None]
            summary.update(successes=sum(r['success'] for r in selected), meanSeconds=mean(r['seconds'] for r in selected),
                           tokenPricedUsd=sum(prices) if prices else None,
                           trialsWithoutTokenPrice=sum(r.get('computedUsd') is None for r in selected))
        summaries.append(summary)
    result = {'status': 'complete' if all(r['evaluated'] for r in rows) else 'interim',
              'note': 'Development selection only. Interim observed-task means can change as slower trials finish. Bootstrap resamples tasks, not attempts; it does not correct adaptive candidate selection or establish future generalization. Token prices exclude requests without usage and do not replace the campaign ledger.',
              'variants': summaries, 'comparisons': paired_summary(rows, plan['repetitions'], control), 'trials': rows}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': result['status'], 'variants': summaries,
                      'comparisons': [{k: v for k, v in p.items() if k != 'pairs'} for p in result['comparisons']]}))


if __name__ == '__main__':
    main()
