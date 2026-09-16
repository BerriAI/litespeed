"""Measure observed harness activation, without inferring causality from a score."""
import json
from collections import Counter


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
    batches = [c for c in calls if c['name'] == 'edit_file' and isinstance(c.get('args', {}).get('edits'), list)]
    system = [m.get('content', '') for m in messages if m['role'] == 'system']
    review_guides = set()
    guided_reviews = 0
    for text in system:
        marker = 'Relevant repository lessons for this final audit: '
        if text.startswith('LiteLLM change review.') and marker in text:
            try:
                cards = json.loads(text.split(marker, 1)[1].split('\n', 1)[0])
                if isinstance(cards, list):
                    ids = {card['id'] for card in cards if isinstance(card, dict) and isinstance(card.get('id'), str)}
                    review_guides.update(ids)
                    guided_reviews += bool(ids)
            except (ValueError, TypeError):
                pass
    return {
        'initialMapNotices': len(starting),
        'contextToolCalls': len(contexts),
        'guideIdsShown': sorted(guide_ids),
        'unparsedContextPayloads': malformed,
        'finalReviewNotices': sum(s.startswith('LiteLLM change review.') for s in system),
        'guidedFinalReviewNotices': guided_reviews,
        'finalReviewGuideIdsShown': sorted(review_guides),
        'batchedEditCalls': len(batches),
        'completedBatchedEditCalls': sum(c.get('status') == 'completed' for c in batches),
        'batchEditsRequested': sum(len(c['args']['edits']) for c in batches),
        'batchSizes': [len(c['args']['edits']) for c in batches],
        'backgroundCommandNotices': sum(s.startswith('Background command completion:') for s in system),
        'testFocusNotices': sum(s.startswith('LiteLLM verification checkpoint:') for s in system),
        'explorationFocusNotices': sum(s.startswith('LiteLLM exploration checkpoint:') for s in system),
        # The runner fills the default BEFORE saving tool arguments. Historical
        # traces cannot distinguish a model-selected limit from that default.
        'readCallsByEffectiveLimit': dict(Counter(str(c.get('args', {}).get('limit', 'missing')) for c in reads)),
        'defaultWindowReadCalls': None,
        'readLimitProvenance': 'unknown: saved arguments include host-injected defaults',
    }
