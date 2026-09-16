# Where development requests spend tokens

Snapshot: 2026-09-16T11:57:31.209796+00:00. **232 development attempts**, with $30.4143 recorded token-priced usage. Protocol counts: {'6': 205, '7': 27}.

Descriptive protocol-6/7 development attempts with recorded Flash usage. Different tasks, candidate versions, isolation protocols and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Protocol 6 has the disclosed runtime-artifact access limitation. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.

Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.

| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |
|---|---:|---:|---:|---:|---:|
| Other shell requests | 4,582 | 28.8% | $8.3532 | 27.5% | 95.1% |
| Source navigation | 5,222 | 32.9% | $6.7836 | 22.3% | 95.1% |
| Shell requests mentioning check tools | 1,813 | 11.4% | $4.7258 | 15.5% | 92.8% |
| Structured edits | 2,607 | 16.4% | $4.5915 | 15.1% | 96.8% |
| Job polling or waiting | 726 | 4.6% | $4.0368 | 13.3% | 80.0% |
| Text-only replies | 406 | 2.6% | $1.0827 | 3.6% | 93.4% |
| Mixed tool families | 476 | 3.0% | $0.7213 | 2.4% | 91.1% |
| Other tools | 55 | 0.3% | $0.1193 | 0.4% | 96.1% |

Unattributed recorded cost: $0.000000. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).

## Timing

| Measurement | Runs with measurement | Median seconds |
|---|---:|---:|
| Recorded model-request duration | 232 | 328.0 |
| Union of active tool intervals | 232 | 83.3 |
| First recorded edit attempt | 232 | 137.3 |

These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.

## Experiments addressing the observed costs

- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.
- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.
- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.
- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.

Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.
