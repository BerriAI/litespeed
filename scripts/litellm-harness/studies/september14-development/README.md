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


## Second completed pair: response call-ID header

Both arms finish normally and pass 5/5 frozen checks. Specialization takes 104.51 seconds and $0.0156; ordinary Litespeed takes 449.04 seconds and $0.0641. Their traces contain 26 and 61 tool calls respectively. The specialized patch resolves the requested precedence inline; the ordinary patch adds a small helper and additional type filtering. Its verification expands into streaming-disconnect billing checks, with failures and some later isolated passes. That difference is observed, but the broader failures have not been independently diagnosed here and the extra testing is not all proven waste. [Trace counts and measurements](header-pair-observations.json).

For reproducibility, the v46 runtime can be reconstructed from public PR commit `7faf6883c01fb0191412e03d1e60a2736ae93f39` and the [integration patch](../combined-candidate/integration-v46.patch). Use a fresh local commit/plan for replay. The recorded private experiment commit is an identity, not a required downloadable branch. The separate deadline study validates that public patch chain and adds its own replay-only configuration afterward.

## Team-organization visibility diagnostic

The third task finishes normally in both arms but scores **3/6** original checks: specialized **311.66 seconds / $0.04295**, plain **254.67 seconds / $0.03542**. Each failure comes from awaiting an unconfigured organization-table `MagicMock`. The reference tests supply the parent organization only as a relation on the team row; both candidates instead query that organization separately.

A [posthoc 22-case probe](team-organization-probe.py) supports both database paths consistently, including the relation only when requested. It invokes the actual decorated `/team/info` function, membership checks and organization-admin predicate. It substitutes database operations and user-object lookup, not the authorization decisions. The cases cover proxy/team/organization administrators, members and team keys; empty, sentinel and concrete model lists; absent organizations; unrelated users and organizations; and a key belonging to another team. Returned team identity and unchanged input data are also checked.

The historical base passes **3/22**, the merged reference **22/22**, and **both candidates 22/22**. Fresh snapshots, source verification, import-origin checks and disabled adjacent bytecode reuse are recorded in the [observations](team-organization-observations.json), alongside both candidate patches. This diagnoses the original three failures as tied to the test's database access path. The study's original scores remain **3/6**. No live database/authentication middleware or complete production-quality claim follows, and no harness instruction is added to imitate the joined query.

## Fourth completed pair: file-extension allowlist

Both arms finish normally and pass 8/8 frozen checks. Specialization takes 218.75 seconds and $0.03068; ordinary Litespeed takes 260.59 seconds and $0.07941. Across the first four of 17 task pairs, raw success outcomes match, but the context-restoration gap and organization-test coupling above still qualify those scores. Single attempts on this partial corpus do not establish final quality or stable speed advantages. [Interim results](results.json).
