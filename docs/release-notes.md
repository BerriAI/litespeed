# Litespeed 0.1.17

LiteFusion now keeps worker coordination out of your conversation and shows one card per actual task.

- Resuming a worker already on its hard-task route accepts a redundant `hard` flag. Changing a default-route worker to its escalation route still requires an explicit escalation.
- Rejected handoffs no longer create phantom task numbers. An accepted retry appears on the same task as “Handoff retried successfully,” with readable details collapsed underneath. The card opens the current worker; unresolved handoffs remain visible.
- Internal worker-result messages stay in model context and exports, but no longer dump JSON into terminal or web chat. Existing saved sessions get the same presentation repair.
- Worker cards and the terminal sidebar show bounded status and blocker summaries. Full reports and evidence are available inside the worker inspector. Terminal error details preserve newlines while escaping terminal control sequences.
- Generated terminal-test recordings are excluded from source undo snapshots, preventing repeated test runs from creating command-history conflicts. Source conflict checks remain enabled.
- The release checks now exercise rejected handoffs, successful retries, long blocked-worker reports, inspector navigation, and preserved drafts in the real terminal.

Run `litespeed update`, then reopen Litespeed after active work finishes. No session reset is needed. An already interrupted task may still need the lead to inspect retained work and explicitly continue it.

Includes the terminal runtime and web app for Apple silicon and Intel Macs. Tests use local scripted providers; no paid model benchmarks were run.
