# Where development requests spend tokens

Snapshot: 2026-09-16T10:18:16.665896+00:00. **202 development attempts**, with $26.9378 recorded token-priced usage. Protocol counts: {'6': 193, '7': 9}.

Descriptive protocol-6/7 development attempts with recorded Flash usage. Different tasks, candidate versions, isolation protocols and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Protocol 6 has the disclosed runtime-artifact access limitation. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.

Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.

| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |
|---|---:|---:|---:|---:|---:|
| Other shell requests | 4,075 | 29.2% | $7.3510 | 27.3% | 95.2% |
| Source navigation | 4,532 | 32.4% | $5.9379 | 22.0% | 95.1% |
| Shell requests mentioning check tools | 1,609 | 11.5% | $4.2424 | 15.7% | 92.7% |
| Structured edits | 2,290 | 16.4% | $4.0610 | 15.1% | 96.8% |
| Job polling or waiting | 649 | 4.6% | $3.6612 | 13.6% | 79.8% |
| Text-only replies | 354 | 2.5% | $0.9490 | 3.5% | 93.5% |
| Mixed tool families | 418 | 3.0% | $0.6306 | 2.3% | 91.2% |
| Other tools | 45 | 0.3% | $0.1047 | 0.4% | 95.7% |

Unattributed recorded cost: $0.000000. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).

## Timing

| Measurement | Runs with measurement | Median seconds |
|---|---:|---:|
| Recorded model-request duration | 202 | 331.3 |
| Union of active tool intervals | 202 | 82.4 |
| First recorded edit attempt | 202 | 143.5 |

These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.

## Experiments addressing the observed costs

- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.
- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.
- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.
- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.

Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.
