# Background-notice placement: transport diagnosis

The [plan](plan.json) isolates a mechanism observed in the [job-event trials](../job-events/README.md): replacing a system message early in the conversation can invalidate the cached source and tool history that follows it. Six paired synthetic scenarios compare an updated early envelope with notices appended at the end. Each contains 12 short replies over 160,000 or 480,000 characters of already inspected training source. Unique leading nonces separate cache warming; arm order is randomized within each round.

The Flash solver task is simply to reply OK, so this experiment measures transport cost rather than patch quality. The chronological arm retains previous notices and consequently grows slightly more. The separate [affinity pilot](../cache-affinity/README.md) already found no useful gain from a stable user hint; neither arm here adds that hint.

Run `prefix_study.py CAMPAIGN_DIRECTORY STUDY_DIRECTORY` using the frozen plan. The runner shares the three campaign slots and authoritative gateway budget. It refuses existing request markers rather than silently retrying; missing receipts retain their reservation. It stops admitting new work at a $90 committed campaign balance to preserve evaluation funds. Export complete paired measurements with `cache_study.py STUDY_DIRECTORY OUTPUT_JSON`. The source hashes and runner hash are recorded before launch.

## First five paired scenarios (interim)

Five of six planned scenarios are complete, with 120 OK responses. All three scenarios using 480,000 characters of source are complete. Excluding the first warm-up request, early-envelope replacement has zero cached input in those three repetitions, while chronological events have 99.85% cached input. Across each arm's 11 follow-ups, input cost is about $0.2530 versus $0.00842. Mean request latency is 2.65, 2.65 and 3.09 seconds for the early envelope versus 1.29, 1.24 and 2.41 seconds for chronological events. [Measurements](results.json).

The two completed 160,000-character scenarios also have zero cached input with early replacement. Chronological events have 90.50% and 99.57%, so preserving the prefix does not guarantee a cache hit on every request. Input cost is $0.08664 per control sequence versus $0.01075 and $0.00313; mean request latency is 1.78/1.52 seconds versus 0.99/1.07 seconds. One repetition at this size remains queued.

These controlled responses only say OK; they do not establish coding quality or the cache hit rate of real sessions. The difference supports the prefix-placement mechanism, while promotion still requires the independent coding/integration evidence.
