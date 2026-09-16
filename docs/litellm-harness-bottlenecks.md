# Where development requests spend tokens

Snapshot: 2026-09-16T08:55:19.326910+00:00. **176 development attempts**, with $23.2698 recorded token-priced usage. Protocol counts: {'6': 175, '7': 1}.

Descriptive protocol-6/7 development attempts with recorded Flash usage. Different tasks, candidate versions, isolation protocols and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Protocol 6 has the disclosed runtime-artifact access limitation. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.

Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.

| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |
|---|---:|---:|---:|---:|---:|
| Other shell requests | 3,567 | 29.7% | $6.4319 | 27.6% | 95.2% |
| Source navigation | 3,886 | 32.3% | $5.1554 | 22.2% | 94.9% |
| Shell requests mentioning check tools | 1,396 | 11.6% | $3.7993 | 16.3% | 92.2% |
| Structured edits | 1,935 | 16.1% | $3.3783 | 14.5% | 96.8% |
| Job polling or waiting | 547 | 4.5% | $3.0935 | 13.3% | 79.6% |
| Text-only replies | 306 | 2.5% | $0.7818 | 3.4% | 93.9% |
| Mixed tool families | 352 | 2.9% | $0.5369 | 2.3% | 90.9% |
| Other tools | 39 | 0.3% | $0.0927 | 0.4% | 95.2% |

Unattributed recorded cost: $0.000000. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).

## Timing

| Measurement | Runs with measurement | Median seconds |
|---|---:|---:|
| Recorded model-request duration | 176 | 330.6 |
| Union of active tool intervals | 176 | 80.7 |
| First recorded edit attempt | 176 | 144.7 |

These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.

## Experiments addressing the observed costs

- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.
- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.
- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.
- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.

Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.
