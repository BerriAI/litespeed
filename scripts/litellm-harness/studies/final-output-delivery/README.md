# Avoid asking again for command output already delivered

The combined-candidate browser check reproduced a redundant round trip: `bash` yields, the model waits for completion and reads `bash_output`, then offers its answer. The runner still had an open command-history snapshot and issued another instruction to read the output. That forced another model answer even though the final status and retained output were already in its transcript.

The regression first fails in both Single model and LiteLLM-specific mode: five requests instead of four in the read-only reproduction. Version 45 tracks delivery of a final job output separately from the pending history snapshot. Closing the snapshot still records edits and supports Undo. A final output delivered through a successful model tool result avoids the redundant reminder; an unread job, a read that returned a running status, or a direct registry read retains it. Changed LiteLLM turns still receive the ordinary final review. Tool output truncation and unknown-job behavior are unchanged.

The focused job, history and LiteLLM runner suites pass 65 checks, including real child-process exit, edits, whole-turn Undo and the negative cases. Type checking passes. This is a deterministic bookkeeping correction, not a claim about model patch quality. Existing frozen experiments retain their original source versions.

The [trace audit](trace-audit.json) finds 12 completion reminders across 11 completed protocol-6/7 development attempts. Eight immediately follow a successful `bash_output` with a final status. Those observations show at least one final output already delivered; they do not prove every pending job had been read, or establish a causal dollar saving. The controlled regression establishes the unnecessary request in its reproduced flow.

The complete suite also passes **2,136 tests (1 skipped)** with two workers, and the production build passes. [Validation record](validation.json).
