# Fireworks session-affinity transport pilot

**Predeclared synthetic cache measurement; no coding-quality claim.**

[Fireworks documents](https://docs.fireworks.ai/guides/prompt-caching) a stable `user` request field or `x-session-affinity` header as a replica-routing hint. The campaign's local accounting gateway forwards the body but drops the application's `x-litellm-session-id` header. This establishes a missing hint, not the cause of any individual cache miss. A separate [job-event experiment](../job-events/README.md) addresses demonstrated early-history changes.

The [plan](plan.json) uses two source sizes, three repetitions, twelve conversation rounds and two arms: omit `user` or supply a stable opaque value. Each scenario obtains one global slot; its two arms are interleaved in randomized order. Unique leading nonces prevent cross-arm prefix warming. The same public pre-merge training source, no-reasoning setting, deterministic temperature and 64-token output ceiling apply to both arms. Report post-initial cache/input ratios, input-cost estimates and request elapsed time, with warm-up separately. This is not a solver result or a guarantee of production cache behavior.
