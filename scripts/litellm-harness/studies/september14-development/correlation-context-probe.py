"""Posthoc lifecycle observations, not replacement acceptance checks.

Exercise actual Logging/CustomStreamWrapper objects. The disabled-to-enabled
case changes a process flag explicitly; the sync-to-async case keeps it enabled.
Run through the host probe_runner.py with an explicit historical snapshot.
"""
import asyncio
from datetime import datetime
import json
from unittest.mock import patch

import litellm
import litellm._logging as logging_module
from litellm._logging import session_id_var, trace_id_var
from litellm.litellm_core_utils.litellm_logging import Logging
from litellm.litellm_core_utils.streaming_handler import CustomStreamWrapper


def make_logging(name, *, supported=True):
    return Logging(
        model="gpt-4o", messages=[], stream=True, call_type="acompletion",
        start_time=datetime.now(), litellm_call_id=name, function_id=name,
        litellm_trace_id=name + "-trace", kwargs={"litellm_session_id": name + "-session"},
        supports_correlation_logging=supported,
    )


def current():
    return [trace_id_var.get(), session_id_var.get()]


def reset():
    trace_id_var.set("outer-trace")
    session_id_var.set("outer-session")


async def main():
    rows = []
    reset()
    litellm.request_correlation_in_logs = False
    with patch.object(logging_module, "_sanitize_correlation_id", wraps=logging_module._sanitize_correlation_id) as sanitize:
        disabled = make_logging("disabled")
        rows.append({"name": "disabled-construction", "pass": current() == ["outer-trace", "outer-session"] and sanitize.call_count == 0,
                     "context": current(), "sanitizeCalls": sanitize.call_count})
    reset()
    litellm.request_correlation_in_logs = True
    enabled = make_logging("enabled")
    stamped = current()
    with patch.object(logging_module, "_sanitize_correlation_id", wraps=logging_module._sanitize_correlation_id) as sanitize:
        enabled._restore_correlation_context()
        rows.append({"name": "enabled-restore-without-resanitizing", "pass": stamped == ["enabled-trace", "enabled-session"] and current() == ["outer-trace", "outer-session"] and sanitize.call_count == 0,
                     "context": current(), "sanitizeCalls": sanitize.call_count})

    for case, flag, supported in [("disabled-then-enabled", False, True), ("sync-then-async", True, False)]:
        reset()
        litellm.request_correlation_in_logs = flag
        older = make_logging("older", supported=supported)
        wrapper = CustomStreamWrapper(completion_stream=iter(()), model="gpt-4o", logging_obj=older, custom_llm_provider="openai")
        litellm.request_correlation_in_logs = True
        newer = make_logging("newer")
        before = current()
        await wrapper.aclose()
        after = current()
        rows.append({"name": case + ":older-stream-close", "pass": before == after == ["newer-trace", "newer-session"],
                     "before": before, "after": after})
        # Claim context again so the guarded-finalizer observation stands alone.
        newer_again = make_logging("newer-after-close")
        before_finalizer = current()
        wrapper.__del__()
        after_finalizer = current()
        rows.append({"name": case + ":guarded-finalizer", "pass": before_finalizer == after_finalizer == ["newer-after-close-trace", "newer-after-close-session"],
                     "before": before_finalizer, "after": after_finalizer})
        del wrapper, older, newer, newer_again
    del disabled, enabled
    print(json.dumps(rows))


asyncio.run(main())
