# Reconcile retained runner usage without resetting the budget

The [reconciliation record](reconciliation.json) recovers **58** previously unpriced gateway requests from provider usage saved by the Litespeed runner. Those requests total **$0.076783878** at the campaign's token prices. Replacing their upper reservations releases **$14.557404922**; **60** requests still reserve **$15.138816**. The $100 ceiling is unchanged.

An earlier search of raw gateway response files found no recoverable usage. That finding applied to those files: some interrupted gateway streams had already delivered usage to the runner, which persisted it in both its request ledger and assistant message. Missing gateway files did not imply those independent receipts were absent.

## Round binding

The [auditor](../../receipt_recovery.py) requires all of the following:

- One saved request file whose timestamp is 0–250 ms after the runner's request start, with gateway and runner durations within 250 ms.
- One persisted assistant message with equal usage and a timestamp within 50 ms of that start.
- The exact preceding tool-call ID and tool output in both the request body and saved conversation, within 250 ms of the start.
- A one-to-one request/receipt match, valid input/output/cache counts and the authorized model.

The same rule reproduces usage on **3,359 known gateway receipts with zero mismatches**. Aggregate token differences alone never release a reservation. File timestamps alone are insufficient. Ambiguous, missing, first-message or otherwise unmatched requests remain reserved. These are persisted usage receipts priced at the campaign rates, not an upstream invoice.

## Offline application

New admissions were held while active trials finished. With all three slots drained and no pending requests, the gateway stopped cleanly. The reconciler then acquired the same exclusive gateway lock, recomputed every match and source hash, backed up the original ledger, and atomically replaced it. Each recovered record retains its original reservation and recovery provenance. The gateway restarted with the verified balance before admissions resumed. No paid trial was interrupted.

Seven focused tests cover exact and ambiguous binding, reused receipts, changed evidence, invalid models/counts/timing, a known-receipt disagreement, active gateway ownership, pending requests, preserved accounting history and refusal to apply the same evidence twice. Existing budget tests and type checking also pass.

For another campaign, use explicit dataset directories with `receipt_recovery.py` to generate and review an audit. Apply only after draining the gateway. Do not remove a live gateway lock, relabel a timed-out solver as successful, or replace missing receipts with estimated zero charges.
