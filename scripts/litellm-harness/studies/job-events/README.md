# Stable early context with chronological command events

**Predeclared development experiment; not promoted.**

The host placed job-completion notifications in a session-context envelope before the original user request. Although the main system prompt and tool schema stayed stable, every completed job could replace this second message, invalidating cache reuse for all following tool history. In the retained Bedrock no-guides replay, adjacent raw request comparisons linked these changes to input receipts over 150,000 tokens with only approximately 4,500 cached. The existing `prefixChanged` diagnostic tracks system/tools shapes, so it did not flag this history-envelope change.

The [candidate patch](candidate.patch) freezes the initial envelope's job notice and records subsequent completion notices chronologically. It preserves job status visibility and original execution receipts. The change applies only to the LiteLLM-specific root loop. A real background-command regression verifies four once-only notices, stable early envelopes, chronological placement, and no new notice on the next turn. All 33 selected runner/job/cache/envelope tests and TypeScript checking pass.

The [plan](plan.json) compares two tasks, two repetitions and both arms, randomized under the same three-slot queue and 900-second protocol. Report activation, normal completion, raw acceptance, input/cache/output tokens, estimated cost and elapsed time. Bedrock's known error-wording oracle coupling remains disclosed. No session-affinity/provider change is included.

Adapter scope: this experiment uses the OpenAI-compatible chat adapter. Anthropic and Codex adapters hoist system-role events into their instruction prefix. Before promoting the mechanism, constrain this event-placement behavior to adapters that serialize it chronologically, or separately validate a compatible representation. The frozen candidate remains unchanged for its planned Flash trials.
