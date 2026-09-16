# Where development requests spend tokens

Snapshot: 2026-09-16T11:36:37.769722+00:00. **228 development attempts**, with $29.7206 recorded token-priced usage. Protocol counts: {'6': 203, '7': 25}.

Descriptive protocol-6/7 development attempts with recorded Flash usage. Different tasks, candidate versions, isolation protocols and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Protocol 6 has the disclosed runtime-artifact access limitation. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.

Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.

| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |
|---|---:|---:|---:|---:|---:|
| Other shell requests | 4,555 | 29.2% | $8.2999 | 27.9% | 95.1% |
| Source navigation | 5,075 | 32.6% | $6.6001 | 22.2% | 95.1% |
| Shell requests mentioning check tools | 1,774 | 11.4% | $4.6306 | 15.6% | 92.8% |
| Structured edits | 2,547 | 16.4% | $4.5093 | 15.2% | 96.7% |
| Job polling or waiting | 702 | 4.5% | $3.8060 | 12.8% | 80.6% |
| Text-only replies | 397 | 2.5% | $1.0421 | 3.5% | 93.5% |
| Mixed tool families | 472 | 3.0% | $0.7175 | 2.4% | 91.1% |
| Other tools | 51 | 0.3% | $0.1150 | 0.4% | 96.0% |

Unattributed recorded cost: $0.000000. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).

## Timing

| Measurement | Runs with measurement | Median seconds |
|---|---:|---:|
| Recorded model-request duration | 228 | 328.0 |
| Union of active tool intervals | 228 | 82.4 |
| First recorded edit attempt | 228 | 137.3 |

These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.

## Experiments addressing the observed costs

- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.
- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.
- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.
- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.

Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.
