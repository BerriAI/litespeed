# Replaying the LiteLLM harness campaign

These scripts are an evaluation and improvement workbench for the selectable architecture, not a service required to use it. They run real model calls and can incur charges. Set an explicit ceiling and retain the private ledger between runs.

## Setup

Requirements: Node matching this repository, installed Litespeed dependencies, Python with LiteLLM's test dependencies, a local LiteLLM Git checkout containing the task revisions, and a configured Codex CLI for Astra comparisons. Snapshots preserve tracked regular files, including .gitignore, Makefile, database schemas and repository guidance. Generated dashboard output and files above 15 MiB are omitted. Earlier exploratory snapshots filtered by extension and incorrectly omitted some of this metadata; those runs are kept separate. The current launcher requires macOS: it uses APFS `cp -cR` and `sandbox-exec`. Port both copying and filesystem isolation before using another platform; it fails closed elsewhere. Python dependencies are shared across historical snapshots, so this is not a reconstruction of every historical CI environment.

Use a private directory outside either repository. Store your gateway key in a mode-0600 file there. Do not put it in scripts, task prompts or command arguments.

```sh
export LITELLM_CAMPAIGN_DIR=/absolute/private/campaign
export LITELLM_CAMPAIGN_KEY_FILE=/absolute/private/campaign/gateway-key
export LITELLM_CAMPAIGN_BASE_URL=https://your-gateway.example
export LITELLM_CAMPAIGN_LIMIT_USD=100
export LITELLM_SOURCE_REPO=/absolute/path/to/litellm
export LITELLM_EVAL_PYTHON=/absolute/path/to/litellm/.venv/bin/python

python3 scripts/litellm-harness/prepare.py
python3 scripts/litellm-harness/validate.py
npx tsx scripts/litellm-harness/gateway.ts
```

The gateway runs in its own terminal. It accepts only `fireworks_ai/deepseek-v4p1-flash`, reserves a conservative maximum request cost before dispatch and refuses calls beyond the saved ceiling. It prices cached input, ordinary input and generated tokens separately. The rates in `budget.ts` were verified against the campaign gateway; check your gateway's rates before starting another campaign. Account-level spend was unavailable on the original key. This ledger covers requests through this local process, not other uses of the account.

Missing usage and interrupted requests retain their full reservation. **Committed dollars are an upper accounting bound, not measured spend.** Do not report unpriced reservations as actual charges. An exclusive lock prevents two gateway processes from separately admitting requests against the same ledger. After a crash, verify that the recorded process is gone before removing `gateway.lock`. Do not reset a ledger to obtain more budget.

## Run and score

In another terminal with the same environment:

```sh
npx tsx scripts/litellm-harness/run.ts converse-config single baseline
npx tsx scripts/litellm-harness/run.ts converse-config litellm-specific candidate
npx tsx scripts/litellm-harness/run.ts converse-config codex astra

python3 scripts/litellm-harness/score.py /absolute/private/campaign/runs/RUN_DIRECTORY
python3 scripts/litellm-harness/analyze.py
```

New runs use evaluation protocol 4. The launcher prepares a snapshot, then starts the solver under a macOS Seatbelt filesystem profile. The live source checkout, other campaign runs and reference artifacts are unreadable; the current run, Litespeed runtime and installed dependency trees remain available. Writes to the live source and dependency environment are blocked. Codex gets a fresh private home with only its authentication copied. The profile and source hashes are retained for audit. This is a filesystem boundary, not complete adversarial isolation: model API networking remains available, and the runtime/dependencies must be trusted.

Each run gets a fresh snapshot, a new Git repository with one starting commit, and its own Litespeed state. The original history and reference patch/tests are absent from the solver workspace. Raw traces and credentials are private artifacts, not files to commit in this repository. Scoring copies the candidate into `acceptance-workspace` before restoring reference tests; never use that directory as a solver input. Early exploratory runs were scored in place, so always start another run from a new snapshot.

The optional fifth run argument selects the requested reasoning effort (`high` by default). Low and Max development trials are retained separately. The frozen comparison uses High reasoning for both routes. Litespeed uses the selected architecture, the gateway-advertised 1,048,576-token context window, memory disabled and no connected tools. Labels beginning with `comparison-` or `replication-` receive a 900-second timeout; other development runs receive 600 seconds. Earlier exploratory runs used an artificially low 131,072-token configuration and some triggered compaction; they must not stand in for the final candidate comparison. Compaction archives are retained for complete tool accounting. The recorded protocol-3 Codex runs used the installed CLI, exact model `gpt-6-astra`, the requested reasoning effort, ephemeral execution, workspace-write policy, disabled web search and a 900-second timeout. Protocol 4 keeps those model/settings but uses the outer Seatbelt filesystem policy; the CLI inner sandbox is disabled because nested macOS sandbox application fails. This does not remove the inherited outer boundary. Codex account usage is separate from the DeepSeek gateway ceiling; its dollar charge is unavailable and must not be reported as zero.

The recorded v9/v11/v13 series used protocol 3, which only told solvers to work offline and within their checkout. The final audit found four v9 trials reading the live checkout, plus one plain-model development trial. Their raw results are retained and flagged in [the integrity review](integrity-review.json); they cannot support a fair superiority claim. The new protocol-4 launcher blocks those filesystem paths. The final pytest scorer also blocks network connections and ignores external pytest configuration. Do not reinterpret older runs as having the new boundary.

## Task and oracle qualification

The corpus contains retrospective requirements derived from public changes, not original pre-merge issues. `task-prompts.json` corrects omissions found during task auditing. Every solver receives the same task revision. Do not combine runs with different requirements into one comparative score.

Before a paid run, the unpatched snapshot must fail the selected behavioral checks and the reference patch must pass them in the scoring environment. Import errors, missing fixtures, network setup and reference-patch failures are task-environment problems, not model failures. Two initial tasks failed this qualification and remain excluded unless their environment/oracle is repaired.

Reference tests that directly require newly introduced helper names are excluded from primary scoring. Their node IDs remain in each manifest for audit. Alternate implementations can satisfy the public behavior without copying the human patch. Passing the selected tests still does not prove the absence of regressions, security bugs or requirements those tests omit; inspect patches and relevant neighboring behavior as well.

The train/dev/test labels separate improvement tasks from the final task comparison. They are not a chronological future-PR split, and the curator has inspected the reference changes while validating tasks. Do not describe these results as a blind study, a production deployment result, or a guarantee on arbitrary future LiteLLM work.

The [original plan](comparison-plan.json) records v9, with three trials per route and task. The [follow-up plan](replication-plan.json) records v11, with one additional DeepSeek trial per task. Source hashes and commits distinguish them. The shipped v13 adds separately tested navigation corrections and a [final evaluation](final-evaluation-plan.json) on the same known tasks. This evaluation took place after inspecting previous outcomes; it is post-hoc and must remain separate from the earlier comparisons.

### Access audit

After completing runs, execute `python3 scripts/litellm-harness/audit.py` with the setup environment. Inspect the private `access-audit.json`, including outputs of flagged commands and any background polls. The script flags likely live-source, external-tool and history access; string matching is not proof of isolation. Preserve failed and compromised trials instead of quietly replacing them. The checked-in `integrity-review.json` documents the manual review of this campaign.

### Diagnostic audits after scoring

Base/reference qualification does not remove every implementation-specific assertion. In this campaign, MAI tests also prescribed an exception subclass and exact wording beyond the stated HTTP-400 contract; router tests sometimes prescribed new private names. Keep the original results. Diagnose these cases separately, and label any added probe as post-hoc.

After the normal scorer creates each `acceptance-workspace`, the MAI diagnostic can be reproduced with:

```sh
python3 scripts/litellm-harness/audit-mai.py /absolute/private/campaign/runs/MAI_RUN_DIRECTORY
```

This runs the same 15 HTTP-status checks against the base, the validated human reference and the supplied candidates. It writes `mai-audit.json` without modifying their frozen acceptance scores. It is not a replacement for regression checks or a new held-out benchmark.

## Improve deliberately

1. Run a fixed candidate on training/development tasks.
2. Inspect failures, repeated tool calls, long reads, speculative edits and time spent in commands. Check the task wording and reference environment before blaming the model.
3. Change one reusable mechanism or instruction, version it, and rerun affected development tasks.
4. Freeze the candidate before comparing held-out tasks. Preserve failures and repeated trials; do not select only the best run.
5. Publish task-level acceptance, elapsed time, request/token counts, priced spend, unknown reservations and limitations. Keep raw private transcripts out of the PR.
