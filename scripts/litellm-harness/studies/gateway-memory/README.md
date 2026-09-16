# Campaign gateway retained full prompts through short labels

The metering gateway stopped with a 4 GiB Node heap exhaustion after approximately 4.7 hours. Its long-lived ledger had only about 12 MB of serialized records, but new run labels came from regex captures over serialized prompt histories. V8 can retain a capture as a slice of its original string. Keeping that short label in a ledger record therefore kept the entire prompt string alive.

A synthetic probe using the real `CampaignBudget.reserve` reproduced the retention: 96 labels extracted from separate 256 KiB strings retained **25,231,416 bytes** after explicit garbage collection. Giving each persisted label its own UTF-8 buffer/string copy reduced the same probe's retained growth to **336,776 bytes**, with identical labels and reservation semantics. The [measurement](measurement.json) is engine-specific, and the [executable probe](probe.mts) is a regression check, not a production memory benchmark.

Run `node --expose-gc --import tsx scripts/litellm-harness/studies/gateway-memory/probe.mts` from the repository root. The unit suite also invokes the probe in an isolated process and rejects large retention. No real prompts, keys or model requests are needed.

The crash recovery preserves the ledger and the full reservations of admitted requests without receipts. Original failed/interrupted trials remain in the campaign; transport failures are not evidence of model quality. Replacement allocations require separately declared labels and retain the outage provenance.
