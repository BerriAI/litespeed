# Fireworks session-affinity transport pilot

**Predeclared synthetic cache measurement; no coding-quality claim.**

[Fireworks documents](https://docs.fireworks.ai/guides/prompt-caching) a stable `user` request field or `x-session-affinity` header as a replica-routing hint. The campaign's local accounting gateway forwards the body but drops the application's `x-litellm-session-id` header. This establishes a missing hint, not the cause of any individual cache miss. A separate [job-event experiment](../job-events/README.md) addresses demonstrated early-history changes.

The [plan](plan.json) uses two source sizes, three repetitions, twelve conversation rounds and two arms: omit `user` or supply a stable opaque value. Each scenario obtains one global slot; its two arms are interleaved in randomized order. Unique leading nonces prevent cross-arm prefix warming. The same public pre-merge training source, no-reasoning setting, deterministic temperature and 64-token output ceiling apply to both arms. Report post-initial cache/input ratios, input-cost estimates and request elapsed time, with warm-up separately. This is not a solver result or a guarantee of production cache behavior.

The [interim results](results.json) include only complete paired scenarios in comparisons. The two completed pairs (480,000 source characters, repetition 3; 160,000 characters, repetition 1) have approximately 99.86% and 99.60% post-initial cache reuse respectively in both arms. The affinity-arm ratio differences are below 0.003 percentage points, with input-cost differences below $0.000003 per scenario. These pairs do not yet support a useful affinity improvement on this gateway. Remaining planned repetitions are still queued/running. Missing cache measurements stay unknown, and failed/truncated responses remain visible.

Regenerate the export with `cache_study.py PRIVATE_PILOT_DIRECTORY results.json`; source text and nonce values are not exported.

## Gateway outage amendment

Three paired scenarios completed before the campaign gateway exhausted its heap. The next scenario (`160000-r3`) failed to connect on its first request, with no gateway admission. Its original request marker is retained. Plan revision 2 gives that entire pair a new `oom1` attempt prefix and nonce, continues the two untouched scenarios, and retains the three completed pairs. The summarizer reads only the explicitly declared attempt for each pair; it cannot mix original and replacement receipts. [Gateway diagnosis and recovery](../gateway-memory/README.md).
