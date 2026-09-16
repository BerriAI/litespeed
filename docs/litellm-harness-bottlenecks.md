# Where development requests spend tokens

Snapshot: 2026-09-16T07:59:22.243299+00:00. **163 protocol-6 attempts**, with $21.1356 recorded token-priced usage.

Descriptive protocol-6 development attempts with recorded Flash usage. Different tasks, candidate versions and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.

Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.

| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |
|---|---:|---:|---:|---:|---:|
| Other shell requests | 3,226 | 29.7% | $5.7338 | 27.1% | 95.3% |
| Source navigation | 3,460 | 31.8% | $4.6094 | 21.8% | 94.5% |
| Shell requests mentioning check tools | 1,261 | 11.6% | $3.4871 | 16.5% | 91.7% |
| Structured edits | 1,780 | 16.4% | $3.1535 | 14.9% | 96.6% |
| Job polling or waiting | 511 | 4.7% | $2.8364 | 13.4% | 79.9% |
| Text-only replies | 287 | 2.6% | $0.7479 | 3.5% | 93.4% |
| Mixed tool families | 316 | 2.9% | $0.4824 | 2.3% | 90.2% |
| Other tools | 35 | 0.3% | $0.0851 | 0.4% | 94.8% |

Unattributed recorded cost: $0.000000. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).

## Timing

| Measurement | Runs with measurement | Median seconds |
|---|---:|---:|
| Recorded model-request duration | 163 | 323.0 |
| Union of active tool intervals | 163 | 78.0 |
| First recorded edit attempt | 163 | 142.1 |

These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.

## Experiments addressing the observed costs

- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.
- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.
- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.
- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.

Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.
