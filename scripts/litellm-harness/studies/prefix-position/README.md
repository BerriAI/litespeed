# Background-notice placement: transport diagnosis

The [plan](plan.json) isolates a mechanism observed in the [job-event trials](../job-events/README.md): replacing a system message early in the conversation can invalidate the cached source and tool history that follows it. Six paired synthetic scenarios compare an updated early envelope with notices appended at the end. Each contains 12 short replies over 160,000 or 480,000 characters of already inspected training source. Unique leading nonces separate cache warming; arm order is randomized within each round.

The Flash solver task is simply to reply OK, so this experiment measures transport cost rather than patch quality. The chronological arm retains previous notices and consequently grows slightly more. The separate [affinity pilot](../cache-affinity/README.md) already found no useful gain from a stable user hint; neither arm here adds that hint.

Run `prefix_study.py CAMPAIGN_DIRECTORY STUDY_DIRECTORY` using the frozen plan. The runner shares the three campaign slots and authoritative gateway budget. It refuses existing request markers rather than silently retrying; missing receipts retain their reservation. It stops admitting new work at a $90 committed campaign balance to preserve evaluation funds. Export complete paired measurements with `cache_study.py STUDY_DIRECTORY OUTPUT_JSON`. The source hashes and runner hash are recorded before launch.

## First two paired scenarios (interim)

Two of six planned scenarios are complete, both using 480,000 characters of source and 12 requests per arm. All 48 responses are OK. Excluding the first warm-up request, early-envelope replacement has zero cached input in both repetitions, while chronological events have 99.85% cached input. Across each arm's 11 follow-ups, input cost is about $0.2530 versus $0.00842; mean request latency is about 2.65 seconds versus 1.24–1.29 seconds. [Measurements](results.json).

These controlled responses only say OK; they do not establish coding quality or the cache hit rate of real sessions. The remaining size and repetitions are still queued. The difference supports the prefix-placement mechanism, while promotion still requires the independent coding/integration evidence.
