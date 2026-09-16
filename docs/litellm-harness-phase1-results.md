# LiteLLM harness phase-1 results

**This campaign does not establish that DeepSeek with this harness is better than Astra with Codex. Four original DeepSeek trials accessed the live checkout outside their historical snapshots, compromising the comparison.** The tables retain raw completed patches that pass every selected reference check, including affected trials; these counts are not an uncontaminated quality score. Some reference checks also impose private implementation details.

The last version in this historical phase is **v13**. Later versions are evaluated separately in the [current campaign report](litellm-harness-results.md). Version 9 received the original 42-run comparison; v11 received a separately frozen seven-run follow-up. A later code review found that mixed team/router queries searched only proxy symbols. V13 fixes that search-area selection, recognizes area names inside Python symbols, and interleaves areas so a large proxy tree cannot consume the scan limit before router code is reached; it has focused regression tests, training replays and a separate seven-run evaluation on these already-known tasks. That final evaluation is post-hoc, not fresh held-out evidence. Do not pool the three harness versions. All three harness versions use the actual Litespeed runner and `fireworks_ai/deepseek-v4p1-flash`. The baseline is the installed Codex CLI with `gpt-6-astra`. Both routes request High reasoning and receive 900 seconds. DeepSeek uses its verified 1,048,576-token context window.

See the [protocol](../scripts/litellm-harness/README.md), [original plan](../scripts/litellm-harness/comparison-plan.json), [follow-up plan](../scripts/litellm-harness/replication-plan.json), [final known-task evaluation](../scripts/litellm-harness/final-evaluation-plan.json), and [all measurements and task revisions](litellm-harness-phase1-results.json).

## Aggregate results

| Route | Raw completed + all checks pass | Out-of-snapshot access | Median seconds | Timeouts | Known DeepSeek token subtotal |
|---|---:|---:|---:|---:|---:|
| Codex / Astra | 9/21 | 0 | 283.7 | 0 | Unavailable |
| LiteLLM v9 / DeepSeek | 8/21 | 4 | 618.4 | 8 | $2.8544 |
| LiteLLM v11 / DeepSeek | 3/7 | 0 | 751.9 | 3 | $1.0147 |
| LiteLLM v13 / DeepSeek (post-hoc) | 3/7 | 0 | 486.2 | 0 | $1.0742 |

Repeated trials of the same task are correlated. Seven curated tasks cannot establish broad superiority. The v11 and v13 evaluations each have one trial per task; do not pool versions or treat their smaller denominators as stronger evidence. V13 was evaluated after prior task outcomes were inspected. Latency is observational because independent tasks ran concurrently on one host.

## Per-task raw completion and acceptance

| Task | Astra | v9 | v11 | v13 post-hoc |
|---|---:|---:|---:|---:|
| openai-schema-patterns | 3/3 | 2/3 | 1/1 | 1/1 |
| databricks-unity | 3/3 | 3/3 | 1/1 | 1/1 |
| mai-image-params | 0/3 | 0/3 | 0/1 | 0/1 |
| bedrock-thinking | 3/3 | 3/3 | 1/1 | 1/1 |
| router-retry-deployment | 0/3 | 0/3 | 0/1 | 0/1 |
| router-request-tags | 0/3 | 0/3 | 0/1 | 0/1 |
| team-router-names | 0/3 | 0/3 | 0/1 | 0/1 |

## Evaluation integrity

The final trace audit found actual live-checkout reads in four v9 trials and one plain-model development run. In particular, one Bedrock run read newer implementation and tests. Passing results from these trials cannot support a fair comparison. All planned trials remain in the tables, visibly marked; no replacement runs were selected to improve the score.

The [review](../scripts/litellm-harness/integrity-review.json) records each affected run. The [audit script](../scripts/litellm-harness/audit.py) flags commands for human inspection; it is a heuristic, not a security boundary. No flags does not prove isolation. Future controlled studies must expose only the task snapshot and installed dependencies to the solver, with the live repository and reference artifacts inaccessible. Offline prose alone did not achieve that here.

## What the reference checks miss or overconstrain

- **MAI image parameters:** several reference checks prescribe an exception subclass and exact prose, whereas the task asks for HTTP 400. The separate post-hoc probe below checks the stated status-code contract. It does not replace the frozen scores.
- **Router request tags:** one of two checks imports `ROUTING_REQUEST_TAGS_METADATA_KEY`, a constant introduced by the human patch. An implementation can preserve caller tags using a different private representation. The other check exercises actual retry selection and logging metadata.
- **Team router names:** several checks call private helpers using newly introduced argument names. Other failures exercise real compression ordering or tagged deployment selection. A raw failing row does not identify which kind occurred.
- **Router retry deployment:** missed async adapter and batch entrypoints are real behavior gaps, not merely naming or diagnostic differences.

Base/reference qualification catches broken environments but does not make a reference test implementation-neutral. These additional issues were identified after candidate freeze and after opening the comparison results. They were not fed back into the frozen candidate.

### Separate MAI HTTP-status probe

The [probe](../scripts/litellm-harness/probes/mai_http_errors.py) checks 15 invalid size/count inputs for HTTP 400, without requiring an exception subclass or phrase. It fails on the base and passes on the human reference. This is a post-hoc diagnostic, not a replacement benchmark.

| Snapshot/run | HTTP checks passed |
|---|---:|
| base | 0/15 |
| reference | 15/15 |
| comparison-r1-mai-image-params-4192401a | 15/15 |
| comparison-r1-mai-image-params-5481946a | 15/15 |
| comparison-r2-mai-image-params-843265b0 | 15/15 |
| comparison-r2-mai-image-params-9edc4f9c | 15/15 |
| comparison-r3-mai-image-params-192069fa | 15/15 |
| comparison-r3-mai-image-params-2d604acf | 15/15 |
| replication-v11-r1-mai-image-params-454d3b5a | 15/15 |
| replication-v13-r1-mai-image-params-c47ff708 | 15/15 |

## Every comparison run

A completed run must finish normally before the limit. A timeout can leave a passing partial patch; it still does not count as a completed success. All planned trials are retained.

| Task | Route | Trial | Reference checks | Seconds | Completed | Integrity issue |
|---|---|---|---:|---:|---|---|
| bedrock-thinking | Codex / Astra | comparison-r1 | 22/22 | 266.7 | True | — |
| databricks-unity | Codex / Astra | comparison-r1 | 5/5 | 183.6 | True | — |
| mai-image-params | Codex / Astra | comparison-r1 | 23/38 | 244.9 | True | — |
| openai-schema-patterns | Codex / Astra | comparison-r1 | 11/11 | 356.7 | True | — |
| router-request-tags | Codex / Astra | comparison-r1 | 1/2 | 231.1 | True | — |
| router-retry-deployment | Codex / Astra | comparison-r1 | 8/11 | 342.4 | True | — |
| team-router-names | Codex / Astra | comparison-r1 | 10/23 | 438.1 | True | — |
| bedrock-thinking | Codex / Astra | comparison-r2 | 22/22 | 293.0 | True | — |
| databricks-unity | Codex / Astra | comparison-r2 | 5/5 | 130.5 | True | — |
| mai-image-params | Codex / Astra | comparison-r2 | 24/38 | 221.0 | True | — |
| openai-schema-patterns | Codex / Astra | comparison-r2 | 11/11 | 427.1 | True | — |
| router-request-tags | Codex / Astra | comparison-r2 | 1/2 | 242.5 | True | — |
| router-retry-deployment | Codex / Astra | comparison-r2 | 8/11 | 362.4 | True | — |
| team-router-names | Codex / Astra | comparison-r2 | 10/23 | 622.0 | True | — |
| bedrock-thinking | Codex / Astra | comparison-r3 | 22/22 | 283.7 | True | — |
| databricks-unity | Codex / Astra | comparison-r3 | 5/5 | 172.2 | True | — |
| mai-image-params | Codex / Astra | comparison-r3 | 23/38 | 219.8 | True | — |
| openai-schema-patterns | Codex / Astra | comparison-r3 | 11/11 | 417.0 | True | — |
| router-request-tags | Codex / Astra | comparison-r3 | 1/2 | 281.7 | True | — |
| router-retry-deployment | Codex / Astra | comparison-r3 | 8/11 | 349.9 | True | — |
| team-router-names | Codex / Astra | comparison-r3 | 10/23 | 542.1 | True | — |
| bedrock-thinking | LiteLLM v9 / DeepSeek | comparison-r1 | 22/22 | 430.8 | True | — |
| databricks-unity | LiteLLM v9 / DeepSeek | comparison-r1 | 5/5 | 307.9 | True | Out-of-snapshot access |
| mai-image-params | LiteLLM v9 / DeepSeek | comparison-r1 | 23/38 | 405.9 | True | — |
| openai-schema-patterns | LiteLLM v9 / DeepSeek | comparison-r1 | 11/11 | 618.4 | True | — |
| router-request-tags | LiteLLM v9 / DeepSeek | comparison-r1 | 1/2 | 908.8 | False | Out-of-snapshot access |
| router-retry-deployment | LiteLLM v9 / DeepSeek | comparison-r1 | 9/11 | 900.2 | False | — |
| team-router-names | LiteLLM v9 / DeepSeek | comparison-r1 | 10/23 | 901.9 | False | — |
| bedrock-thinking | LiteLLM v9 / DeepSeek | comparison-r2 | 22/22 | 364.5 | True | — |
| databricks-unity | LiteLLM v9 / DeepSeek | comparison-r2 | 5/5 | 423.8 | True | — |
| mai-image-params | LiteLLM v9 / DeepSeek | comparison-r2 | 23/38 | 479.4 | True | — |
| openai-schema-patterns | LiteLLM v9 / DeepSeek | comparison-r2 | 11/11 | 614.7 | True | — |
| router-request-tags | LiteLLM v9 / DeepSeek | comparison-r2 | 1/2 | 630.6 | True | — |
| router-retry-deployment | LiteLLM v9 / DeepSeek | comparison-r2 | 8/11 | 912.5 | False | Out-of-snapshot access |
| team-router-names | LiteLLM v9 / DeepSeek | comparison-r2 | 11/23 | 900.8 | False | — |
| bedrock-thinking | LiteLLM v9 / DeepSeek | comparison-r3 | 22/22 | 524.6 | True | Out-of-snapshot access |
| databricks-unity | LiteLLM v9 / DeepSeek | comparison-r3 | 5/5 | 220.7 | True | — |
| mai-image-params | LiteLLM v9 / DeepSeek | comparison-r3 | 23/38 | 496.0 | True | — |
| openai-schema-patterns | LiteLLM v9 / DeepSeek | comparison-r3 | 11/11 | 900.2 | False | — |
| router-request-tags | LiteLLM v9 / DeepSeek | comparison-r3 | 1/2 | 792.4 | True | — |
| router-retry-deployment | LiteLLM v9 / DeepSeek | comparison-r3 | 8/11 | 900.2 | False | — |
| team-router-names | LiteLLM v9 / DeepSeek | comparison-r3 | 9/23 | 911.3 | False | — |
| bedrock-thinking | LiteLLM v11 / DeepSeek | replication-v11-r1 | 22/22 | 371.7 | True | — |
| databricks-unity | LiteLLM v11 / DeepSeek | replication-v11-r1 | 5/5 | 465.2 | True | — |
| mai-image-params | LiteLLM v11 / DeepSeek | replication-v11-r1 | 28/38 | 469.0 | True | — |
| openai-schema-patterns | LiteLLM v11 / DeepSeek | replication-v11-r1 | 11/11 | 751.9 | True | — |
| router-request-tags | LiteLLM v11 / DeepSeek | replication-v11-r1 | 1/2 | 900.2 | False | — |
| router-retry-deployment | LiteLLM v11 / DeepSeek | replication-v11-r1 | 8/11 | 900.8 | False | — |
| team-router-names | LiteLLM v11 / DeepSeek | replication-v11-r1 | 11/23 | 900.2 | False | — |
| bedrock-thinking | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 22/22 | 279.2 | True | — |
| databricks-unity | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 5/5 | 342.7 | True | — |
| mai-image-params | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 22/38 | 363.5 | True | — |
| openai-schema-patterns | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 11/11 | 743.6 | True | — |
| router-request-tags | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 1/2 | 486.2 | False | — |
| router-retry-deployment | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 9/11 | 890.9 | True | — |
| team-router-names | LiteLLM v13 / DeepSeek (post-hoc) | replication-v13-r1 | 12/23 | 831.8 | True | — |

## Development record

These exploratory runs informed changes and task corrections. Earlier runs used incomplete snapshots, a smaller context window or different task wording. They are retained for audit and must not be pooled as an architecture comparison.

| Run | Prompt / snapshot revision | Reference checks | Seconds | Completed | Integrity issue |
|---|---|---:|---:|---|---|
| astra-baseline-converse-config-5ed5df64 | 1 / 1 | 2/2 | 154.0 | True | — |
| astra-baseline-vertex-version-path-ed3df227 | 1 / 1 | 4/6 | 128.7 | True | — |
| baseline-v0-anthropic-image-guardrail-2442e95c | 1 / 1 | 4/5 | 112.4 | True | — |
| baseline-v0-converse-config-992be1d7 | 1 / 1 | 2/2 | 132.2 | True | — |
| baseline-v0-router-candidates-5cc98dd7 | 1 / 1 | 1/1 | 578.2 | True | — |
| baseline-v0-vertex-version-path-a2523db7 | 1 / 1 | 4/6 | 407.8 | True | — |
| boundaries-v2-anthropic-image-guardrail-7a92c084 | 1 / 1 | 4/5 | 161.9 | True | — |
| boundaries-v2-vertex-version-path-00ae47d1 | 1 / 1 | 4/6 | 340.8 | True | — |
| comparison-r1-bedrock-thinking-821089fc | 2 / 1 | Unscored | 245.4 | True | — |
| comparison-r1-databricks-unity-4d99a7d1 | 2 / 1 | Unscored | 128.2 | True | — |
| coverage-v5-empty-choices-ddb56df6 | 2 / 1 | 8/13 | 600.1 | False | — |
| coverage-v5-router-candidates-f640c3b5 | 2 / 1 | 1/1 | 266.4 | True | — |
| coverage-v5-team-member-budget-af2d87a9 | 2 / 1 | 3/5 | 600.1 | False | — |
| effort-low-v7-dashscope-rerank-52ae54aa | 3 / 2 | 3/10 | 382.1 | True | — |
| effort-low-v7-empty-choices-ea753560 | 3 / 2 | 5/13 | 600.2 | False | — |
| effort-low-v7-team-member-budget-5347a879 | 3 / 2 | 3/5 | 600.2 | False | — |
| effort-max-v7-router-strategy-isolation-d60f7aa5 | 3 / 2 | 0/9 | 600.1 | False | — |
| effort-max-v7-vertex-version-path-7d9a8bff | 3 / 2 | 6/6 | 600.1 | False | — |
| focus-v4-databricks-reasoning-7ccff845 | 2 / 1 | 6/6 | 285.8 | True | — |
| inline-max-v9-empty-choices-23c319a4 | 3 / 2 | 6/13 | 600.1 | False | — |
| inline-v9-converse-config-4945178e | 3 / 2 | 2/2 | 163.6 | True | — |
| inline-v9-team-member-budget-c769d326 | 3 / 2 | 2/5 | 600.1 | False | — |
| isolation-v4-baseline-converse-config-7a56e8de | 3 / 2 | 0/2 | 20.0 | True | — |
| isolation-v4-baseline-retry-converse-config-d3af6a07 | 3 / 2 | 2/2 | 147.2 | True | — |
| isolation-v4-converse-config-e9f617b9 | 3 / 2 | 2/2 | 216.7 | True | — |
| navigator-v1-converse-config-5526ab77 | 1 / 1 | 2/2 | 89.9 | True | — |
| navigator-v1-vertex-version-path-2458d6a0 | 1 / 1 | 4/6 | 382.1 | True | — |
| playbook-v10-empty-choices-3d7677bc | 3 / 2 | 8/13 | 403.2 | True | — |
| playbook-v10-team-member-budget-73bad876 | 3 / 2 | 3/5 | 600.2 | False | — |
| playbook-v11-dashscope-rerank-c7939f2d | 3 / 2 | 10/10 | 501.6 | True | — |
| playbook-v11-router-strategy-isolation-02b1dd6e | 3 / 2 | 0/9 | 630.1 | False | — |
| qualified-single-converse-config-38b0f2fd | 3 / 2 | 2/2 | 130.2 | True | — |
| qualified-single-dev-dashscope-rerank-4f2c29ec | 3 / 2 | 2/10 | 571.9 | True | Out-of-snapshot access |
| qualified-single-dev-team-member-budget-82c9fa47 | 3 / 2 | 2/5 | 604.1 | False | — |
| qualified-v7-converse-config-983781f7 | 3 / 2 | 2/2 | 126.5 | True | — |
| qualified-v7-empty-choices-73754528 | 3 / 2 | 6/13 | 549.6 | True | — |
| qualified-v7-router-candidates-a3ca0fdf | 3 / 2 | 0/1 | 327.6 | False | — |
| qualified-v7-team-member-budget-1ab3cc38 | 3 / 2 | 2/5 | 600.1 | False | — |
| replication-development-v11-team-member-budget-a053317b | 3 / 2 | 3/5 | 625.5 | True | — |
| replication-phase2-astra-v5-smoke-converse-config-f1f2a7e4 | 3 / 2 | 2/2 | 121.1 | True | — |
| replication-phase2-v13-r1-anthropic-image-guardrail-8a360f98 | 3 / 2 | 5/5 | 286.2 | True | — |
| replication-phase2-v13-r1-anthropic-tool-document-d7a38288 | 3 / 2 | 2/2 | 556.5 | True | — |
| replication-phase2-v13-r1-bedrock-thinking-6161cbc2 | 3 / 2 | 22/22 | 911.0 | False | — |
| replication-phase2-v13-r1-converse-config-9eeb32f9 | 3 / 2 | 2/2 | 265.4 | True | — |
| replication-phase2-v13-r1-dashscope-rerank-441e2ca9 | 3 / 2 | 5/10 | 900.2 | False | — |
| replication-phase2-v13-r1-databricks-reasoning-194f0e98 | 3 / 2 | 6/6 | 535.7 | True | — |
| replication-phase2-v13-r1-databricks-unity-9c1770c0 | 3 / 2 | 5/5 | 571.7 | True | — |
| replication-phase2-v13-r1-empty-choices-9bac6d1f | 3 / 2 | 8/13 | 701.9 | True | — |
| replication-phase2-v13-r1-mai-image-params-50bb070d | 3 / 2 | 27/38 | 908.1 | False | — |
| replication-phase2-v13-r1-openai-schema-patterns-275312ba | 3 / 2 | 11/11 | 907.9 | False | — |
| replication-phase2-v13-r1-router-candidates-bc4c92e7 | 3 / 2 | 1/1 | 553.8 | True | — |
| replication-phase2-v13-r1-router-request-tags-4d761152 | 3 / 2 | 1/2 | 855.6 | False | — |
| replication-phase2-v13-r1-router-retry-deployment-8f39f599 | 3 / 2 | 9/11 | 881.1 | False | — |
| replication-phase2-v13-r1-router-strategy-isolation-5ebe7114 | 3 / 2 | 8/9 | 908.6 | False | — |
| replication-phase2-v13-r1-team-member-budget-77d7cceb | 3 / 2 | 2/5 | 903.7 | False | — |
| replication-phase2-v13-r1-team-router-names-c0515f3e | 3 / 2 | 1/23 | 553.8 | False | — |
| replication-phase2-v13-r1-vertex-version-path-f38290c6 | 3 / 2 | 4/6 | 185.4 | True | — |
| replication-phase2-v14-medium-anthropic-image-guardrail-8aa0378f | 3 / 2 | 5/5 | 347.8 | True | — |
| replication-phase2-v14-medium-anthropic-tool-document-36483eb9 | 3 / 2 | 2/2 | 437.0 | True | — |
| replication-phase2-v14-medium-converse-config-9cb98681 | 3 / 2 | 2/2 | 326.4 | True | — |
| replication-phase2-v14-medium-dashscope-rerank-eb4508db | 3 / 2 | 9/10 | 779.6 | True | — |
| replication-phase2-v14-medium-databricks-reasoning-e1038264 | 3 / 2 | 6/6 | 668.8 | True | — |
| replication-phase2-v14-medium-empty-choices-6e642c5e | 3 / 2 | 8/13 | 900.2 | False | — |
| replication-phase2-v14-medium-router-candidates-a0307e54 | 3 / 2 | 1/1 | 515.5 | True | — |
| replication-phase2-v14-medium-router-strategy-isolation-4c274617 | 3 / 2 | 5/9 | 884.2 | False | — |
| replication-phase2-v14-medium-team-member-budget-b88e1e45 | 3 / 2 | 3/5 | 910.8 | False | — |
| replication-phase2-v14-medium-vertex-version-path-d9077929 | 3 / 2 | 4/6 | 629.8 | True | — |
| replication-phase2-v14-r1-anthropic-image-guardrail-0f30e583 | 3 / 2 | 5/5 | 507.9 | True | — |
| replication-phase2-v14-r1-anthropic-tool-document-d5495773 | 3 / 2 | 2/2 | 195.8 | True | — |
| replication-phase2-v14-r1-bedrock-thinking-82a856d3 | 3 / 2 | 22/22 | 802.4 | False | — |
| replication-phase2-v14-r1-converse-config-3a61a6c7 | 3 / 2 | 2/2 | 337.7 | True | — |
| replication-phase2-v14-r1-dashscope-rerank-7c578754 | 3 / 2 | 9/10 | 928.6 | False | — |
| replication-phase2-v14-r1-databricks-reasoning-02c2036f | 3 / 2 | 6/6 | 825.7 | True | — |
| replication-phase2-v14-r1-databricks-unity-5e59625e | 3 / 2 | 5/5 | 597.7 | True | — |
| replication-phase2-v14-r1-empty-choices-ff74a934 | 3 / 2 | 8/13 | 907.8 | False | — |
| replication-phase2-v14-r1-mai-image-params-be4df5df | 3 / 2 | 28/38 | 698.5 | True | — |
| replication-phase2-v14-r1-openai-schema-patterns-237ec648 | 3 / 2 | 11/11 | 908.6 | False | — |
| replication-phase2-v14-r1-router-candidates-7a9407ee | 3 / 2 | 1/1 | 552.5 | False | — |
| replication-phase2-v14-r1-router-request-tags-551f3288 | 3 / 2 | 1/2 | 900.2 | False | — |
| replication-phase2-v14-r1-router-retry-deployment-a8af18ee | 3 / 2 | 9/11 | 900.3 | False | — |
| replication-phase2-v14-r1-router-strategy-isolation-3448003b | 3 / 2 | 0/9 | 283.9 | False | — |
| replication-phase2-v14-r1-team-member-budget-4687d818 | 3 / 2 | 4/5 | 900.2 | False | — |
| replication-phase2-v14-r1-team-router-names-7009bdf7 | 3 / 2 | 9/23 | 900.3 | False | — |
| replication-phase2-v14-r1-vertex-version-path-d237e7c1 | 3 / 2 | 4/6 | 374.7 | True | — |
| replication-phase2-v15-smoke-converse-config-17e6d98e | 3 / 2 | 2/2 | 166.7 | True | — |
| replication-phase2-v15-smoke-router-strategy-isolation-44e1bdb1 | 3 / 2 | 5/9 | 906.0 | False | — |
| replication-phase2-v15-smoke-team-member-budget-974f8dc6 | 3 / 2 | 4/5 | 908.9 | False | — |
| replication-phase2-v15-smoke-vertex-version-path-a75147e7 | 3 / 2 | 6/6 | 273.3 | True | — |
| replication-protocol5-v14-medium-r1-anthropic-image-guardrail-ee33e90f | 3 / 2 | 5/5 | 173.6 | True | — |
| replication-protocol5-v14-medium-r1-anthropic-tool-document-24154ce6 | 3 / 2 | 2/2 | 123.0 | True | — |
| replication-protocol5-v14-medium-r1-converse-config-1086fab3 | 3 / 2 | 2/2 | 279.5 | True | — |
| replication-protocol5-v14-medium-r1-dashscope-rerank-33d0a6d6 | 3 / 2 | 10/10 | 605.9 | True | — |
| replication-protocol5-v14-medium-r1-databricks-reasoning-c2847f39 | 3 / 2 | 6/6 | 542.8 | False | — |
| replication-protocol5-v14-medium-r1-empty-choices-89e17382 | 3 / 2 | 2/13 | 289.5 | False | — |
| replication-protocol5-v14-medium-r1-router-candidates-bbb35c29 | 3 / 2 | 1/1 | 432.1 | True | — |
| replication-protocol5-v14-medium-r1-vertex-version-path-1fd10cfc | 3 / 2 | 4/6 | 448.8 | True | — |
| replication-protocol5-v15-low-r1-anthropic-image-guardrail-9f2ff45a | 3 / 2 | 5/5 | 312.3 | True | — |
| replication-protocol5-v15-low-r1-anthropic-tool-document-e033374e | 3 / 2 | 2/2 | 208.3 | True | — |
| replication-protocol5-v15-low-r1-converse-config-a8e8f9cd | 3 / 2 | 2/2 | 169.1 | True | — |
| replication-protocol5-v15-low-r1-dashscope-rerank-140e428c | 3 / 2 | 9/10 | 481.0 | True | — |
| replication-protocol5-v15-low-r1-databricks-reasoning-e7c256f9 | 3 / 2 | 2/6 | 209.0 | False | — |
| replication-protocol5-v15-low-r1-empty-choices-7dec8f0e | 3 / 2 | 2/13 | 256.1 | False | — |
| replication-protocol5-v15-low-r1-router-candidates-46d58a67 | 3 / 2 | 1/1 | 268.9 | True | — |
| replication-protocol5-v15-low-r1-vertex-version-path-d4f54f1c | 3 / 2 | 6/6 | 525.5 | True | — |
| replication-protocol5-v15-medium-r1-anthropic-image-guardrail-20ea2a3e | 3 / 2 | 5/5 | 145.7 | True | — |
| replication-protocol5-v15-medium-r1-anthropic-tool-document-a0afe015 | 3 / 2 | 2/2 | 302.9 | True | — |
| replication-protocol5-v15-medium-r1-converse-config-14979fec | 3 / 2 | 2/2 | 109.9 | True | — |
| replication-protocol5-v15-medium-r1-dashscope-rerank-4e371480 | 3 / 2 | 10/10 | 591.6 | True | — |
| replication-protocol5-v15-medium-r1-databricks-reasoning-e003da1b | 3 / 2 | 6/6 | 412.9 | False | — |
| replication-protocol5-v15-medium-r1-empty-choices-9a50d833 | 3 / 2 | 2/13 | 319.7 | False | — |
| replication-protocol5-v15-medium-r1-router-candidates-03f1404e | 3 / 2 | 1/1 | 340.8 | True | — |
| replication-protocol5-v15-medium-r1-vertex-version-path-8bbeef3d | 3 / 2 | 6/6 | 617.3 | True | — |
| replication-protocol5-v16-medium-r1-dashscope-rerank-a4453620 | 3 / 2 | 10/10 | 840.9 | True | — |
| replication-protocol5-v16-medium-r1-empty-choices-a4e3b9d4 | 3 / 2 | 8/13 | 513.7 | True | — |
| replication-protocol5-v16-medium-r1-router-strategy-isolation-da3a5010 | 3 / 2 | 5/9 | 455.0 | False | — |
| replication-protocol5-v16-medium-r1-team-member-budget-9bc44ff1 | 3 / 2 | 2/5 | 455.6 | False | — |
| replication-stable-v16-medium-r1-router-strategy-isolation-8ada7df9 | 3 / 2 | 5/9 | 605.1 | True | — |
| replication-stable-v16-medium-r1-team-member-budget-9aaef27f | 3 / 2 | 3/5 | 590.8 | True | — |
| replication-stable-v17-medium-r1-router-strategy-isolation-a754566b | 3 / 2 | 5/9 | 510.4 | True | — |
| replication-stable-v17-medium-r1-team-member-budget-2199690f | 3 / 2 | 5/5 | 446.4 | True | — |
| replication-stable-v17-none-r1-router-strategy-isolation-3ad4234b | 3 / 2 | 4/9 | 640.2 | True | — |
| replication-stable-v17-none-r1-team-member-budget-066f93ff | 3 / 2 | 4/5 | 421.4 | True | — |
| review-v3-anthropic-tool-document-76ef2bf6 | 1 / 1 | 2/2 | 131.9 | True | — |
| review-v3-dashscope-rerank-cf0c8898 | 1 / 1 | 4/10 | 601.3 | True | — |
| review-v3-databricks-reasoning-76004611 | 1 / 1 | 3/6 | 210.0 | True | — |
| review-v3-empty-choices-6e78831d | 1 / 1 | 2/13 | 546.0 | True | — |
| review-v3-router-candidates-a5abf172 | 1 / 1 | 1/1 | 548.5 | True | — |
| review-v3-team-member-budget-9be2f1a2 | 1 / 1 | 2/5 | 604.3 | True | — |
| review-v3-vertex-version-path-3b455509 | 1 / 1 | 6/6 | 402.9 | True | — |
| symbols-v6-empty-choices-5d62a72e | 2 / 1 | 2/13 | 490.3 | True | — |
| symbols-v6-full-dashscope-rerank-818e9b29 | 2 / 1 | 4/10 | 570.7 | True | — |
| symbols-v6-team-member-budget-5e216ad9 | 2 / 1 | 2/5 | 600.1 | False | — |
| verification-v12-router-candidates-80d417ce | 3 / 2 | 1/1 | 282.7 | True | — |
| verification-v13-router-candidates-f45a483c | 3 / 2 | 1/1 | 158.6 | True | — |

## Where the work went

Tool and latency counters include all recorded trials, including flagged ones; they describe execution, not uncontaminated quality. DeepSeek repeatedly spent many rounds locating and reconsidering code before its first edit. The navigator is available but is not forced: shell searches remained common. Router tasks still missed alternate async/batch entrypoints and sometimes exhausted the time allowance. The improvements reduce particular navigation and verification failures; they do not establish that prompts repair the underlying reasoning gap.

| Harness | Median requests | Median first-edit round | Shell calls | Navigator calls | Exact repeated calls |
|---|---:|---:|---:|---:|---:|
| LiteLLM v9 / DeepSeek | 74 | 30 | 827 | 27 | 10 |
| LiteLLM v11 / DeepSeek | 79 | 32 | 319 | 7 | 6 |
| LiteLLM v13 / DeepSeek (post-hoc) | 62 | 24 | 260 | 5 | 2 |

## Trace counters

The JSON retains every recorded tool count and output-character total. `readCharacters` counts read_file, grep, glob and litellm_context output only; `bashOutputCharacters` covers command output, and `toolOutputCharacters` covers all tools. Exact repeated-call counts detect identical tool names and arguments, not semantically equivalent commands. Missing token usage remains unavailable, not zero.

## Spending

The local gateway admitted **10028 requests**. Usage/header-priced charges total **$16.5620**. The ledger commits **$46.3350**, including full conservative reservations for **118 unpriced requests**, against a **$100.00 ceiling**. Committed dollars are an upper accounting bound, not actual spend. Account-level billing was unavailable.

Known token charges split into **$9.0484 uncached input**, **$3.9099 cached input**, and **$3.6037 output**. 93.1% of reported input tokens were cached. These components exclude unknown usage.

DeepSeek run subtotals use known token usage and the verified gateway rates. Missing usage is not free. The campaign total also covers exploratory reviewer calls. Codex/Astra dollar charges are unavailable and separate from the DeepSeek ceiling; they are not zero.

## Scope and limitations

This is retrospective repository-specific replay, not a blind or chronological future-PR study. Requirements were curated from public changes; the curator inspected references to qualify tasks. Two tasks failed qualification and were excluded. Historical snapshots share a Python dependency environment rather than reproducing every historical CI setup. Solvers receive fresh source snapshots without the original Git history or reference patches. Separate scoring kept reference patches out of task workspaces, but offline instructions did not prevent live-checkout access. The shell was not isolated, and the integrity failures above invalidate an uncontaminated comparison claim.

The shipping workbench uses protocol 4: a macOS Seatbelt filesystem boundary blocks the live source and other campaign/reference files while permitting the current run and trusted runtime/dependencies. Networking remains available for model APIs; this is not complete adversarial isolation. Real training smoke runs verify the launcher separately. The v9/v11/v13 comparison series used protocol 3 and does not inherit this correction.

Source hashes and task revisions are recorded. Production sessions do not automatically mutate the harness. The shipped guides were distilled from training/development cases, and the v11 follow-up was frozen before comparison outcomes were inspected. Neither a green model-written test nor a green focused reference selection proves the absence of other bugs.
