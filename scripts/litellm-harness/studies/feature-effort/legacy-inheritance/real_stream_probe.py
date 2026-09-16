"""Host diagnostic: legacy hooks through actual chat, Messages and Responses translators.

Run with probe_runner.py against an explicit base/reference/candidate snapshot.
No model calls, external services, reference-only helper names or fake translators.
"""
import asyncio
import copy
import json

import litellm
from fastapi import HTTPException
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm.llms.openai.chat.guardrail_translation.handler import OpenAIChatCompletionsHandler
from litellm.llms.anthropic.chat.guardrail_translation.handler import AnthropicMessagesHandler
from litellm.llms.openai.responses.guardrail_translation.handler import OpenAIResponsesHandler
from litellm.proxy.policy_engine.pipeline_executor import PipelineExecutor
from litellm.types.proxy.policy_engine.pipeline_types import PipelineStep
from litellm.types.utils import ModelResponseStream


class LegacyHook(CustomGuardrail):
    def __init__(self, action):
        super().__init__(guardrail_name="probe", event_hook="post_call", default_on=True)
        self.action = action
        self.seen = []

    async def async_post_call_success_hook(self, data, user_api_key_dict, response):
        # Snapshot at hook entry: later write-back may mutate the same object.
        self.seen.append(copy.deepcopy(response))
        if self.action == "block":
            raise HTTPException(status_code=400, detail="probe blocked")
        if self.action == "error":
            raise RuntimeError("probe failed")
        if self.action == "none":
            return None
        replacement = copy.deepcopy(response)
        if isinstance(replacement, dict) and "output" in replacement:
            replacement["output"][0]["content"][0]["text"] = "rewritten"
        elif isinstance(replacement, dict):
            replacement["content"] = [{"type": "text", "text": "rewritten"}]
        else:
            replacement.choices[0].message.content = "rewritten"
        return replacement


class InheritedNativeHook(LegacyHook):
    use_native_lifecycle_hooks = True

    async def apply_guardrail(self, inputs, request_data, input_type, logging_obj=None):
        raise AssertionError("Native lifecycle hook must not use the unified interface")


def chunks():
    return [ModelResponseStream(id="chatcmpl-probe", model="offline-model", created=1,
                choices=[{"index": 0, "delta": {"role": "assistant", "content": "hello world"}, "finish_reason": None}]),
            ModelResponseStream(id="chatcmpl-probe", model="offline-model", created=1,
                choices=[{"index": 0, "delta": {"content": ""}, "finish_reason": "stop"}])]


def message_chunks():
    events = [
        ("message_start", {"type": "message_start", "message": {"id": "msg_probe", "type": "message", "role": "assistant", "model": "offline-model", "content": [], "stop_reason": None, "usage": {"input_tokens": 1, "output_tokens": 0}}}),
        ("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
        ("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "hello world"}}),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 2}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return [f"event: {event}\ndata: {json.dumps(data)}\n\n".encode() for event, data in events]


def stream_text(stream, route):
    if route == "chat":
        return "".join(c.choices[0].delta.content or "" for c in stream)
    if route == "responses":
        return "".join(c.get("delta", "") for c in stream if c.get("type") == "response.output_text.delta")
    return "".join(json.loads(line[6:]).get("delta", {}).get("text", "")
        for chunk in stream for line in (chunk.decode() if isinstance(chunk, bytes) else chunk).splitlines()
        if line.startswith("data: "))


def response_chunks():
    output = {"id": "msg_probe", "type": "message", "role": "assistant", "status": "completed",
        "content": [{"type": "output_text", "text": "hello world", "annotations": []}]}
    return [{"type": "response.output_text.delta", "output_index": 0, "content_index": 0,
             "item_id": "msg_probe", "delta": "hello world", "sequence_number": 1},
            {"type": "response.completed", "sequence_number": 2, "response": {
                "id": "resp_probe", "object": "response", "status": "completed", "model": "offline-model", "output": [output]}}]


def native_response_shape(original, route):
    if route == "chat":
        return isinstance(original, litellm.ModelResponse) and original.choices[0].message.content == "hello world"
    if route == "responses":
        return isinstance(original, dict) and original.get("object") == "response" and original.get("output", [{}])[0].get("content") == [{"type": "output_text", "text": "hello world", "annotations": []}]
    return (isinstance(original, dict) and original.get("type") == "message" and original.get("role") == "assistant"
        and original.get("stop_reason") == "end_turn" and original.get("content") == [{"type": "text", "text": "hello world"}]
        and original.get("usage", {}).get("input_tokens") == 1 and original.get("usage", {}).get("output_tokens") == 2)


async def main():
    rows = []
    for route, translation, make_chunks, call_type in [
        ("chat", OpenAIChatCompletionsHandler, chunks, "completion"),
        ("messages", AnthropicMessagesHandler, message_chunks, "anthropic_messages"),
        ("responses", OpenAIResponsesHandler, response_chunks, "responses")]:
        for cls in [LegacyHook, InheritedNativeHook]:
            for action in ["rewrite", "none", "block", "error"]:
                callback, stream = cls(action), make_chunks()
                litellm.callbacks = [callback]
                try:
                    result = await PipelineExecutor.execute_steps(
                        steps=[PipelineStep(guardrail="probe", on_pass="allow", on_fail="block", on_error="block")],
                        mode="post_call", data={"model": "offline-model"}, user_api_key_dict=None,
                        call_type=call_type, policy_name="probe-policy", streaming_chunks=stream,
                        endpoint_translation=translation())
                    text = stream_text(stream, route)
                    expected_text = "rewritten" if action == "rewrite" else "hello world"
                    expected_action = "block" if action in ["block", "error"] else "allow"
                    expected_outcome = {"block": "fail", "error": "error"}.get(action, "pass")
                    outcomes = [step.outcome for step in result.step_results]
                    original = callback.seen[0] if callback.seen else None
                    native_shape = native_response_shape(original, route)
                    passed = len(callback.seen) == 1 and native_shape and text == expected_text and result.terminal_action == expected_action and outcomes == [expected_outcome]
                    rows.append({"name": route + ":" + cls.__name__ + ":" + action, "pass": passed,
                        "hookCalls": len(callback.seen), "nativeShape": native_shape, "text": text,
                        "terminalAction": result.terminal_action, "outcomes": outcomes})
                except Exception as error:
                    rows.append({"name": route + ":" + cls.__name__ + ":" + action, "pass": False, "error": type(error).__name__ + ": " + str(error)})
    print(json.dumps(rows))


asyncio.run(main())
