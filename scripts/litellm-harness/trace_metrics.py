"""Measure observed harness activation, without inferring causality from a score."""
import json


def activations(messages, calls):
    starting = [m.get('content', '') for m in messages if m['role'] == 'system'
                and m.get('content', '').startswith('LiteLLM starting locations')]
    # Different runner versions use success/done/completed. Parse the payload
    # itself, rather than treating a missing status spelling as non-activation.
    contexts = [c.get('output', '') for c in calls if c['name'] == 'litellm_context']
    guide_ids = set()
    malformed = 0
    for text in starting + contexts:
        if '<workspace_reference>\n' in text:
            text = text.split('<workspace_reference>\n', 1)[1].split('\n</workspace_reference>', 1)[0]
        try:
            payload = json.loads(text)
        except (ValueError, TypeError):
            malformed += 1
            continue
        if isinstance(payload, dict):
            for card in payload.get('playbooks', []):
                if isinstance(card, dict) and isinstance(card.get('id'), str):
                    guide_ids.add(card['id'])
    reads = [c for c in calls if c['name'] == 'read_file']
    system = [m.get('content', '') for m in messages if m['role'] == 'system']
    return {
        'initialMapNotices': len(starting),
        'contextToolCalls': len(contexts),
        'guideIdsShown': sorted(guide_ids),
        'unparsedContextPayloads': malformed,
        'finalReviewNotices': sum(s.startswith('LiteLLM change review.') for s in system),
        'testFocusNotices': sum(s.startswith('LiteLLM verification checkpoint:') for s in system),
        'explorationFocusNotices': sum(s.startswith('LiteLLM exploration checkpoint:') for s in system),
        'defaultWindowReadCalls': sum('limit' not in c.get('args', {}) for c in reads),
        'explicitWindowReadCalls': sum('limit' in c.get('args', {}) for c in reads),
    }
