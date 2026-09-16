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

## Complete terminal approval previews

A subsequent review found that the terminal fetched only the ordinary 256 KiB browsing prefix before constructing its approval diff. An edit near the end of an otherwise supported price map appeared unavailable; a replacement near the beginning could be checked against incomplete content. Edit previews now request the complete file within the same edit cap, retain existing path/credential checks, and refuse a truncated response from an older server. Ordinary file browsing is unchanged.

The new API regression fails before the change. It verifies a complete 2.4 MB map, ordinary browsing truncation, oversized ordinary-file rejection and protected-file denial. All 145 focused API/tool/permission tests pass, with type checking and build. A real terminal PTY opens approval details, displays the diff at line 300001, permits the edit and verifies exact final bytes. [Preview evidence](preview-validation.json).
