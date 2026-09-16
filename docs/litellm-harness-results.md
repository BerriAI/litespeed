# LiteLLM harness campaign results

Interim snapshot: 2026-09-16T02:22:40.354098+00:00. Current harness: **2026-09-15.24**.

**The campaign is still running. It has not established a quality win over Astra/Codex or production replacement readiness.**

The selectable architecture and replay workbench are implemented. The current work measures which mechanisms improve correct, completed patches and which add latency. Model-written critiques are hypotheses; executable checks decide whether a candidate works.

## Spending

Confirmed token/header-priced charges: **$22.8758**. Missing receipts retain **$29.2684** across 116 requests; active requests reserve another **$0.2523**. The committed upper bound is **$52.3965** against the authorized **$100.00** ceiling. Reservations are not actual charges. Astra account billing is unavailable.

## Controlled development observations

The following are training/development trials under protocol 5, after enforcing one global concurrency limit. They are single attempts, not a held-out quality estimate. A raw passing patch is counted as completed only if the solver finished normally.

| Task | Harness | Reasoning | Checks | Finished | Seconds |
|---|---|---|---:|---|---:|
| langfuse-session-traces | 2026-09-15.17 | medium | 60/60 | Yes | 280.6 |
| mcp-auth-challenge | 2026-09-15.17 | medium | 52/52 | No | 419.0 |
| mcp-optional-discovery | 2026-09-15.17 | medium | 29/29 | Yes | 325.3 |
| mock-input-tokens | 2026-09-15.17 | medium | 6/6 | Yes | 223.4 |
| responses-custom-guardrail | 2026-09-15.17 | medium | 15/15 | Yes | 679.4 |
| router-strategy-isolation | 2026-09-15.16 | medium | 5/9 | Yes | 605.1 |
| router-strategy-isolation | 2026-09-15.17 | medium | 5/9 | Yes | 510.4 |
| router-strategy-isolation | 2026-09-15.17 | none | 4/9 | Yes | 640.2 |
| team-member-budget | 2026-09-15.16 | medium | 3/5 | Yes | 590.8 |
| team-member-budget | 2026-09-15.17 | medium | 5/5 | Yes | 446.4 |
| team-member-budget | 2026-09-15.17 | none | 4/5 | Yes | 421.4 |
| vertex-version-path | 2026-09-15.17 | none | 6/6 | Yes | 174.6 |

## What the traces changed

- A passing budget fix was temporarily removed for a baseline experiment, then cancellation prevented restoration. Restoring the model-authored block on a separate diagnostic copy passed all five checks. The original 4/5 timeout stays in the record. The review now keeps the working patch intact.
- Router override fixes missed early returns: two checks exercise full completion/acompletion by deployment ID and two exercise direct selection. The specific_deployment flag resolves a different identifier. A return-site map made paths visible but did not eliminate the early misses. In a later training repetition, all eight behavior checks passed and only the new-private-helper assertion failed; the preceding repetition still failed behavior checks.
- Three broad Medium-reasoning code audits exhausted 24,000 output tokens each without returning a review. A focused router audit with relevant function excerpts returned actionable findings in 4,026 completion tokens. Its focus came from prior training failures; this does not validate a general-purpose blind reviewer. A second-attempt repair is measured separately.
- Disabling reasoning did not earn a default on the first two hard development cases: it missed more router checks and one budget check. Other effort results remain separate.
- Per-batch concurrency limits collectively overloaded the host. All datasets now share three solver slots and one grader. Interrupted runs and unknown charges are preserved.

- An MCP-auth patch passed its reference checks, but repeated 600 ms job polling triggered the host loop guard. Earlier reporting treated every idle session as completed. The analyzer now separates explicit host guard stops from normal completion, even when the patch passes.

A [supplemental Langfuse training probe](../scripts/litellm-harness/studies/identity-precedence/README.md) confirmed a missed, explicitly requested keep condition in a candidate that passed all 60 original cases: the candidate satisfies 4/6 new checks, the base 2/6 and the human reference 6/6. Original study scores remain unchanged.

A [router precedence probe](../scripts/litellm-harness/studies/router-precedence/README.md) also found that ten completed protocol-6 candidate-ID attempts passed original acceptance but failed supplemental checks against actual request selection. The recorded control fixes unprefixed wildcard names while introducing a named-team precedence regression. This is posthoc training evidence; original scores remain intact.

A later routing run recorded 21 pytest-related jobs without a test-focus notice: the reminder incorrectly depended on conservative check verdicts that excluded its command wrappers. Version 24 counts completed test-like activity separately, deduplicates job polling, and keeps pass/fail receipts conservative. Frozen earlier runs are unchanged.

## Evaluation status

A [feature-removal study](../scripts/litellm-harness/studies/feature-removal/README.md) compares the current harness with no learned guides, no automatic initial map, no forced final review, and a 480-line default read window. The plan uses 16 qualified training/development tasks, five variants, and two repetitions, with randomized order. Frozen worktrees preserve each candidate. Outcomes select the next candidate; they are not final test results. The linked catalogs and patches reconstruct the inputs.

The Bedrock session-tags oracle requires exact error wording absent from the solver prompt. In one 27/34 run, six failures were this wording mismatch; the remaining failure was tuple versus list, which the prompt did specify. Its host oracle note had incorrectly claimed both contracts were supplied. The active study retains its original inputs and raw scores, with this interpretation correction. The router-strategy oracle also includes a new private-helper assertion.

A separate corpus selects 20 recent September 15 Python changes by explicit file-count and diff-size criteria. Fourteen pass base/reference qualification; six have environment, new-private-API, or reference failures and are excluded before solver outcomes. Its outcomes remain reserved. Earlier September 9 reserved tasks predate some training snapshots, so they cannot establish chronological generalization.

Protocol 6 isolates Git configuration, permits ordinary Git inspection through the installed executable, withholds reference revisions/test selections from solvers, and protects frozen host metadata. Earlier protocol-5 trials contained blocked global-Git-config errors. Do not pool protocols for the final comparison.

## Earlier results and limits

The [phase-1 report](litellm-harness-phase1-results.md) retains the original Astra/v9 comparison and v11/v13 follow-ups. Four v9 trials read outside their snapshots; those raw results cannot support superiority. Some reference assertions also require implementation-specific names or wording. The later filesystem boundary addresses the observed access failures, but remains a trusted-model evaluation rather than a complete adversarial sandbox.

The [measurement export](litellm-harness-results.json) preserves completed and interrupted development trials separately, with tool counts, token totals and timing components. Provider time and tool time can overlap; they should not be added to infer elapsed time. All runs occur on one shared desktop, so latency remains observational.

See the [user guide](litellm-harness.md) and [replay protocol](../scripts/litellm-harness/README.md).
