# Command history coverage on a large repository

The Databricks training replay `replication-p6-ablation-control-r1-databricks-reasoning-3ceeb064` exposed a host bug. Foreground shell writes to an already edited adapter were not captured by command history. Subsequent structured edits reported an external-change conflict, including after fresh reads. The windowed model critic called this a bypass; that diagnosis missed the host's coverage limit.

## Evidence

The one-based tool sequence contains successful shell writes at calls 28 and 30, each with no recorded command changes. Calls 32, 34 and 36 then fail with `The file changed outside the recorded tool sequence`. Call 37 makes another shell write. Call 27 failed its assertion before writing and is not evidence of a missed mutation. Earlier exact-text mismatch errors are separate.

A read-only snapshot of the retained LiteLLM workspace reaches the unchanged 12 MiB content limit and 10,000-entry scan limit. The original scan captures 1,269 files but omits `litellm/llms/databricks/chat/transformation.py`. Giving that already owned path priority captures it within the same limits (1,255 files, 12 MiB total). These counts describe this particular retained workspace, not a performance benchmark.

## Fix in v33

Command snapshots first observe files already changed in the current turn. The completion snapshot retains the starting snapshot's source paths. Priorities obey the same byte/entry limits, exclusions and symlink rules. A bounded scan no longer interprets an unscanned path as a proved creation or deletion; explicitly checked missing paths can still establish those changes.

Regressions cover structured edit → shell write → structured edit → Undo/Redo, deletion after scan truncation, genuine external changes, changed snapshot coverage, symlink ancestors and excluded directories. This is a deterministic host correctness fix; no paid quality improvement is inferred from it. Previously frozen study worktrees and scores remain unchanged.

Coverage is still bounded. New shell-written files outside the scan and files exceeding its limits can remain outside Undo history, with the existing incomplete-effects notice. This change does not make command snapshots a complete filesystem journal.
