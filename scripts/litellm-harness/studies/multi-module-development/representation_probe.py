"""Posthoc observations: zero versus absent cached-image counts and billing.

The frozen four-check aggregation oracle remains unchanged. Use an explicit
snapshot with probe_runner.py; this is no replacement for that study's score.
"""
from copy import deepcopy
import json
import math

from litellm.cost_calculator import RealtimeAPITokenUsageProcessor
from litellm.litellm_core_utils.llm_cost_calc.utils import generic_cost_per_token
from litellm.types.utils import PromptTokensDetailsWrapper, Usage


def field(value, name):
    return value.get(name) if isinstance(value, dict) else getattr(value, name, None)


def event(total, text, audio, cached, split):
    return {"type": "response.done", "response": {"usage": {
        "input_tokens": total, "output_tokens": 0, "total_tokens": total,
        "input_token_details": {"text_tokens": text, "audio_tokens": audio,
                                "cached_tokens": cached, "cached_tokens_details": split},
    }}}


rates = {"input_cost_per_token": 0.000004, "output_cost_per_token": 0.000008,
         "input_cost_per_audio_token": 0.000032, "input_cost_per_image_token": 0.000012,
         "cache_read_input_token_cost": 0.0000004, "cache_read_input_audio_token_cost": 0.0000004}


def price(usage):
    return generic_cost_per_token(model="offline-probe", custom_llm_provider="openai", usage=usage, model_info=rates)[0]


rows = []
for mode in ["absent", "zero"]:
    split = {"text_tokens": 64, "audio_tokens": 128}
    if mode == "zero":
        split["image_tokens"] = 0
    usage = Usage(prompt_tokens=283, completion_tokens=0, total_tokens=283,
                  prompt_tokens_details=PromptTokensDetailsWrapper(text_tokens=116, audio_tokens=167,
                                                                  cached_tokens=192, cached_tokens_details=split))
    actual = price(usage)
    rows.append({"name": "billing-cached-image-" + mode, "pass": math.isclose(actual, 0.0015328, abs_tol=1e-12),
                 "actualCost": actual, "expectedCost": 0.0015328})

inputs = [event(283, 116, 167, 192, {"text_tokens": 64, "audio_tokens": 128}),
          event(150, 50, 100, 100, {"audio_tokens": 100})]
before = deepcopy(inputs)
combined = RealtimeAPITokenUsageProcessor.collect_and_combine_usage_from_realtime_stream_results(results=inputs)
details = field(combined, "prompt_tokens_details")
split = field(details, "cached_tokens_details")
values = {name: field(split, name) for name in ["text_tokens", "audio_tokens", "image_tokens"]}
rows.append({"name": "aggregate-token-values", "pass": values["text_tokens"] == 64 and values["audio_tokens"] == 228
             and values["image_tokens"] in (None, 0) and inputs == before,
             "observed": values, "inputsUnchanged": inputs == before})
actual = price(combined)
expected = 102 * rates["input_cost_per_token"] + 39 * rates["input_cost_per_audio_token"] + 292 * rates["cache_read_input_token_cost"]
rows.append({"name": "aggregate-input-billing", "pass": math.isclose(actual, expected, abs_tol=1e-12),
             "actualCost": actual, "expectedCost": expected})

for order in ["split-first", "split-last"]:
    without_split = event(150, 50, 100, 100, {})
    del without_split["response"]["usage"]["input_token_details"]["cached_tokens_details"]
    partial = [deepcopy(inputs[0]), without_split]
    if order == "split-last":
        partial.reverse()
    before_partial = deepcopy(partial)
    usage = RealtimeAPITokenUsageProcessor.collect_and_combine_usage_from_realtime_stream_results(results=partial)
    nested = field(field(usage, "prompt_tokens_details"), "cached_tokens_details")
    values = {name: field(nested, name) for name in ["text_tokens", "audio_tokens", "image_tokens"]}
    rows.append({"name": "partial-" + order, "pass": values["text_tokens"] == 64 and values["audio_tokens"] == 128
                 and values["image_tokens"] in (None, 0) and partial == before_partial,
                 "observed": values, "inputsUnchanged": partial == before_partial})

# Explicit image information must still be carried, not normalized away.
images = [event(3, 1, 1, 2, {"text_tokens": 1, "image_tokens": 1}),
          event(5, 2, 1, 3, {"text_tokens": 1, "image_tokens": 2})]
before_images = deepcopy(images)
combined_images = RealtimeAPITokenUsageProcessor.collect_and_combine_usage_from_realtime_stream_results(results=images)
nested = field(field(combined_images, "prompt_tokens_details"), "cached_tokens_details")
rows.append({"name": "explicit-cached-image-sum", "pass": field(nested, "image_tokens") == 3 and images == before_images,
             "cachedImage": field(nested, "image_tokens"), "inputsUnchanged": images == before_images})
print(json.dumps(rows))
