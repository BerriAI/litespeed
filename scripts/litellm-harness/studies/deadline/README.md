# Does more execution time deliver a usable fix?

**Infrastructure interruption:** 5 unaffected evaluated allocations; 3 allocations affected by the [host-sleep/transport incident](../host-sleep-transport/README.md). Original scores remain in `variants` and `trials`; `qualityEligibleVariants` and paired comparisons exclude every incident allocation regardless of score. No replacements have been substituted. Paid admission is paused.

This eight-trial development experiment compares 900-second and 1800-second limits on two known difficult tasks: team-member budget recovery and legacy streaming pipelines. Both arms use exactly the same integrated v46 runtime, Flash Medium, protocol 7 and dependencies. They differ only in the host execution deadline. The task prompt does not tell the model it has extra time.

The [frozen plan](plan.json) declares two repetitions per arm and task, seeded order, the shared three-slot queue and an $78 committed ceiling for queuing additional trials. Selection follows observed timeouts, including a prior streaming candidate whose final patch passed the real-adapter probe at its deadline. This is deliberately a diagnosis of difficult development work; it cannot estimate future task quality or a general speed advantage.

Normal completion and unchanged reference acceptance are required. Streaming additionally requires all 24 previously qualified real-adapter checks. Original scores, incomplete deliveries and implementation-coupled oracle caveats remain visible. Compare complete repeated task pairs, and report absolute time and price beside quality: extending a limit is useful only if the resulting work justifies its cost and delay.

The [replay-only configuration patch](replay-config.patch) applies to the pinned v46 integration commit. It validates an explicit `LITELLM_EVAL_TIMEOUT_SECONDS` before allocating a trial; old defaults remain 900 or 600 seconds. Product code and ordinary product turns are unchanged. The launcher records the actual timeout, and the current study exporter rejects a result with a different declared limit. Type checking and four focused TypeScript tests pass on both checkouts; all 41 Python workbench tests pass. No frozen earlier study has been modified.

The original experiment commit identifies a private frozen branch; reproducing it does not require that branch. Start from public PR commit `7faf6883c01fb0191412e03d1e60a2736ae93f39`, apply the [v46 integration patch](../combined-candidate/integration-v46.patch), then apply this study's replay configuration patch. A fresh archive reconstruction byte-matches all 335 checked application/test/runtime files and dependency manifests. [Validation and patch hashes](reconstruction-validation.json). Historical report helpers and archives differ; use the current main workbench for report export.

Install physical dependencies within the reconstructed runtime, then set the per-trial timeout from the plan while invoking the shared workbench's `batch.py`. Record the reconstructed commit under fresh labels in a new local plan; preserve the original plan. Replacements must use new identities and retain any interrupted attempt. The reserved September 15 corpus remains unused.

## First pair observed

The first team-member-budget repetition passes all five checks and finishes normally in both arms: **529.54 seconds / $0.09644** with the standard limit and **642.56 seconds / $0.09841** with the extended limit. Both finish before 900 seconds, so this pair supplies no evidence that additional time caused a success. The second repetitions remain pending. [Interim results](results.json).

## First streaming pair observed

The standard-limit attempt times out at 900.14 seconds ($0.16732); the extended-limit attempt finishes normally at 1,032.97 seconds ($0.24743). Both pass 13/16 original checks and 12/24 real-adapter checks. Extra time allows delivery in this pair, but does not satisfy the declared completion criterion. All 12 failed real-adapter checks exercise inherited hooks; the supplied wording about a subclass’s “own” hooks leaves that requirement ambiguous, as the earlier inheritance audit records. These failures should not be described as 12 independently established public defects. This is one attempt per arm on a known difficult task, with the second repetitions still pending.
