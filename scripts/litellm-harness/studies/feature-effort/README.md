# Reasoning effort on multi-module training tasks

[Plan](plan.json) fixes the v24 harness at `c7e6826341989fd6ebf3588b53901087b2fa7a56` and compares Medium/High twice each on four [curated training tasks](catalog.json). Each run has the same 900-second limit and shares the campaign's three solver slots. This extends training coverage to async AWS signing and guardrail pipelines across several modules; it is not reserved evaluation.

## Environment qualification

The [original qualification](qualification-original.json) identified missing shared fixtures for streaming guardrail tests. The offline runner deliberately disables automatic conftest discovery, which also hid a local fixture needed by these tasks. The repaired profile explicitly loads the existing `tests.test_litellm.proxy.utils.proxy_logging.conftest` module for both solvers and scorers. The fixture is unchanged by each reference PR, its source is hashed, and scoring restores the captured copy. Other root fixture setup stays disabled.

The [current qualification](qualification-current.json) retains all six candidates, including two still excluded for collection failures. Four qualify:

| Task | Base failures | Reference passes |
|---|---:|---:|
| Async AWS signing | 4/5 | 5/5 |
| Stream tool-call count changes | 4/4 | 4/4 |
| Background Responses pipelines | 4/7 | 7/7 |
| Legacy hooks in streaming pipelines | 15/16 | 16/16 |

For background retrieval, direct tests of a newly introduced helper were excluded before solver runs; tests of existing request-processing and logging entrypoints remain. New helper imports in the two rejected tasks still prevent meaningful base qualification, so neither is run.

## Task curation and interpretation

DeepSeek drafted requirements from the public PR and selected tests. A curator checked and corrected those drafts before any solver attempt. [The audit](curation-audit.json) records corrections, including a nonexistent marker-class requirement and a new directly tested interface that the draft had omitted. Exact warning fragments asserted by tests are stated in the tasks. These are retrospective, curated specifications rather than original pre-merge issues.

Reconstruct the dataset using `prepare.py` with this catalog, then qualify it with `validate.py` and the installed LiteLLM dependencies. Use the declared fixture profiles and one shared gateway ledger. Compare only complete task-paired repetitions, retain failed/time-limited attempts, and inspect behavior beyond self-written tests. These tasks share the guardrail family; four tasks do not represent four independent areas of LiteLLM.
