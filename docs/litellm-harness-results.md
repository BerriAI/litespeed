# LiteLLM harness campaign results

Interim snapshot: 2026-09-16T10:21:45.900954+00:00. Current harness: **2026-09-16.45**.

**The campaign is still running. It has not established a quality win over Astra/Codex or production replacement readiness.**

The selectable architecture and replay workbench are implemented. The current work measures which mechanisms improve correct, completed patches and which add latency. Model-written critiques are hypotheses; executable checks decide whether a candidate works.

## Spending

Confirmed token/header-priced charges: **$46.4862**. Missing receipts retain **$15.1388** across 60 requests; active requests reserve another **$0.7569**. The committed upper bound is **$62.3820** against the authorized **$100.00** ceiling. Reservations are not actual charges. Astra account billing is unavailable.

An [offline receipt reconciliation](../scripts/litellm-harness/studies/runner-receipt-recovery/README.md) subsequently matched 58 missing gateway records to independently persisted runner usage. Exact round binding agreed with 3,359 known receipts. It restored $0.07678 in token-priced charges and released $14.55740 in excess reservations; unmatched requests remain reserved. The original ledger and per-request reservation history are preserved.

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

A [large-repository command-history audit](../scripts/litellm-harness/studies/command-history/README.md) reproduced a host defect: bounded snapshots omitted an already edited adapter, so legitimate shell writes caused later structured edits to fail. Version 33 prioritizes tracked paths within the same limits and preserves Undo/Redo and external-change guards. The deterministic regression and full suite pass; frozen solver studies retain their original code and scores.

A separate [router-accounting diagnostic](../scripts/litellm-harness/studies/router-accounting/README.md) qualifies eight public-entrypoint/callback checks: base 2/8, merged reference 8/8, and two training candidates 8/8. Both candidates retain their original 8/9 acceptance scores because of a new private-helper assertion; one remains a timeout. This diagnostic does not choose a read-window variant or replace the frozen oracle.

A [four-call focused-review pilot](../scripts/litellm-harness/studies/focused-review/README.md) delivered one verified router precedence finding from Medium reasoning, together with a false allegation about an omitted helper. Neither Langfuse attempt supplied a verified witness; one exhausted its output allowance. Prompts, inputs, final answers and executable witness results are included. The reviewer remains unpromoted.

A [supplemental Langfuse training probe](../scripts/litellm-harness/studies/identity-precedence/README.md) confirmed a missed, explicitly requested keep condition in a candidate that passed all 60 original cases: the candidate satisfies 4/6 new checks, the base 2/6 and the merged reference 6/6. Original study scores remain unchanged.

A [router precedence probe](../scripts/litellm-harness/studies/router-precedence/README.md) also found that ten completed protocol-6 candidate-ID attempts passed original acceptance but failed supplemental checks against actual request selection. The recorded control fixes unprefixed wildcard names while introducing a named-team precedence regression. This is posthoc training evidence; original scores remain intact.

A provenance audit corrected the initial supplemental reference imports: a tests-only directory fell through to the live editable package. Fresh exact-commit archives with asserted import origins reproduced all reference outcomes. Separately, host probes generated bytecode later inherited by twelve trial baselines. All twelve original acceptance verdicts/counts reproduced with adjacent caches disabled, and all nineteen supplemental reruns verified their import origins. [The retained audit](../scripts/litellm-harness/snapshot-hygiene-audit.json) identifies affected trials. Existing records remain intact; reusable starting snapshots were cleaned and future launches reject caches.

A later routing run recorded 21 pytest-related jobs without a test-focus notice: the reminder incorrectly depended on conservative check verdicts that excluded its command wrappers. Version 24 counts completed test-like activity separately, deduplicates job polling, and keeps pass/fail receipts conservative. Frozen earlier runs are unchanged.

A follow-up activation audit found eight 10–13 second pytest jobs in the second v24 MCP trial but no reminder: yielded jobs update their original command receipt, while polling calls have no execution receipt. Version 28 scans completed calls for the current turn and deduplicates job IDs; a real background-job regression test verifies activation. This is a mechanism fix, not a demonstrated quality gain.

A [background-retrieval oracle audit](../scripts/litellm-harness/studies/background-router-oracle/README.md) found a failed assertion coupled to a mock configured for one router lookup method. Replacing only that mock with a real Router reproduces base failure, reference success and candidate success. The original 6/7 score stays unchanged; this candidate does not have a demonstrated retrieval defect from that assertion.

Request-level cost analysis found that completed background jobs repeatedly changed the runtime envelope before the original user message, invalidating reuse of subsequent tool history despite unchanged system/tool hashes. The completed [chronological job-event comparison](../scripts/litellm-harness/studies/job-events/README.md) has 2/4 strict successes in each arm and 45.3% lower token-priced spend with the candidate, but one additional timeout. The completed [six-pair transport experiment](../scripts/litellm-harness/studies/prefix-position/README.md) supports the cache mechanism without establishing coding quality. The separate [session-affinity transport pilot](../scripts/litellm-harness/studies/cache-affinity/README.md) completed all six paired scenarios with no useful improvement from a stable user hint; that change is not promoted. Per-action usage assigns the entire model request to its chosen next action, not marginal tool cost; reconciliation gaps remain visible.

A [real streaming-adapter audit](../scripts/litellm-harness/studies/feature-effort/legacy-inheritance/README.md#real-endpoint-check) qualifies 24 hook/stream checks across Chat Completions, Anthropic Messages and Responses. It narrows a critic's diagnosis: two patches handle direct hooks through chat and Messages but fail real Responses behavior differently. The completed [endpoint-aware guide comparison](../scripts/litellm-harness/studies/streaming-contract/README.md) delivers zero strict successes in either arm and costs more with the guide; it is not promoted. No held-out result was used to design that guide.

The completed [inspection-preference comparison](../scripts/litellm-harness/studies/native-inspection/README.md) delivers 2/4 strict successes in each arm, with slightly higher mean time and cost for the preference; it is not promoted. The completed [grouped-edit comparison](../scripts/litellm-harness/studies/batched-edits/README.md) shows lower time and cost on three known tasks, but its raw pass-rate difference is coupled to the background-test design. The [combined comparison](../scripts/litellm-harness/studies/combined-candidate/README.md) remains in progress.

An [empty-choices oracle audit](../scripts/litellm-harness/studies/empty-choices-oracle/README.md) identifies five exact diagnostic-phrase assertions absent from the task contract. Eighteen independent conversion checks give base 3/18, merged reference 18/18 and candidate 18/18. Separate cached-stream observations expose a usage difference in the reference itself and are not treated as a qualified replacement suite; the candidate retains its original 8/13 score.

## Evaluation status

A [feature-removal study](../scripts/litellm-harness/studies/feature-removal/README.md) compares the frozen version-17 harness with no learned guides, no automatic initial map, no forced final review, and a 480-line default read window. The plan uses 16 qualified training/development tasks, five variants, and two repetitions, with randomized order. Frozen worktrees preserve each candidate. Outcomes select the next candidate; they are not final test results. The linked catalogs and patches reconstruct the inputs.

The Bedrock session-tags oracle requires exact error wording absent from the solver prompt. In one 27/34 run, six failures were this wording mismatch; the remaining failure was tuple versus list, which the prompt did specify. Its host oracle note had incorrectly claimed both contracts were supplied. The active study retains its original inputs and raw scores, with this interpretation correction. The router-strategy oracle also includes a new private-helper assertion.

A later [Bedrock tag-order audit](../scripts/litellm-harness/studies/bedrock-tag-order/README.md) found a stronger contradiction: four direct-helper tests require the original unsorted tags, while the curated task asks for sorting at those boundaries. A candidate that sorts correctly fails their order-sensitive STS mocks. The diagnostic confirms intact tag values and assumed credentials; it does not rewrite the raw 24/34 score or its timeout.

A [September 14 development corpus](../scripts/litellm-harness/studies/september14-development/README.md) qualifies 17 of 21 deterministically selected changes, with 97 reference checks. Four new-symbol test-import failures stay excluded. A frozen 34-trial comparison tests the integrated specialization against ordinary Litespeed using the same Flash model/runtime/effort; these are development outcomes, and the training cutoff advances to September 14.

A separate corpus selects 20 recent September 15 Python changes by explicit file-count and diff-size criteria. Fourteen pass base/reference qualification; six have environment, new-private-API, or reference failures and are excluded before solver outcomes. Its outcomes remain reserved. Earlier September 9 reserved tasks predate some training snapshots, so they cannot establish chronological generalization.

Protocol 6 isolates Git configuration, permits ordinary Git inspection through the installed executable, withholds reference revisions/test selections from solvers, and protects frozen host metadata. Earlier protocol-5 trials contained blocked global-Git-config errors. Do not pool protocols for the final comparison.

A [runtime-artifact isolation audit](../scripts/litellm-harness/studies/runtime-artifact-isolation/README.md) subsequently reproduced access to published reports inside the frozen application checkout under protocol 6. Inspection of 13,290 recorded command arguments across 189 completed runs found no matching access, but cannot prove nonaccess. Protocol 7 blocks runtime reports, probes, tests and Git metadata while preserving exact launcher imports. Previous protocol-6 results retain this limitation; the combined comparison was amended in both arms before allocating any trial, and future chronological evaluation requires protocol 7 or stronger.

## Earlier results and limits

The [phase-1 report](litellm-harness-phase1-results.md) retains the original Astra/v9 comparison and v11/v13 follow-ups. Four v9 trials read outside their snapshots; those raw results cannot support superiority. Some reference assertions also require implementation-specific names or wording. The later filesystem boundary addresses the observed access failures, but remains a trusted-model evaluation rather than a complete adversarial sandbox.

The [measurement export](litellm-harness-results.json) preserves completed and interrupted development trials separately, with tool counts, token totals and timing components. Provider time and tool time can overlap; they should not be added to infer elapsed time. All runs occur on one shared desktop, so latency remains observational.

See the [user guide](litellm-harness.md) and [replay protocol](../scripts/litellm-harness/README.md).
