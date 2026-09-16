# Does more execution time deliver a usable fix?

This eight-trial development experiment compares 900-second and 1800-second limits on two known difficult tasks: team-member budget recovery and legacy streaming pipelines. Both arms use exactly the same integrated v46 runtime, Flash Medium, protocol 7 and dependencies. They differ only in the host execution deadline. The task prompt does not tell the model it has extra time.

The [frozen plan](plan.json) declares two repetitions per arm and task, seeded order, the shared three-slot queue and an $78 committed ceiling for queuing additional trials. Selection follows observed timeouts, including a prior streaming candidate whose final patch passed the real-adapter probe at its deadline. This is deliberately a diagnosis of difficult development work; it cannot estimate future task quality or a general speed advantage.

Normal completion and unchanged reference acceptance are required. Streaming additionally requires all 24 previously qualified real-adapter checks. Original scores, incomplete deliveries and implementation-coupled oracle caveats remain visible. Compare complete repeated task pairs, and report absolute time and price beside quality: extending a limit is useful only if the resulting work justifies its cost and delay.

The [replay-only configuration patch](replay-config.patch) applies to the pinned v46 integration commit. It validates an explicit `LITELLM_EVAL_TIMEOUT_SECONDS` before allocating a trial; old defaults remain 900 or 600 seconds. Product code and ordinary product turns are unchanged. The launcher records the actual timeout, and the current study exporter rejects a result with a different declared limit. Type checking and four focused TypeScript tests pass on both checkouts; all 41 Python workbench tests pass. No frozen earlier study has been modified.

Reconstruct the runtime from the recorded base and patch, install its physical dependencies, then set the per-trial timeout from the plan while invoking the shared workbench's `batch.py`. Replacements must use new identities and retain any interrupted attempt. The reserved September 15 corpus remains unused.
