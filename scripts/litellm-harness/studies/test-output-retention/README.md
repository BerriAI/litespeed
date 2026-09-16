# Retain test diagnostics before filtering

**Complete; not promoted.** The [frozen plan](plan.json) compares one short instruction against the v45 harness on two known training tasks, with two repetitions per arm. Both arms use Medium reasoning, protocol 7, a 900-second deadline, the same dependencies and the shared three-solver queue. New work stops at an $86 committed balance to preserve comparison funds.

## Observed failure mechanism

The combined legacy-streaming trial `fc4cc74b` first ran a billing-test class with output piped to `tail`. That returned failure names without their underlying exceptions. It subsequently reran the class with `grep -A 20`, then again with another filter; the last run was interrupted at the task deadline. A separately selected test had passed, so investigating class-level behavior was reasonable. Discarding the initial diagnostics made that investigation unnecessarily depend on executing the tests again. This observation does not show that output retention would repair the patch's separate acceptance failures.

A [heuristic trace audit](trace-audit.json) finds 62 pairs across 40 development attempts where an identical pytest argument sequence was repeated with a different shell-output filter. It resets after structured edits or non-pytest shell commands. It is a lead for inspection: tests can mutate runtime state, reproducibility checks can be justified, and recorded call duration can exclude later background execution. These counts are not proven wasted calls or estimated time savings. Earlier protocol-6 attempts retain the disclosed runtime-artifact isolation limitation.

## Candidate

The [patch](candidate.patch) suggests `pytest --tb=short -q`, retaining full output in a temporary log before filtering, preserving the test exit status, and reading that log instead of re-executing an unchanged selection merely to change filters. Necessary reruns after edits or for a named reproducibility question remain allowed. No tool, permission, review, timeout or command-history behavior changes.

Type checking and 33 existing harness/runner/isolation tests pass. This validates integration, not the instruction's effect on model behavior. The experiment measures normal delivery and unchanged acceptance first, then elapsed time, token cost, output volume and filter-only reruns. Legacy streaming also requires the already qualified 24 real-adapter checks, declared before allocation. Router helper-name coupling and legacy inheritance wording retain their existing caveats. A reduction in the heuristic alone does not justify promotion.

Reconstruct the control at the pinned public main commit, apply the candidate patch on a separate checkout, install physical dependencies within each runtime, and use fresh trial labels with `batch.py` and `study.py`. Exact private worktree paths and raw model transcripts are excluded. No reserved evaluation task or outcome was used to prepare this comparison.

## First observed activation

The first completed candidate (`b21e08d3`, router strategy isolation) has eight pytest commands, all piped directly into `tail`, with no retained-log syntax detected. The instruction is present in its frozen harness source. It finishes normally in 580.96 seconds but passes 5/9 original checks; known early-return behavior is still missed. [Audit](first-activation-audit.json). This is one candidate observation, not a complete paired comparison or a causal verdict. It makes instruction adherence an explicit question for the remaining trials.

A second candidate (`c15168ea`, legacy streaming) has 12 pytest commands, all directly filtered, with no retained-log syntax detected. It times out with 14/16 original and 12/24 real-adapter checks. Across both observed candidates that is 20 filtered commands and zero detected log-retention commands. The instruction is verified in the **actual first and last outbound system messages** of both runs, not just in source. [Request-hash and command audit](activation-observations.json). This intermediate check confirmed delivery but not log retention; the remaining repetitions were pending then.

## Completed comparison and activation audit

| Arm | Strict successes | Mean seconds | Token-priced total | Timeouts |
|---|---:|---:|---:|---:|
| v45 control | 0/4 | 743.76 | $1.2272 | 1 |
| Retain-output instruction | 0/4 | 773.02 | $0.7971 | 2 |

All four router attempts finish normally with 5/9 original checks. Both legacy arms have repetitions scoring 8/24 and 12/24 on the real-adapter checks; neither delivers a fully correct result. Original legacy scores and each timeout remain in the [complete results](results.json). Zero successes in both arms is not proof of equivalent quality. The lower total price comes with longer mean execution and one extra timeout; this does not justify promotion on these two difficult tasks.

The [final command audit](activation-final.json) verifies the instruction in the first and last outbound system messages for **all four candidates**. It also identifies **partial adherence**: 26 of 35 candidate pytest invocations use `--tb=short`, compared with zero of 28 control invocations. Yet 33 candidate invocations still filter output directly. Only two candidate invocations retain a log, both late baseline checks in the first router repetition; both disable tracebacks with `--tb=no` and print rather than propagate the pytest exit status. One control invocation also retains a log. These counts exclude commands that merely search for or write pytest source.

Thus the instruction changed one command option but did not reliably preserve first-run diagnostics or improve complete-task correctness. The intended logging behavior and the correctness hypothesis remain unproven. Saved intermediate audits above retain their original scope; no old result or oracle is rewritten.
