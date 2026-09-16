# Host sleep and unpriced transport failures

**Infrastructure incident; affected allocations remain excluded from quality comparisons.** After review, a [bounded serial resume](bounded-resume.json) uses only the existing $1.07233424 of safe headroom for the new billing study. All186 unresolved requests remain fully reserved. The figures below describe the incident checkpoint; see the current results report for subsequent spending.

After the 12:41 UTC snapshot, 126 admitted requests lacked a recorded upstream response and usage receipt. Three were already-running long requests; subsequent attempts failed rapidly. The Mac power log records repeated sleep/dark-wake cycles and a lid/HID wake at 12:26:10 Pacific. The old metering gateway mapped caught exceptions to HTTP 429, so the solver called these rate-limit errors even though the underlying error and upstream status were not retained. This evidence does not prove each request was unbilled or establish its exact transport cause.

The incident adds $31.79151 in conservative reservations. There is now **$51.99734 priced usage**, **$46.93033 reserved across 186 unknown requests**, and **$98.92767 committed** against the $100 limit, with no pending requests. Reservations are not actual spend. Two separately labeled one-token diagnostics then completed with normal and streamed usage, costing $0.0000044 together. An independent runner-receipt audit recovered no additional receipts; it matched 1,878 known receipts with zero mismatches. No charge was released. [Accounting and affected labels](incident.json).

New admission was held and the gateway restarted in a persistent paused state. Billing evidence was requested because the upstream key-info endpoint returned 403. Original traces, failed allocations, accounting and unaffected results remain intact. Any replacements must use fresh identities, apply consistently to affected allocations regardless of patch scores, and retain the previous study plan. An interrupted patch is not a normal delivery.

## Preventing a cascade

The gateway now pauses admission when an admitted request fails or completes without a usable receipt. It retains bounded exception names/codes and the execution stage, excluding raw messages, headers, URLs and source. The pause persists across restarts; removing the pause file alone does not reopen a running gateway. Readiness returns 503 while paused, so current launchers stop before allocation. Paused submissions receive 409; validation and budget failures receive non-retryable classification instead of fabricated rate limits.

Typechecking and eleven focused campaign tests pass. A real local HTTP test uses a deliberately unreachable upstream: the first failure retains one unknown reservation, readiness becomes unavailable, and the next submission creates no new reservation. This test incurs no provider charge. Failure to write diagnostics still closes in-memory admission. Requests whose bodies were already arriving also recheck the pause before reserving funds; both HTTP regressions failed before that race was fixed.

A second local HTTP case returns a successful response without usage and confirms the same admission stop. No automatic resume is performed after connectivity recovers.

## Resume procedure

Keep new allocations stopped while reconciling receipts or authoritative billing. Preserve the original ledger and all unknown charges that lack supporting evidence. Record any accounting amendment separately. Before resuming, load the corrected gateway, verify no admitted request remains active, archive the pause record after review, and restart: deleting the file alone does not reopen a live process. Check readiness before releasing the shared queue. Replacement trials require a published incident amendment with fresh labels and unchanged frozen runtime/input identities; do not rerun only low-scoring patches.

## Bounded resume without releasing unknown charges

The original pause was reviewed and archived, the fixed gateway restarted, and its unchanged ledger hash verified before admission resumed. All other paid controllers were stopped. A [preallocation amendment](../billing-invariants/plan.json) preserves the original plan and runs the new billing comparison serially inside the existing headroom. The gateway still refuses reservations above $100 and stops on any new missing receipt. This is not billing reconciliation: $46.9303296 remains unresolved and reserved. Idle sleep is inhibited during this controller; that does not guarantee connectivity through lid closure. No earlier failed allocation is retried.
