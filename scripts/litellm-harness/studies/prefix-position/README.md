# Background-notice placement: transport diagnosis

The [plan](plan.json) isolates a mechanism observed in the [job-event trials](../job-events/README.md): replacing a system message early in the conversation can invalidate the cached source and tool history that follows it. Six paired synthetic scenarios compare an updated early envelope with notices appended at the end. Each contains 12 short replies over 160,000 or 480,000 characters of already inspected training source. Unique leading nonces separate cache warming; arm order is randomized within each round.

The Flash solver task is simply to reply OK, so this experiment measures transport cost rather than patch quality. The chronological arm retains previous notices and consequently grows slightly more. The separate [affinity pilot](../cache-affinity/README.md) already found no useful gain from a stable user hint; neither arm here adds that hint.

Run `prefix_study.py CAMPAIGN_DIRECTORY STUDY_DIRECTORY` using the frozen plan. The runner shares the three campaign slots and authoritative gateway budget. It refuses existing request markers rather than silently retrying; missing receipts retain their reservation. It stops admitting new work at a $90 committed campaign balance to preserve evaluation funds. Export complete paired measurements with `cache_study.py STUDY_DIRECTORY OUTPUT_JSON`. The source hashes and runner hash are recorded before launch.

## Completed results: six paired scenarios

All six scenarios completed, with 144 OK responses. Excluding each arm's first warm-up request:

| Source characters | Repetition | Cached input, early / chronological | Input cost, early / chronological | Mean seconds, early / chronological |
| --- | --- | --- | --- | --- |
| 160,000 | 1 | 0.00% / 90.50% | $0.08664 / $0.01075 | 1.78 / 0.99 |
| 160,000 | 2 | 0.00% / 99.57% | $0.08665 / $0.00313 | 2.00 / 1.09 |
| 160,000 | 3 | 0.00% / 99.57% | $0.08665 / $0.00313 | 1.52 / 1.07 |
| 480,000 | 1 | 0.00% / 99.85% | $0.25298 / $0.00842 | 2.65 / 1.29 |
| 480,000 | 2 | 0.00% / 99.85% | $0.25299 / $0.00842 | 2.65 / 1.24 |
| 480,000 | 3 | 0.00% / 99.85% | $0.25299 / $0.00842 | 3.09 / 2.41 |

[Full measurements](results.json). Preserving the prefix did not guarantee a cache hit on every request: the first smaller chronological scenario retained 90.50% cached input rather than approximately 99.57% in its other two repetitions.

These controlled responses only say OK; they do not establish coding quality or the cache hit rate of real sessions. The difference supports the prefix-placement mechanism. The separate coding study reports both benefits and regressions, and the combined candidate still requires evaluation.
