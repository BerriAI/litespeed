# Where development requests spend tokens

Snapshot: 2026-09-16T10:53:26.656946+00:00. **214 development attempts**, with $28.2547 recorded token-priced usage. Protocol counts: {'6': 198, '7': 16}.

Descriptive protocol-6/7 development attempts with recorded Flash usage. Different tasks, candidate versions, isolation protocols and efforts are pooled only to locate spending. Includes paid interruptions and timeouts; excludes zero-usage startup failures. Not a quality comparison or causal estimate. Protocol 6 has the disclosed runtime-artifact access limitation. Missing usage is outside these token-priced totals; the campaign ledger remains authoritative.

Each row attributes the complete input/output cost of a model request to its chosen next action. A request asking for a read can spend tokens reasoning about a fix; its cost is not the marginal price of reading a file. Shell commands without a conservative check receipt are separately labeled when they mention known checker invocations. Mentions establish neither a passing check nor adequate coverage.

| Next action | Requests | Share of requests | Token-priced cost | Share of attributed cost | Cached input |
|---|---:|---:|---:|---:|---:|
| Other shell requests | 4,277 | 29.2% | $7.7966 | 27.6% | 95.1% |
| Source navigation | 4,753 | 32.5% | $6.2382 | 22.1% | 95.1% |
| Shell requests mentioning check tools | 1,678 | 11.5% | $4.4315 | 15.7% | 92.7% |
| Structured edits | 2,397 | 16.4% | $4.2532 | 15.1% | 96.8% |
| Job polling or waiting | 672 | 4.6% | $3.7598 | 13.3% | 80.0% |
| Text-only replies | 371 | 2.5% | $0.9918 | 3.5% | 93.4% |
| Mixed tool families | 445 | 3.0% | $0.6750 | 2.4% | 91.2% |
| Other tools | 47 | 0.3% | $0.1084 | 0.4% | 95.7% |

Unattributed recorded cost: $0.000000. Unknown gateway receipts are excluded here and remain reserved in the [campaign ledger summary](litellm-harness-results.md).

## Timing

| Measurement | Runs with measurement | Median seconds |
|---|---:|---:|
| Recorded model-request duration | 214 | 330.1 |
| Union of active tool intervals | 214 | 81.7 |
| First recorded edit attempt | 214 | 142.5 |

These are separate medians across varying tasks, not parts of one representative turn. Model/tool intervals can overlap; do not add them to infer wall time. The edit measure includes structured edit attempts, which can fail, and shell calls that record changes. It is not proof of a successful first write.

## Experiments addressing the observed costs

- [Job-event placement](../scripts/litellm-harness/studies/job-events/README.md) tests a reproduced cache-prefix change around background completion. Polling has a low output-token count but can resend an expensive uncached history.
- [Grouped edits](../scripts/litellm-harness/studies/batched-edits/README.md) tests whether fewer model round trips improve completed patches. A faster edit mechanism does not resolve a semantic mistake.
- [Native source inspection](../scripts/litellm-harness/studies/native-inspection/README.md) tests avoiding shell-history snapshots for ordinary reads. Its microbenchmark is not an end-to-end speed result.
- [Reasoning effort](../scripts/litellm-harness/studies/reasoning-effort/README.md) is compared on repeated tasks; pooled spending does not determine the best setting.

Regenerate from the public measurement export with `scripts/litellm-harness/bottlenecks.py`; [numeric results](litellm-harness-bottlenecks.json) list every included run.
