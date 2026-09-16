# Router override accounting through public entry points

The frozen router-strategy acceptance set has nine checks. One calls two private helpers newly introduced by the merged patch. Its generic metadata incorrectly claimed that such checks were excluded. We preserve the recorded inputs and raw scores, and test the accounting behavior separately.

The [probe](probe.py) calls `completion`, `acompletion`, and both pass-through selection methods. It wraps the existing usage-based-v2 selector's synchronous/asynchronous `pre_call_check` methods while still executing their original bodies. An override request must perform one accounting check; two unrelated ordinary requests must not perform another override check; a second override must perform exactly one more. Default-strategy completion must continue to account once per call. The override must not register in global callback lists. Completion uses LiteLLM's offline mock response.

## Qualification and results

| Snapshot | New checks | Original checks | Completed normally |
|---|---:|---:|---|
| Pre-fix base | 2/8 | — | — |
| Exact merged reference | 8/8 | 9/9 | — |
| Frozen v17 control, repetition 1 | 8/8 | 8/9 | No, timeout |
| Frozen v17 with 480-line reads, repetition 1 | 8/8 | 8/9 | Yes |

The two candidate failures in original acceptance are the private-helper assertion. This diagnostic supports their observed request isolation and call-count behavior; it does not convert either raw score to 9/9, turn the timeout into a completed solution, or establish a winning read size. The feature-removal study still needs its paired repetitions.

Base and reference source come from fresh Git archives at the exact commits in [qualification.json](qualification.json). `probe_runner.py` asserts that every loaded LiteLLM module belongs to the selected snapshot and disables adjacent bytecode reuse. These are training candidates; reserved outcomes were not opened.

An initial probe used `rpm=2` and expected two group selections to succeed. It failed four checks on the merged reference itself because the existing selector applies admission headroom. That version was not qualified. The current check uses a high limit and directly observes accounting calls while retaining the real method bodies. It does not redefine the router's existing admission policy. Original low-limit acceptance tests still exercise actual rejection behavior.

To reproduce, run `probe_runner.py SNAPSHOT_DIRECTORY probe.py` with the configured LiteLLM interpreter and inspect its per-check booleans as well as the process exit.
