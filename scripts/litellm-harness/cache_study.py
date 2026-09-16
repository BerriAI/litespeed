"""Export the predeclared cache pilot; compare complete paired scenarios only."""
from pathlib import Path
import json
import re
from statistics import mean
import sys
from action_usage import number


def aggregate(rows):
    valid = []
    for row in rows:
        usage = row.get('usage') or {}
        tokens = usage.get('prompt_tokens')
        cached = (usage.get('prompt_tokens_details') or {}).get('cached_tokens')
        seconds = row.get('seconds')
        if number(tokens) and number(cached) and cached <= tokens and number(seconds):
            valid.append((tokens, cached, seconds))
    complete = len(valid) == len(rows) and bool(rows)
    tokens, cached = sum(x[0] for x in valid), sum(x[1] for x in valid)
    return {'requests': len(rows), 'validMeasurements': len(valid), 'completeMeasurements': complete,
            'inputTokens': tokens if complete else None, 'cachedTokens': cached if complete else None,
            'cacheRatio': cached / tokens if complete and tokens else None,
            'inputEstimatedUsd': ((tokens - cached) * .22 + cached * .007) / 1e6 if complete else None,
            'meanSeconds': mean(x[2] for x in valid) if complete else None,
            'allResponsesOK': all(r.get('responseIsOK') is True and r.get('finishReason') == 'stop' for r in rows) if rows else None}


def summarize(directory):
    directory = Path(directory)
    plan = json.loads((directory / 'plan.json').read_text())
    control_name = plan.get('control', 'omitted-user')
    candidate_name = plan.get('candidate', 'stable-user')
    if control_name == candidate_name or set(plan['arms']) != {control_name, candidate_name}:
        raise ValueError('Declare exactly one control and one different candidate arm.')
    trials, pairs = [], []
    for size in plan['targetSourceCharacters']:
        for rep in range(1, plan['repetitions'] + 1):
            arms = {}
            attempt = plan.get('scenarioAttempts', {}).get(f'{size}-r{rep}', '')
            if not isinstance(attempt, str) or (attempt and not re.fullmatch('[a-z0-9-]+', attempt)):
                raise ValueError('Scenario attempt must be a path-safe declared label.')
            suffix = f'-{attempt}' if attempt else ''
            for arm in plan['arms']:
                rows = []
                for step in range(plan['roundsPerArm']):
                    path = directory / f'{size}-r{rep}{suffix}-{arm}-step{step:02d}.result.json'
                    if not path.exists():
                        continue
                    row = json.loads(path.read_text())
                    if (row.get('sourceCharacters'), row.get('rep'), row.get('arm'), row.get('round')) != (size, rep, arm, step):
                        raise ValueError('Result identity differs from its planned scenario.')
                    rows.append(row)
                entry = {'sourceCharacters': size, 'rep': rep, 'arm': arm,
                         'attempt': attempt or 'original',
                         'completedRequests': len(rows), 'expectedRequests': plan['roundsPerArm'],
                         'warmup': aggregate([r for r in rows if r['round'] == 0]),
                         'postInitial': aggregate([r for r in rows if r['round'] > 0])}
                entry['complete'] = len(rows) == plan['roundsPerArm'] and entry['warmup']['completeMeasurements'] and entry['postInitial']['completeMeasurements']
                trials.append(entry)
                arms[arm] = entry
            if all(a['complete'] for a in arms.values()):
                control, candidate = arms[control_name]['postInitial'], arms[candidate_name]['postInitial']
                pairs.append({'sourceCharacters': size, 'rep': rep,
                              'cacheRatioDelta': candidate['cacheRatio'] - control['cacheRatio'] if candidate['cacheRatio'] is not None and control['cacheRatio'] is not None else None,
                              'inputEstimatedUsdDelta': candidate['inputEstimatedUsd'] - control['inputEstimatedUsd'],
                              'meanSecondsDelta': candidate['meanSeconds'] - control['meanSeconds']})
    return {'status': 'complete' if all(r['complete'] for r in trials) else 'interim',
            'scope': f'Synthetic transport pilot. Deltas are {candidate_name} minus {control_name} within each source-size/repetition. Warm-up is separate. Only complete paired scenarios enter comparisons. No coding-quality or production cache guarantee; request latencies share a live service and are not independent samples.',
            'trials': trials, 'comparisons': pairs}


if __name__ == '__main__':
    Path(sys.argv[2]).write_text(json.dumps(summarize(sys.argv[1]), indent=2) + '\n')
