"""Attribute recorded assistant usage to its chosen next action, not causal savings.

A request pays for its complete input and output. Grouping it by the tools its
reply requests does not mean those tools caused all that cost. The campaign's
fixed token prices provide an estimate; the gateway ledger remains authoritative.
Raw commands, source, arguments and reasoning are never returned here.
"""
import math

NAVIGATION = {'read_file', 'grep', 'glob', 'litellm_context', 'list_files'}
EDITS = {'edit_file', 'write_file', 'apply_patch'}
POLLING = {'bash_output', 'wait'}


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def measured(usage):
    if not isinstance(usage, dict) or not all(number(usage.get(k)) for k in ['inputTokens', 'outputTokens']):
        return None
    cached = usage.get('cachedTokens', 0)
    if not number(cached) or cached > usage['inputTokens']:
        return None
    return {'inputTokens': usage['inputTokens'], 'cachedTokens': cached,
            'outputTokens': usage['outputTokens'],
            'estimatedUsd': ((usage['inputTokens'] - cached) * 0.22 + cached * 0.007 + usage['outputTokens'] * 0.66) / 1e6,
            'cacheUnreportedRequests': int('cachedTokens' not in usage)}


def action(call):
    name = call.get('name')
    if name in NAVIGATION:
        return 'navigation'
    if name in EDITS:
        return 'structured-edit'
    if name in POLLING:
        return 'job-poll-or-wait'
    if name == 'bash':
        return 'check-command' if call.get('execution', {}).get('checkKey') else 'shell-command'
    return 'other-tool'


def action_usage(messages, breakdown):
    groups = {}
    missing = 0
    for message in messages:
        if message.get('role') != 'assistant':
            continue
        usage = measured(message.get('usage'))
        if usage is None:
            missing += 1
            continue
        families = {action(c) for c in message.get('toolCalls', [])}
        family = next(iter(families)) if len(families) == 1 else ('mixed-tools' if families else 'text-only')
        row = groups.setdefault(family, {'requests': 0, 'inputTokens': 0, 'cachedTokens': 0,
            'outputTokens': 0, 'estimatedUsd': 0, 'cacheUnreportedRequests': 0,
            'reportedModelSeconds': 0, 'durationUnreportedRequests': 0})
        row['requests'] += 1
        for key, value in usage.items():
            row[key] += value
        duration = message['usage'].get('durationMs')
        if number(duration):
            row['reportedModelSeconds'] += duration / 1000
        else:
            row['durationUnreportedRequests'] += 1
    # No request identifier links these two sources. Reconcile totals only;
    # never silently assign compaction, missing, or canceled usage to a tool.
    units = [u for record in breakdown if (u := measured(record.get('usage'))) is not None]
    reconciliation = {}
    for field in ['inputTokens', 'cachedTokens', 'outputTokens', 'estimatedUsd']:
        recorded = sum(u[field] for u in units)
        attributed = sum(row[field] for row in groups.values())
        reconciliation[field] = {'recorded': recorded, 'attributed': attributed, 'difference': recorded - attributed}
    return {'basis': 'complete assistant request grouped by chosen next action; not tool marginal cost',
            'pricing': {'inputPerMillionUsd': 0.22, 'cachedPerMillionUsd': 0.007, 'outputPerMillionUsd': 0.66},
            'groups': groups, 'assistantMessagesWithoutValidUsage': missing,
            'breakdownRecordsWithoutValidUsage': len(breakdown) - len(units),
            'reconciliation': reconciliation}
