# Where development requests spend tokens

Snapshot: 2026-09-16T12:17:10.521260+00:00. **240 development attempts**, with $31.2969 recorded token-priced usage. Protocol counts: {'6': 208, '7': 32}.

Descriptive protocol-6/7 development attempts with recorded Flash usage. Different tasks, candidate versions, isolation protocols and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Protocol 6 has the disclosed runtime-artifact access limitation. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.

Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.

| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |
|---|---:|---:|---:|---:|---:|
| Other shell requests | 4,778 | 28.9% | $8.6013 | 27.5% | 95.2% |
| Source navigation | 5,439 | 32.9% | $7.0619 | 22.6% | 95.1% |
| Shell requests mentioning check tools | 1,882 | 11.4% | $4.8232 | 15.4% | 93.0% |
| Structured edits | 2,716 | 16.4% | $4.7703 | 15.2% | 96.9% |
| Job polling or waiting | 741 | 4.5% | $4.0656 | 13.0% | 80.6% |
| Text-only replies | 420 | 2.5% | $1.1053 | 3.5% | 93.6% |
| Mixed tool families | 493 | 3.0% | $0.7446 | 2.4% | 91.1% |
| Other tools | 58 | 0.4% | $0.1246 | 0.4% | 96.5% |

Unattributed recorded cost: $0.000000. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).

## Timing

| Measurement | Runs with measurement | Median seconds |
|---|---:|---:|
| Recorded model-request duration | 240 | 328.4 |
| Union of active tool intervals | 240 | 83.3 |
| First recorded edit attempt | 240 | 135.7 |

These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.

## Experiments addressing the observed costs

- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.
- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.
- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.
- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.

Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.
