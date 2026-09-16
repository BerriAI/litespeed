# Where development requests spend tokens

Snapshot: 2026-09-16T08:25:54.701737+00:00. **168 protocol-6 attempts**, with $22.0862 recorded token-priced usage.

Descriptive protocol-6 development attempts with recorded Flash usage. Different tasks, candidate versions and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.

Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.

| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |
|---|---:|---:|---:|---:|---:|
| Other shell requests | 3,394 | 29.8% | $6.0262 | 27.3% | 95.4% |
| Source navigation | 3,654 | 32.1% | $4.8830 | 22.1% | 94.7% |
| Shell requests mentioning check tools | 1,323 | 11.6% | $3.6402 | 16.5% | 92.0% |
| Structured edits | 1,841 | 16.1% | $3.2543 | 14.7% | 96.7% |
| Job polling or waiting | 520 | 4.6% | $2.9177 | 13.2% | 79.8% |
| Text-only replies | 293 | 2.6% | $0.7600 | 3.4% | 93.7% |
| Mixed tool families | 340 | 3.0% | $0.5197 | 2.4% | 91.0% |
| Other tools | 35 | 0.3% | $0.0851 | 0.4% | 94.8% |

Unattributed recorded cost: $-0.000000. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).

## Timing

| Measurement | Runs with measurement | Median seconds |
|---|---:|---:|
| Recorded model-request duration | 168 | 330.6 |
| Union of active tool intervals | 168 | 79.7 |
| First recorded edit attempt | 168 | 144.3 |

These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.

## Experiments addressing the observed costs

- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.
- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.
- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.
- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.

Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.
