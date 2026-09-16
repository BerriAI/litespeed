# Focused test guidance on the shell tool

**Experimental; not promoted.** The completed [system-instruction comparison](../test-output-retention/README.md) partly changed traceback options but rarely retained logs and delivered no complete fixes. This follow-up tests a shorter instruction attached directly to the advertised `bash` tool: run focused pytest with short tracebacks without piping through `tail`/`grep`, and retain a log when output may exceed the job buffer.

The shell already returns bounded output. Its 64 KiB rolling buffer cannot recover text discarded by a shell filter, and the existing output pager does not undo that loss. The candidate introduces no tool or command rewrite. Permissions, hooks, execution, history and ordinary tool descriptions stay the same. A runner integration test verifies the instruction in the actual outbound schema and its absence from an ordinary session. Type checking and 37 focused runner/harness tests pass.

The [plan](plan.json) fixes two repetitions per arm on router strategy and legacy streaming, Medium reasoning, 900 seconds, protocol 7 and the shared three-slot queue. Both arms use the prepared v46 integration plus deadline configuration. Streaming retains all 24 predeclared real-adapter checks. Normal completion plus unchanged acceptance stays primary; instruction delivery and actual command syntax are separate activation measures. Historical helper-name coupling and inherited-hook wording remain limitations. No reserved task or outcome was read.

This is one bundled guidance change. Its wording, placement and runtime differ from the older v47 experiment, so comparing across those studies cannot isolate placement as the cause. Lower filter counts alone will not justify promotion.

Reconstruct the control through the [verified public v46/deadline patch chain](../deadline/reconstruction-validation.json), then apply the [candidate patch](candidate.patch) in a separate runtime. Install physical dependencies. Use the current public workbench with new labels/recorded commits and preserve the original plan. Private experiment commits identify frozen artifacts, not required downloadable branches.
