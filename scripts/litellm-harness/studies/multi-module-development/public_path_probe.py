"""Posthoc scope check for the two second-repetition reference failures.

Uses existing billing entrypoints, with explicit synthetic historical rates.
Original acceptance is unchanged; rate metadata is recorded separately from cost.
"""
import json
import math
import litellm
from litellm.litellm_core_utils.llm_cost_calc.utils import (
    generic_cost_per_token, get_billed_token_rates, get_token_type_cost_breakdown,
)
from litellm.types.utils import CacheCreationTokenDetails, PromptTokensDetailsWrapper, Usage

rows = []
rates = {
    'input_cost_per_token': 3e-6, 'output_cost_per_token': 15e-6,
    'input_cost_per_audio_token': 32e-6,
    'cache_read_input_token_cost': 3e-7, 'cache_creation_input_token_cost': 3.75e-6,
    'input_cost_per_token_above_200k_tokens': 6e-6,
    'output_cost_per_token_above_200k_tokens': 3e-5,
    'cache_read_input_token_cost_above_200k_tokens': 6e-7,
    'cache_creation_input_token_cost_above_200k_tokens': 7.5e-6,
    'litellm_provider': 'openai', 'mode': 'chat',
}

for name, audio_rate in [('text-only', None), ('audio-fallback', None), ('audio-free', 0), ('audio-explicit', 4e-7)]:
    model = 'offline-public-path-' + name
    litellm.model_cost[model] = {**rates, **({'cache_read_input_audio_token_cost': audio_rate} if audio_rate is not None else {})}
    with_audio = name != 'text-only'
    details = {'cached_tokens': 200_000, 'cache_creation_tokens': 10_000}
    if with_audio:
        details.update(text_tokens=150_000, audio_tokens=100_000,
                       cached_tokens_details={'text_tokens': 120_000, 'audio_tokens': 80_000})
    usage = Usage(prompt_tokens=250_000, completion_tokens=0, total_tokens=250_000,
                  prompt_tokens_details=PromptTokensDetailsWrapper(**details))
    expected_cache = (120_000 * 6e-7 + 80_000 * (6e-7 if audio_rate is None else audio_rate)) if with_audio else 200_000 * 6e-7
    expected_input = ((20_000 * 6e-6 + 20_000 * 32e-6) if with_audio else 40_000 * 6e-6) + expected_cache + 10_000 * 7.5e-6
    try:
        actual = generic_cost_per_token(model=model, usage=usage, custom_llm_provider='openai')[0]
        breakdown = get_token_type_cost_breakdown(model=model, usage=usage, custom_llm_provider='openai')
        billed = get_billed_token_rates(model=model, usage=usage, custom_llm_provider='openai')
        rows.append({'name':name, 'pass':math.isclose(actual,expected_input,abs_tol=1e-12)
                     and math.isclose(breakdown.cache_read_cost,expected_cache,abs_tol=1e-12),
                     'inputCost':actual, 'expectedInputCost':expected_input,
                     'cacheReadCost':breakdown.cache_read_cost, 'expectedCacheReadCost':expected_cache,
                     'reportedCachedAudioRate':getattr(billed,'cache_read_input_audio_token_cost',None)})
    except Exception as error:
        rows.append({'name':name,'pass':False,'error':type(error).__name__})

model = 'offline-ephemeral-cache'
litellm.model_cost[model] = {'input_cost_per_token':3e-6,'output_cost_per_token':0,
                           'cache_creation_input_token_cost':3.75e-6,
                           'cache_creation_input_token_cost_above_1hr':6e-6,
                           'litellm_provider':'openai','mode':'chat'}
usage = Usage(prompt_tokens=0, completion_tokens=0, total_tokens=0,
              prompt_tokens_details=PromptTokensDetailsWrapper(cache_creation_tokens=0,
                cache_creation_token_details=CacheCreationTokenDetails(ephemeral_5m_input_tokens=100,ephemeral_1h_input_tokens=200)))
try:
    actual = generic_cost_per_token(model=model,usage=usage,custom_llm_provider='openai')[0]
    breakdown = get_token_type_cost_breakdown(model=model,usage=usage,custom_llm_provider='openai')
    rows.append({'name':'ephemeral-creation-public-path','pass':math.isclose(actual,0.001575,abs_tol=1e-12)
                 and math.isclose(breakdown.cache_creation_cost,0.001575,abs_tol=1e-12),
                 'inputCost':actual,'creationCost':breakdown.cache_creation_cost,'expectedCost':0.001575})
except Exception as error:
    rows.append({'name':'ephemeral-creation-public-path','pass':False,'error':type(error).__name__})
print(json.dumps(rows))
