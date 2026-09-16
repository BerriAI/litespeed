# Group exact edits to reduce model round trips

This predeclared 12-trial development study compares v28 with grouped edits in v29: three qualified multi-module tasks, two repetitions, two variants, Medium reasoning and a 900-second deadline. Seed 29160926 randomizes the trial order. All datasets share the same three solver slots. Task fixtures and acceptance selections are frozen in the [feature-effort dataset](../feature-effort/README.md).

A single `edit_file` call can contain 1–32 ordered replacements in one file. Every match and intermediate size limit is checked before writing. One failed match leaves the file unchanged. Existing path checks, permissions, hooks, concurrent-edit checks and Undo remain in the same execution path. Only the LiteLLM architecture advertises and enables the array. Terminal approvals list all edits, and previews share the execution calculation.

[The complete patch](batched-edits.patch) and [plan](plan.json) pin the experiment. Correct normal completion is primary; cost, elapsed time, request counts and actual batch activation are secondary. This is development selection, not a held-out comparison. The frozen control is v28; grouped edits remain experimental. The hypothesis came from a Bedrock trace with 58 edits across 16 files and 576 seconds of model time; that trace is motivation, not a causal estimate. The three study tasks avoid its known acceptance-wording coupling.

Before any study trial, 208 focused tool, runner, permission, hook and terminal tests plus type checking and a production build passed. A synthetic Flash gateway call accepted the schema and emitted two grouped replacements in one call; it is only a compatibility check.
