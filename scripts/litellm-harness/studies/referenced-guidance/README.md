# Referenced repository guidance candidate

**Prepared and unpromoted. No paid trial is allocated or added to the budget.** The active billing study uses its unchanged frozen runtimes.

The first v55 billing patch passes all29 functional checks but adds five type-check diagnostics in the cost utility. Its initial request includes the root AGENTS directive to read `CLAUDE.md`, not the referenced rules, and no tool call opens that file. [Observed gap](../billing-invariants/static-diagnostics.json). This candidate tests a concrete delivery repair; whether delivery improves model adherence remains unknown.

## Behavior

For **LiteLLM specific**, an explicit root AGENTS line such as `Read @CLAUDE.md for coding guidelines` includes that fixed root file in the acceptance-time project-guidance snapshot. Later file edits cannot change the accepted turn. Single model retains its current behavior. This adds no model round and follows no arbitrary, external, or recursive references.

Hooks, sidecars, non-allow read rules, or a profile without `read_file` keep this additional automatic capture off; normal intercepted file tools remain available according to their policy. The existing safe guidance reader rejects links, nonregular files, invalid UTF-8, binary data, oversized files and file changes during capture. Per-file source reads remain capped at256KiB and included text at24,000characters. Only the captured AGENTS prefix can trigger the reference.

## Verification and reconstruction

Four new delivery regressions fail before the implementation. The final candidate passes **2,181 tests with1skip**, type checking and production build. Provider-boundary tests cover Build/Plan, the accepted snapshot, absence from Single model, and permission/hook/sidecar/profile restrictions. [Checks and exact source hashes](preparation.json), [patch](candidate.patch).

On the actual historical LiteLLM base, captured guidance grows from562bytes to16,707bytes and now includes the concrete `Final`, mutation and suppression rules. [Activation measurements](activation.json). That extra context is a cost/attention tradeoff, not a proven quality benefit.

Apply `candidate.patch` to public base commit `93f49c61315b60e7af395428704bbd0c5e0bb5eb`; a fresh reconstruction matches all six changed files byte-for-byte. The runtime starts from production52, without the v55 billing playbook or other unpromoted mechanisms. It must receive a separately declared comparison before making any quality or speed claim.
