# Link background jobs to review evidence

A completed MCP authentication candidate passed 52/52 acceptance checks. The trace critic incorrectly challenged its report of 981 local tests: the command starts at step 123, `wait` confirms exit at 125, and `bash_output` contains `981 passed, 78 warnings in 10.60s` at 127. The old global command index retained the launch text despite its structured execution status already saying exited. A window contained the later result, so this was both an evidence-association gap and a critic oversight.

Reflection protocol 3 attaches later observations by exact session and job ID. Wait/kill status is distinguished from actual command output. Missing or ambiguous origins stay explicitly unmatched. The original launch receipt is preserved. Three focused regressions cover archived launches, output summaries surviving excerpts, cross-session/unknown jobs, and refusing resynthesis without saved windows. All 40 workbench tests pass.

The [plan](plan.json) adds one paid synthesis using the same eight saved window reviews after checking their exact request hashes. Old protocol-2 artifacts and costs remain unchanged. Existing ongoing critics still use protocol 2; no experiment is silently modified. This is a correction to meta-review inputs, not proof that the new critic is reliable or that the solver patch is better.

## Resynthesis result

The new summary acknowledges green checks at steps 125–127 and drops the unsupported-981 claim. One additional request used 32,091 input tokens (106 cached) and 2,529 output tokens, costing $0.00870658 at the recorded token rates. [New final summary](critic-v3-final.md), [receipt summary](results.json). Eight window reviews were reused without additional calls.

The critic still cites the lack of solver execution of private acceptance as a limitation. That execution is intentionally unavailable to the solver; its absence is not a defect to fix. Its proposed new verification prompts remain untested and unpromoted. The correction improves this evidence association, while the example continues to show why critique text needs independent checking. Original acceptance remains 52/52.
