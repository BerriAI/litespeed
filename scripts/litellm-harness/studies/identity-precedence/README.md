# A passing training patch with a missing keep condition

This is supplemental **training evidence**, discovered after the original run. The Langfuse candidate passed all 60 original acceptance cases but omitted a condition stated in its task: keep a trace ID that differs from the session ID when the `langfuse_session_id` header does not equal that session ID.

A DeepSeek windowed critic proposed this gap. The six-case [probe](probe.py) confirmed it through `log_event_on_langfuse`, with a mocked Langfuse SDK and distinct trace, session and call IDs. Both DEFAULT and ERROR paths are covered.

| Implementation | Supplemental checks satisfied |
|---|---:|
| Starting snapshot | 2/6 |
| Recorded candidate, originally 60/60 | 4/6 |
| Human reference | 6/6 |

[Qualification outputs](qualification.json) retain each expected, transmitted and returned ID. Original acceptance tests, results and the frozen feature-removal study are unchanged. These new checks can inform subsequent training; they are not held-out evaluation results. The case does not establish that the reference is free of other bugs.

## Reproduce

[Task metadata](task.json) contains the base/reference commits and original acceptance selection. In an isolated checkout with the LiteLLM test dependencies installed, run `probe.py` with `PYTHONPATH` set to that checkout, `LITELLM_LOCAL_MODEL_COST_MAP=True`, and `PYTHON_DOTENV_DISABLED=1`. Apply [the recorded candidate patch](observed-candidate.patch) to a separate base checkout to reproduce its result. The probe prints per-case `pass` booleans; its process exit indicates execution errors, not whether every case passed.

No actual Langfuse requests are made. IDs are synthetic. This directory contains no private model traces, gateway configuration or credentials.
