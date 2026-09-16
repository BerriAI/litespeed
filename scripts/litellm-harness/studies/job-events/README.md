# Stable early context with chronological command events

**Predeclared development experiment; not promoted.**

The host placed job-completion notifications in a session-context envelope before the original user request. Although the main system prompt and tool schema stayed stable, every completed job could replace this second message, invalidating cache reuse for all following tool history. In the retained Bedrock no-guides replay, adjacent raw request comparisons linked these changes to input receipts over 150,000 tokens with only approximately 4,500 cached. The existing `prefixChanged` diagnostic tracks system/tools shapes, so it did not flag this history-envelope change.

The [candidate patch](candidate.patch) freezes the initial envelope's job notice and records subsequent completion notices chronologically. It preserves job status visibility and original execution receipts. The change applies only to the LiteLLM-specific root loop. A real background-command regression verifies four once-only notices, stable early envelopes, chronological placement, and no new notice on the next turn. All 33 selected runner/job/cache/envelope tests and TypeScript checking pass.

The [plan](plan.json) compares two tasks, two repetitions and both arms, randomized under the same three-slot queue and 900-second protocol. Report activation, normal completion, raw acceptance, input/cache/output tokens, estimated cost and elapsed time. Bedrock's known error-wording oracle coupling remains disclosed. No session-affinity/provider change is included.

Adapter scope: this experiment uses the OpenAI-compatible chat adapter. Anthropic and Codex adapters hoist system-role events into their instruction prefix. Before promoting the mechanism, constrain this event-placement behavior to adapters that serialize it chronologically, or separately validate a compatible representation. The frozen candidate remains unchanged for its planned Flash trials.

A [compatible implementation](compatible-candidate.patch) is now prepared separately on the v34 runtime and is **not promoted**. Both job-drain locations limit chronological events to OpenAI-compatible providers. New real-background-job tests with mocked model responses verify that Anthropic and Codex keep completion notices in the latest user envelope, avoid persisted system events, and do not repeat the notice on the next turn. Both tests fail without the provider gate and pass with it; 29 selected tests and type checking pass. [The preparation record](compatible-candidate.json) distinguishes this implementation from the frozen paid study.

## Result interpretation

The first appended-job Bedrock trial has high cache reuse but times out. Its raw
24/34 includes the separately documented [tag-order contradiction](../bedrock-tag-order/README.md)
and six unstated error-wording requirements. These diagnostics do not change the
frozen scores, count the timeout as completion, or establish a quality benefit.

Both appended-job MCP-auth repetitions finish normally with 52/52 checks (382.27 and 480.94 seconds; token-priced costs $0.0738 and $0.0982). The completed control repetition finishes in 545.40 seconds with 52/52 at $0.3122. The other control repetition is still pending. These partial observations are promising, but differences in task length and provider caching require complete matched reporting; the candidate remains unpromoted.

## Metering-gateway outage

The current plan explicitly replaces allocations affected by the verified gateway heap failure, regardless of their patch scores. [The outage audit](../gateway-memory/outage.json) records every original attempt and its admitted-request count; `plan-before-gateway-oom.json` preserves the previous identities. Source commits, tasks, effort, deadlines and concurrency are unchanged. Replacements use new `-oom1` labels. Original partial work, failed allocations and charges stay in the campaign-wide report; complete-pair summaries use the amended plan. These are infrastructure replacements, not selection of a better model attempt.
