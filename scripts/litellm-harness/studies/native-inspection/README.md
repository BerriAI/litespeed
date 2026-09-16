# Native inspection preference — predeclared training study

Status: candidate only. The production harness remains v34.

A legacy-stream training replay made 55 Bash calls, many just to search source. Foreground Bash commands acquire before-and-after bounded workspace snapshots for history even when the command is read-only. Built-in `grep`, `glob`, `read_file` and `litellm_context` already provide focused inspection without these command snapshots.

The candidate adds one preference to the existing system instructions: use available inspection tools for routine source reading, scope searches, and retain Bash for executable probes, tests, pipelines and operations the inspection tools cannot express. Permissions, snapshots, history, tools and model settings are unchanged. The candidate does not classify shell commands as safe or skip their snapshots.

## Read-only mechanism check

[`microbenchmark.json`](microbenchmark.json) records five alternating pairs on the same live LiteLLM checkout, searching one term in `litellm/router.py`. Both routes returned the same first ten matching lines; the native tool also returned a truncation notice. Native search median: 14.44 ms. Search plus two bounded snapshots median: 1,148.23 ms. This approximates the snapshot portion of foreground shell overhead; it does not include all history persistence, hooks or model latency. Repository state, filesystem caches and concurrent desktop activity affect timings. It is not a solver success estimate, and multiplying this ratio by task latency would be invalid. Built-in and shell search capabilities and bounds differ.

Reproduce from the repository root with Node 26 and installed dependencies:

```sh
node --import tsx scripts/litellm-harness/studies/native-inspection/benchmark.mts /path/to/litellm /path/to/output.json
```

## Paid comparison

[`plan.json`](plan.json) freezes two repetitions each of two training cases (Databricks reasoning and legacy streaming), two arms, Medium reasoning, protocol 6, 900-second deadline and the shared three-solver queue. Both arms include v33 history and v34 test-navigation fixes. The randomized order uses seed 35160926. Inspect normal completion and original acceptance first, then first edit, tool counts/time, model usage and elapsed time. A single fast or passing run cannot establish improvement. These cases have already informed development and cannot measure held-out quality.

## Dependency-isolation amendment

The first two allocations failed during runtime import, before any model request: the frozen worktrees linked `node_modules` outside their allowed filesystem boundary. Those are infrastructure failures, not model attempts. Both [original records](startup-failures.json) and the [original plan](plan-v1.json) are retained. Dependencies were physically cloned inside each frozen runtime, and imports of both the runner and harness succeeded under the exact retained isolation profiles. Source commits and model settings did not change.

Plan revision 2 assigns new `-envfix` labels to replacements for just those two failures; the other six identities are unchanged. The current eight-row results use the amended plan. The campaign-wide export also retains the two startup failures, including the untouched-base acceptance failures. Future isolated runtimes must contain their dependency files within the allowed boundary.

## Metering-gateway outage

The current plan explicitly replaces allocations affected by the verified gateway heap failure, regardless of their patch scores. [The outage audit](../gateway-memory/outage.json) records every original attempt and its admitted-request count; `plan-before-gateway-oom.json` preserves the previous identities. Source commits, tasks, effort, deadlines and concurrency are unchanged. Replacements use new `-oom1` labels. Original partial work, failed allocations and charges stay in the campaign-wide report; complete-pair summaries use the amended plan. These are infrastructure replacements, not selection of a better model attempt.

## First valid legacy-streaming observations

The search-preference candidate (`826c12f2`) finished normally at 838.45 seconds with 14/16 checks. The control (`be9193ea`) reached 16/16 but timed out at 900.71 seconds. Candidate/control tool activity was 92.81/144.28 seconds, first edit 317.72/446.00 seconds, Bash calls 34/59 and native grep calls 16/0. These are different trajectories on one repeated task, not causal savings. Token-priced costs were $0.4400/$0.4035; fewer shell calls did not imply lower model cost.

The control's late verification was useful: it wrote an inherited-hook/native-lifecycle test, observed a failure, then fixed its leaf-class assumption. Its timeout occurred during subsequent checks. The candidate retained the same two inherited-hook reference failures seen in earlier training attempts, under the separately documented [ambiguous wording](../feature-effort/legacy-inheritance/README.md). Neither is a normally delivered all-checks-passing attempt. The mechanism remains unpromoted while the planned repetitions finish. [Recorded metrics](first-legacy-pair.json).

The [posthoc real-adapter audit](../feature-effort/legacy-inheritance/README.md#real-adapter-checks-on-other-mechanism-trials) retains the distinction between semantically passing patches at cancellation and normal delivery. It does not replace this study’s original endpoint or deadline.
