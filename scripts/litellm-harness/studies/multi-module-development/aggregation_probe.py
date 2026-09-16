"""Predeclared semantic probe without importing the reference's new type."""
from copy import deepcopy
import json

from litellm.cost_calculator import RealtimeAPITokenUsageProcessor
from litellm.types.utils import PromptTokensDetailsWrapper, Usage


def event(total, text, audio, cached, split=None):
    details = {"text_tokens": text, "audio_tokens": audio, "cached_tokens": cached}
    if split is not None:
        details["cached_tokens_details"] = split
    return {"type": "response.done", "response": {"usage": {
        "input_tokens": total, "output_tokens": 0, "total_tokens": total,
        "input_token_details": details,
    }}}


def field(value, key):
    return value.get(key) if isinstance(value, dict) else getattr(value, key, None)


with_split = event(283, 116, 167, 192, {"text_tokens": 64, "audio_tokens": 128})
cases = [
    ("two-splits", [with_split, event(150, 50, 100, 100, {"audio_tokens": 100})], 228),
    ("split-then-absent", [with_split, event(150, 50, 100, 100)], 128),
    ("absent-then-split", [event(150, 50, 100, 100), with_split], 128),
]
rows = []
for name, inputs, expected_audio in cases:
    inputs = deepcopy(inputs)
    before = deepcopy(inputs)
    usage = RealtimeAPITokenUsageProcessor.collect_and_combine_usage_from_realtime_stream_results(results=inputs)
    details = field(usage, "prompt_tokens_details")
    split = field(details, "cached_tokens_details")
    observed = {
        "prompt": field(usage, "prompt_tokens"), "total": field(usage, "total_tokens"),
        "cached": field(details, "cached_tokens"), "cachedText": field(split, "text_tokens"),
        "cachedAudio": field(split, "audio_tokens"), "cachedImage": field(split, "image_tokens"),
    }
    expected = {"prompt": 433, "total": 433, "cached": 292,
                "cachedText": 64, "cachedAudio": expected_audio, "cachedImage": None}
    rows.append({"name": name, "pass": observed == expected and inputs == before,
                 "observed": observed, "expected": expected, "inputsUnchanged": inputs == before})

details = Usage(prompt_tokens=10, completion_tokens=5, total_tokens=15,
                prompt_tokens_details=PromptTokensDetailsWrapper(text_tokens=10)).prompt_tokens_details
absent_dict = "cached_tokens_details" not in details.model_dump()
absent_json = "cached_tokens_details" not in json.loads(details.model_dump_json())
rows.append({"name": "absent-split-serialization", "pass": absent_dict and absent_json,
             "omittedFromDict": absent_dict, "omittedFromJson": absent_json})
print(json.dumps(rows))
