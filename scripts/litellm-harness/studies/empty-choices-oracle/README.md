# Empty choices: diagnostic wording and the cached-stream boundary

The frozen control trial `ce6b2b87` finishes normally with **8/13 original checks**. All five failures assert an exact error-message phrase. The [recorded task](case.json) requires an `APIError` identifying `choices` and the supplied type; it does not require that phrase. The candidate names both, using different wording.

A windowed [model critique](critic-final.md) identified this coupling. The host then ran an independent [executable probe](probe.py) on a separate historical base, the merged reference and the unchanged candidate. The 18 conversion checks cover explicit empty lists, usage preservation, missing choices and four wrong types through normal, synchronous-streaming and asynchronous-streaming conversion. Error assertions require the stated type and field, without requiring the reference's sentence template.

| Snapshot | Qualified conversion checks |
|---|---:|
| Historical base | 3/18 |
| Human reference | 18/18 |
| Candidate | 18/18 |

[Results](results.json) include every check and import-origin verification. Base/reference changed production files were byte-compared with their recorded Git commits. Each interpreter uses a fresh bytecode location with writes disabled. This is posthoc training diagnosis; the original 8/13 score remains unchanged and these parameterized checks are not independent tasks. The result rules out these five wording assertions as evidence of a demonstrated conversion defect; it does not establish complete correctness.

## Actual wrapper observations

The model's own earlier probe found a final cached-stream chunk with one empty stop choice and no public usage when `include_usage` was absent. The critic flagged possible invented-choice behavior. The host reproduces that same result in both the candidate and merged reference. A stop marker with no content is therefore not a candidate-specific difference in this example.

With `include_usage=True`, the candidate returns the supplied four prompt tokens. The merged reference returns three, after its empty cached-response branch drops the supplied usage and the wrapper estimates it. Both sync and async observations agree. These four additional wrapper observations are retained separately: two fail on the merged reference, so the full 22-row probe is **not** a qualified replacement acceptance suite. The conversion checks above and the wrapper evidence answer different questions.

The critic also says the trace ended at step 144, despite a later final review and final answer being present. Its suggestion to omit `--noconftest` conflicts with the replay task's explicit test command; its suggested exact error phrase would optimize a test-specific wording requirement. Neither recommendation is promoted.

Reproduce with the recorded commits and [candidate patch](candidate.patch), then invoke `probe_runner.py SNAPSHOT_DIRECTORY probe.py` with the preinstalled evaluation environment. Inspect the conversion subset and wrapper observations separately. Do not silently rescore existing feature comparisons from this diagnostic.
