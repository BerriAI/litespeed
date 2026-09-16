# September 14 development corpus

These are additional development tasks, not the reserved final comparison. The selection was declared from Git metadata before reading PR bodies: first-parent changes dated September 11–14 UTC, 1–4 production Python files, 1–3 Python test files, and 20–450 changed lines. All 21 matching changes landed September 14.

The [preparation plan](preparation-plan.json) retains every candidate. The [catalog](catalog.json) freezes retrospective requirements and test exclusions before qualification and before any model allocation. Requirements come from public PRs and acceptance behavior, not original pre-merge issue reports. The recorded reference is the merged patch; authorship is not assumed to be human.

Each case gets an answer-free base snapshot and separate reference tests. Qualification requires an actual failing base assertion with no collection/setup errors and a passing merged reference with positive checks. Four known new-symbol import risks remain explicit; no compatibility shims are added to make the base collect. Excluded tests and narrower backend-only scope are recorded. Qualification is necessary but does not establish that tests are complete or implementation-independent.

Qualification runs one case at a time under the shared grader lock; network and credentials are unavailable. Source, catalog, fixtures, and selected nodes are hashed. Qualification completed on all 21 cases: **17 qualified**, four excluded for test imports of newly introduced symbols. [Results](qualification.json), [exclusions](excluded.json). The [comparison plan](plan.json) was frozen before allocation: every qualified task gets one ordinary Litespeed/Flash run and one LiteLLM-specific/Flash run, both on the same prepared v46 runtime with Medium reasoning and a 900-second limit. It uses 34 attempts, randomized paired ordering, the shared three-slot queue, and stops queuing additional trials at $82 committed to preserve final-comparison funds. The prior [intent](comparison-intent.json) fixes selection and settings before qualification finished. The September 15 final corpus remains reserved and unread. This development corpus advances the training cutoff to September 14. The September 15 final comparison must disclose that cutoff. One attempt per arm measures task breadth but cannot estimate within-task variance; these selected regressions do not represent all production work.


## First completed pair: context logging

Both arms finish normally and pass all 19 frozen reference checks. Specialization takes 394.10 seconds at $0.0653 in token-priced usage; ordinary Litespeed takes 775.11 seconds at $0.2396. This is one paired development task, not a reliable estimate of the architecture's speed or quality.

Patch inspection reveals a difference the original checks do not measure. The ordinary patch makes restoration a no-op for a Logging instance that never stamped context; the specialized patch initially adds that guard at recorded step 52, then removes it at step 66 while adapting pre-existing tests. These observations identify the sequence, not a causal effect of any particular harness instruction. The merged reference also lacks that guard.

A posthoc [six-observation probe](correlation-context-probe.py) constructs actual Logging and CustomStreamWrapper objects and closes an older stream after a newer call claims the context. It covers an explicit disabled-to-enabled flag transition and a sync-to-async sequence with the flag continuously enabled. Both expose stale-context restoration in the base, merged reference and specialized patch; the ordinary patch preserves the newer call's context. Both patches and the reference preserve it through the separately tested guarded finalizer.

| Snapshot | Probe observations satisfied | Frozen reference checks |
|---|---:|---:|
| Historical base | 2/6 | Failing qualification |
| Merged reference | 4/6 | 19/19 |
| Specialized Flash | 4/6 | 19/19 |
| Ordinary Flash | 6/6 | 19/19 |

[Exact observations and provenance](correlation-context-observations.json), [specialized patch](correlation-specialized.patch), [ordinary patch](correlation-plain.patch). All four processes verify every LiteLLM import comes from the explicit snapshot, disable adjacent bytecode reuse, and run without network or credentials. Base/reference production source is byte-compared with the recorded Git revisions. Reproduce using the shared [probe runner](../../probe_runner.py) and the recorded snapshots.

The merged reference fails two observations, so this is **not a qualified replacement oracle**. The close-order behavior already fails on the historical base; it is a residual lifecycle gap, not evidence of a regression introduced by the specialized patch. Both candidates keep their original 19/19 scores. This prevents equating agreement with the merged patch with complete correctness, or treating the lower-cost first result as uniformly better.
