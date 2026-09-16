# LiteLLM price-map editing and history limits

The first larger cached-audio replay (`f4875007`) hit the structured editor's 2 MiB limit at tool call 65. Both price maps at the task's base revision are 2,395,003 bytes. The model subsequently used shell editing; the original trial remains scored against its original runtime.

Version 52 allows up to 4 MiB for these two exact workspace-relative paths:

- `model_prices_and_context_window.json`
- `litellm/model_prices_and_context_window_backup.json`

The same helper governs structured edits, before/after validation, command snapshots, and Undo/Redo. Path resolution, permissions, hard-link/symlink checks, external-change detection, and the 12 MiB total command snapshot budget retain their existing behavior. The file allowance applies across architectures so changing a session's architecture does not invalidate recorded history. Other paths keep their ordinary limit, including identically named files in other directories.

## Verification

Before the fix, three new regression checks failed on the old 2 MiB edit, history, and snapshot paths. After the fix, 127 focused tests passed; the full suite passed 2,140 tests with one skipped, and typecheck/build passed. Regressions include a structured edit followed by a foreground command edit, exact Undo/Redo of both maps, rejection above 4 MiB before and after editing, an ordinary lookalike file, and snapshot priorities within the unchanged total byte bound.

A separate check copied both real price maps from LiteLLM base `9e1ed40db3376dc8e7b9392aa104653ca22d3fdb`, edited a model's cached-input price using the normal tool, then verified exact Undo and Redo. Both maps passed. [Validation and source hashes](validation.json) record this check; its timings are observations on one desktop, not a performance comparison. The source checkout was not modified.

This removes an observed tool limitation. It does not establish better model quality, and no previous frozen trial is relabeled as using version 52.
