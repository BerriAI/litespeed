# Group exact edits to reduce model round trips

This predeclared 12-trial development study compares v28 with grouped edits in v29: three qualified multi-module tasks, two repetitions, two variants, Medium reasoning and a 900-second deadline. Seed 29160926 randomizes the trial order. All datasets share the same three solver slots. Task fixtures and acceptance selections are frozen in the [feature-effort dataset](../feature-effort/README.md).

A single `edit_file` call can contain 1–32 ordered replacements in one file. Every match and intermediate size limit is checked before writing. One failed match leaves the file unchanged. Existing path checks, permissions, hooks, concurrent-edit checks and Undo remain in the same execution path. Only the LiteLLM architecture advertises and enables the array. Terminal approvals list all edits, and previews share the execution calculation.

[The complete patch](batched-edits.patch) and [plan](plan.json) pin the experiment. Correct normal completion is primary; cost, elapsed time, request counts and actual batch activation are secondary. This is development selection, not a held-out comparison. The frozen control is v28; grouped edits remain experimental. The hypothesis came from a Bedrock trace with 58 edits across 16 files and 576 seconds of model time; that trace is motivation, not a causal estimate. The three study tasks avoid its known acceptance-wording coupling.

Before any study trial, 208 focused tool, runner, permission, hook and terminal tests plus type checking and a production build passed. A synthetic Flash gateway call accepted the schema and emitted two grouped replacements in one call; it is only a compatibility check.

Subsequent audits found additional oracle limits in these tasks. Two background controls' original 6/7 scores include [router/request test-double coupling](../background-router-oracle/README.md); qualified real-router diagnostics pass, so a candidate's raw 7/7 is not by itself a demonstrated behavior improvement. A legacy candidate's 14/16 timeout includes [an inherited-hook contract difference](../feature-effort/legacy-inheritance/README.md) under ambiguous “own hook” wording. Preserve normal-completion failures and original scores while considering these diagnostics separately. Grouped edits do not resolve a mistaken or underspecified semantic contract by themselves.

The second grouped-edit background attempt (`d25104ed`) finishes normally at 6/7. A real router and request still fail the internal pre-call-stage test, but the [qualified outer-entrypoint check](../background-router-oracle/README.md#follow-up-testing-the-full-processing-entrypoint) passes both retrieval attachment and submission exclusion. Its patch attaches immediately after pre-call processing, before the upstream request. Raw 7/7 versus 6/7 again does not isolate a user-facing quality difference.

## Metering-gateway outage

The current plan explicitly replaces allocations affected by the verified gateway heap failure, regardless of their patch scores. [The outage audit](../gateway-memory/outage.json) records every original attempt and its admitted-request count; `plan-before-gateway-oom.json` preserves the previous identities. Source commits, tasks, effort, deadlines and concurrency are unchanged. Replacements use new `-oom1` labels. Original partial work, failed allocations and charges stay in the campaign-wide report; complete-pair summaries use the amended plan. These are infrastructure replacements, not selection of a better model attempt.

The [posthoc real-adapter audit](../feature-effort/legacy-inheritance/README.md#real-adapter-checks-on-other-mechanism-trials) retains the distinction between semantically passing patches at cancellation and normal delivery. It does not replace this study’s original endpoint or deadline.

## Completed component comparison

All 12 declared attempts are scored. Grouped edits have 3/6 normally completed patches passing every original check versus the control's 2/6, with mean elapsed time 626.96 versus 690.01 seconds and recorded token-priced cost $1.2904 versus $1.8730. All three task-paired mean times are lower for the candidate. Its saved traces contain 44 completed grouped-edit calls. [Full results](results.json).

The raw quality difference is entirely on background retrieval, whose test-double and internal-stage assertions reject patches that pass the qualified real-entrypoint diagnostics above. Neither arm delivers a normally completed legacy-stream patch satisfying the original oracle. The last grouped attempt (`b8cb7b87`) finishes at 770.09 seconds with 12/16 original checks; the separate 24-case real-adapter probe passes 11/24. It misses inherited hooks and loses the direct Responses rewrite. The other grouped legacy attempt passes 12/24 real cases at timeout; both controls pass 24/24 at timeout. [Retained diagnostics](../feature-effort/legacy-inheritance/mechanism-probes.json).

The component has encouraging cost and elapsed-time evidence on three known tasks, with substantial uncertainty and no demonstrated semantic quality advantage from the raw 3/6 versus 2/6 score. It proceeds to the already frozen combined-candidate comparison; these results do not automatically promote it. Frozen attempts retain the [protocol-6 runtime-artifact limitation](../runtime-artifact-isolation/README.md).
