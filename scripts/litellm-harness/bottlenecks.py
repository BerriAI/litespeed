"""Summarize observed request cost from an already public development export.

Usage: bottlenecks.py RESULTS_JSON OUTPUT_JSON OUTPUT_MARKDOWN
No private traces or reserved datasets are opened. Categories describe the next
action chosen by a whole model request; they do not estimate a tool's causal cost.
"""
from collections import Counter, defaultdict
import json
from pathlib import Path
from statistics import median
import sys


def summarize(source):
    rows = [r for r in source['runs'] if r.get('evaluationProtocol') == 6
            and r.get('kind') == 'litellm-specific' and (r.get('requests') or 0) > 0
            and r.get('computedUsd') is not None]
    if not rows or any((r.get('actionUsage') or {}).get('classificationVersion') != 2 for r in rows):
        raise ValueError('Rebuild all included action measurements with classification version 2.')
    groups = defaultdict(Counter)
    fields = ['requests', 'estimatedUsd', 'inputTokens', 'cachedTokens', 'outputTokens',
              'reportedModelSeconds', 'durationUnreportedRequests', 'cacheUnreportedRequests']
    for row in rows:
        for name, values in row['actionUsage']['groups'].items():
            groups[name].update({key: values[key] for key in fields})
    attributed = sum(g['estimatedUsd'] for g in groups.values())
    recorded = sum(r['computedUsd'] for r in rows)
    return {'sourceGeneratedAt': source['generatedAt'], 'classificationVersion': 2,
            'scope': 'Descriptive protocol-6 development attempts with recorded Flash usage. Different tasks, candidate versions and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.',
            'runs': len(rows), 'completionReasons': dict(Counter(r['completionReason'] for r in rows)),
            'runIds': [r['run'] for r in rows], 'recordedTokenPricedUsd': recorded,
            'attributedTokenPricedUsd': attributed, 'unattributedTokenPricedUsd': recorded - attributed,
            'groups': dict(sorted(groups.items(), key=lambda item: -item[1]['estimatedUsd'])),
            'timing': {key: {'measuredRuns': len(values), 'medianSeconds': median(values) if values else None}
                for key in ['modelSeconds', 'toolActiveSeconds', 'timeToFirstEditSeconds']
                for values in [[r[key] for r in rows if isinstance(r.get(key), (int, float))]]}}


def render(data):
    count = sum(row['requests'] for row in data['groups'].values())
    cost = data['attributedTokenPricedUsd']
    names = {'shell-command': 'Other shell requests', 'shell-mentions-checks': 'Shell requests mentioning check tools',
             'check-command': 'Shell requests with a recognized check key', 'navigation': 'Source navigation',
             'structured-edit': 'Structured edits', 'job-poll-or-wait': 'Job polling or waiting',
             'text-only': 'Text-only replies', 'mixed-tools': 'Mixed tool families', 'other-tool': 'Other tools'}
    lines = ['# Where development requests spend tokens', '', f'Snapshot: {data["sourceGeneratedAt"]}. **{data["runs"]} protocol-6 attempts**, with ${data["recordedTokenPricedUsd"]:.4f} recorded token-priced usage.', '',
             data['scope'], '',
             'Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.', '',
             '| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |',
             '|---|---:|---:|---:|---:|---:|']
    for name, row in data['groups'].items():
        cached = f'{row["cachedTokens"] / row["inputTokens"]:.1%}' if row['inputTokens'] and not row['cacheUnreportedRequests'] else 'Unknown'
        lines.append(f'| {names.get(name, name)} | {row["requests"]:,} | {row["requests"]/count:.1%} | ${row["estimatedUsd"]:.4f} | {row["estimatedUsd"]/cost:.1%} | {cached} |')
    lines += ['', f'Unattributed recorded cost: ${data["unattributedTokenPricedUsd"]:.6f}. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).', '',
              '## Timing', '', '| Measurement | Runs with measurement | Median seconds |', '|---|---:|---:|']
    labels = {'modelSeconds': 'Recorded model-request duration', 'toolActiveSeconds': 'Union of active tool intervals', 'timeToFirstEditSeconds': 'First recorded edit attempt'}
    for key, row in data['timing'].items():
        value = f'{row["medianSeconds"]:.1f}' if row['medianSeconds'] is not None else 'Unknown'
        lines.append(f'| {labels[key]} | {row["measuredRuns"]} | {value} |')
    lines += ['', 'These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.', '',
              '## Experiments addressing the observed costs', '',
              '- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.',
              '- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.',
              '- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.',
              '- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.', '',
              'Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.']
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    source, output, markdown = map(Path, sys.argv[1:])
    result = summarize(json.loads(source.read_text()))
    output.write_text(json.dumps(result, indent=2) + '\n')
    markdown.write_text(render(result))
