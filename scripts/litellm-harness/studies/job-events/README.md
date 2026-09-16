# Stable early context with chronological command events

**Predeclared development experiment; not promoted.**

The host placed job-completion notifications in a session-context envelope before the original user request. Although the main system prompt and tool schema stayed stable, every completed job could replace this second message, invalidating cache reuse for all following tool history. In the retained Bedrock no-guides replay, adjacent raw request comparisons linked these changes to input receipts over 150,000 tokens with only approximately 4,500 cached. The existing `prefixChanged` diagnostic tracks system/tools shapes, so it did not flag this history-envelope change.

The [candidate patch](candidate.patch) freezes the initial envelope's job notice and records subsequent completion notices chronologically. It preserves job status visibility and original execution receipts. The change applies only to the LiteLLM-specific root loop. A real background-command regression verifies four once-only notices, stable early envelopes, chronological placement, and no new notice on the next turn. All 33 selected runner/job/cache/envelope tests and TypeScript checking pass.

The [plan](plan.json) compares two tasks, two repetitions and both arms, randomized under the same three-slot queue and 900-second protocol. Report activation, normal completion, raw acceptance, input/cache/output tokens, estimated cost and elapsed time. Bedrock's known error-wording oracle coupling remains disclosed. No session-affinity/provider change is included.

Adapter scope: this experiment uses the OpenAI-compatible chat adapter. Anthropic and Codex adapters hoist system-role events into their instruction prefix. Before promoting the mechanism, constrain this event-placement behavior to adapters that serialize it chronologically, or separately validate a compatible representation. The frozen candidate remains unchanged for its planned Flash trials.

A [compatible implementation](compatible-candidate.patch) is now prepared separately on the v34 runtime and is **not promoted**. Both job-drain locations limit chronological events to OpenAI-compatible providers. New real-background-job tests with mocked model responses verify that Anthropic and Codex keep completion notices in the latest user envelope, avoid persisted system events, and do not repeat the notice on the next turn. Both tests fail without the provider gate and pass with it; 29 selected tests and type checking pass. [The preparation record](compatible-candidate.json) distinguishes this implementation from the frozen paid study.

## Completed results: eight coding trials

Both arms pass 2/4 strict trials, all on MCP authentication. Mean elapsed time is 631.91 seconds for chronological notices versus 626.45 for control. Token-priced totals are $0.57158 versus $1.04509 across four runs each, a 45.3% reduction in this development sample. This is not an invoice, a general cost guarantee, or evidence of higher coding quality. [Full results](results.json).

| Task | Chronological notices | Control |
| --- | --- | --- |
| MCP authentication | 52/52 twice, normal completion; 382.27 / 480.94 seconds; $0.17197 total | 52/52 twice, normal completion; 545.40 / 548.82 seconds; $0.62452 total |
| Bedrock session tags | 24/34 at timeout (901.02 seconds), 26/34 with normal completion (763.41 seconds); $0.39961 total | 24/34 twice, normal completion; 674.05 / 737.52 seconds; $0.42057 total |

Bedrock's [tag-order contradiction](../bedrock-tag-order/README.md) and unstated error wording remain disclosed; neither scores nor timeout outcomes are replaced. The added timeout is a regression in normal completion, despite the lower total cost. Two development tasks are too few to establish performance across LiteLLM.

The independent [six-pair transport study](../prefix-position/README.md) is complete and supports the cache mechanism under controlled OK-only responses. The compatible implementation remains prepared for combined evaluation, not promoted from these results alone.

## Metering-gateway outage

The current plan explicitly replaces allocations affected by the verified gateway heap failure, regardless of their patch scores. [The outage audit](../gateway-memory/outage.json) records every original attempt and its admitted-request count; `plan-before-gateway-oom.json` preserves the previous identities. Source commits, tasks, effort, deadlines and concurrency are unchanged. Replacements use new `-oom1` labels. Original partial work, failed allocations and charges stay in the campaign-wide report; complete-pair summaries use the amended plan. These are infrastructure replacements, not selection of a better model attempt.
