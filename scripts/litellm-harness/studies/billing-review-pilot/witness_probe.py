"""Check the delivered reviewer examples, not the original selection oracle."""
import json
import math
import litellm
from litellm.types.utils import Usage, PromptTokensDetailsWrapper
from litellm.litellm_core_utils.llm_cost_calc.utils import generic_cost_per_token, get_token_type_cost_breakdown

rows = []
for name, text, audio, cached, split, expected, expected_cache, audio_rate in [
    ('generic-cap-order-example', 116, 167, 1, {'text_tokens': 64, 'audio_tokens': 128}, 115 * 4e-6 + 167 * 32e-6 + 4e-7, 4e-7, 4e-7),
    ('generic-absent-audio-rate-example', 0, 100, 100, {'audio_tokens': 100}, 100 * 4e-7, 100 * 4e-7, None),
    ('conservation-original-example', 116, 167, 192, {'text_tokens': 64, 'audio_tokens': 128}, 0.0015328, 192 * 4e-7, 4e-7),
]:
    litellm.model_cost[name] = {
        'input_cost_per_token': 4e-6, 'output_cost_per_token': 0,
        'input_cost_per_audio_token': 32e-6, 'cache_read_input_token_cost': 4e-7,
        'litellm_provider': 'openai', 'mode': 'chat',
        **({'cache_read_input_audio_token_cost': audio_rate} if audio_rate is not None else {}),
    }
    usage = Usage(prompt_tokens=text + audio, completion_tokens=0, total_tokens=text + audio,
                  prompt_tokens_details=PromptTokensDetailsWrapper(text_tokens=text, audio_tokens=audio,
                  cached_tokens=cached, cached_tokens_details=split))
    actual = generic_cost_per_token(model=name, usage=usage, custom_llm_provider='openai')[0]
    breakdown = get_token_type_cost_breakdown(model=name, usage=usage, custom_llm_provider='openai')
    rows.append({'name': name, 'inputCost': actual, 'expectedInputCost': expected,
                 'cacheReadCost': breakdown.cache_read_cost, 'expectedCacheReadCost': expected_cache,
                 'pass': math.isclose(actual, expected, rel_tol=1e-9, abs_tol=1e-12)
                         and math.isclose(breakdown.cache_read_cost, expected_cache, rel_tol=1e-9, abs_tol=1e-12)})
print(json.dumps(rows))
