"""Posthoc synthetic sweep; unchanged study scores remain authoritative.

Each input partitions full text into cached text, cache writes and full-rate
text, and full audio into cached/full-rate audio. This independent arithmetic
oracle covers valid generic billing inputs, not observed production invoices.
"""
import json
import math
import random

import litellm
from litellm.litellm_core_utils.llm_cost_calc.utils import generic_cost_per_token, get_token_type_cost_breakdown
from litellm.types.utils import PromptTokensDetailsWrapper, Usage

seed = 56160926
rng = random.Random(seed)
cases = [(1000, 0, 300, 0, 200), (0, 1000, 0, 500, 0),
         (1000, 1000, 0, 0, 200), (1000, 1000, 400, 600, 0)]
for _ in range(12):
    text = rng.randrange(1000, 200000)
    audio = rng.randrange(1000, 200000)
    cached_text = rng.randrange(text + 1)
    cached_audio = rng.randrange(audio + 1)
    writes = rng.randrange(text - cached_text + 1)
    cases.append((text, audio, cached_text, cached_audio, writes))

rows = []
for index, (text, audio, cached_text, cached_audio, writes) in enumerate(cases):
    total = text + audio
    assert 0 <= writes <= text - cached_text and 0 <= cached_audio <= audio
    high = total > 200000
    text_rate, cached_rate, write_rate = (6e-6, 6e-7, 7.5e-6) if high else (3e-6, 3e-7, 3.75e-6)
    for rate_name, audio_rate in [('fallback', None), ('zero', 0), ('explicit', 4e-7)]:
        model = f'offline-conservation-{index}-{rate_name}'
        litellm.model_cost[model] = {
            'input_cost_per_token': 3e-6, 'output_cost_per_token': 0,
            'input_cost_per_audio_token': 32e-6,
            'cache_read_input_token_cost': 3e-7,
            'cache_creation_input_token_cost': 3.75e-6,
            'input_cost_per_token_above_200k_tokens': 6e-6,
            'cache_read_input_token_cost_above_200k_tokens': 6e-7,
            'cache_creation_input_token_cost_above_200k_tokens': 7.5e-6,
            'litellm_provider': 'openai', 'mode': 'chat',
            **({'cache_read_input_audio_token_cost': audio_rate} if audio_rate is not None else {}),
        }
        usage = Usage(prompt_tokens=total, completion_tokens=0, total_tokens=total,
                      prompt_tokens_details=PromptTokensDetailsWrapper(
                          text_tokens=text, audio_tokens=audio, cached_tokens=cached_text + cached_audio,
                          cache_creation_tokens=writes,
                          cached_tokens_details={'text_tokens': cached_text, 'audio_tokens': cached_audio}))
        before = usage.model_dump()
        expected_cache = cached_text * cached_rate + cached_audio * (cached_rate if audio_rate is None else audio_rate)
        expected = (text - cached_text - writes) * text_rate + (audio - cached_audio) * 32e-6 + expected_cache + writes * write_rate
        row = {'name': f'partition-{index}-{rate_name}', 'case': index, 'audioRate': rate_name,
               'input': {'text': text, 'audio': audio, 'cachedText': cached_text, 'cachedAudio': cached_audio, 'writes': writes},
               'highContextTier': high, 'expectedInputCost': expected, 'expectedCacheReadCost': expected_cache}
        try:
            actual = generic_cost_per_token(model=model, usage=usage, custom_llm_provider='openai')[0]
            breakdown = get_token_type_cost_breakdown(model=model, usage=usage, custom_llm_provider='openai')
            unchanged = usage.model_dump() == before
            row.update(inputCost=actual, cacheReadCost=breakdown.cache_read_cost, inputsUnchanged=unchanged,
                       passedArithmetic=math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-12)
                           and math.isclose(breakdown.cache_read_cost, expected_cache, rel_tol=1e-9, abs_tol=1e-12))
            row['pass'] = row['passedArithmetic'] and unchanged
        except Exception as error:
            row.update({'pass': False, 'error': type(error).__name__})
        rows.append(row)
print(json.dumps(rows))
