# LiteFusion

LiteFusion keeps one user-facing lead and routes coherent assignments to task-specific models and reasoning levels. It is recommended for new setup; existing sessions and explicit saved arrangements are unchanged. This is an **initial research policy**, not evidence that a mixture beats a frontier model on quality or cost.

The [63-task catalog](litefusion-tasks.md) retains the proposed default/escalation routes, confidence, source URLs and task guides. Only 11 roles have a direct equation-profile link; the other routes are judgment/transfer proposals. The operational overrides are explicit: the selected lead handles controller, classification, conversation, progress and requirements; unavailable Mercury Edit 2 becomes an explicit version-checked edit suggestion; unavailable Voyage Code 4 becomes search and repository investigation. There is no continuous autocomplete or vector index.

## Configure

In either client, open Models → Architecture → LiteFusion. A first selection loads the complete research preset, including **Opus / high** as the lead. Existing LiteFusion sessions preserve their actual lead and show **Custom policy**; choose **Restore preset** to adopt the preset. Each architecture remembers its own models, reasoning, and settings when switching. LiteFusion has no separate Driver, Planner, or Shunt configuration; its lead plans and the task catalog supplies specialists. Task routes and optional experiment controls live under inspection and advanced settings. During a response, model changes queue until the lead and workers settle; stale editors cannot overwrite newer changes. The active model remains visible until the switch applies.

Refresh and pin exact models makes a read-only models-list request. It stores only exact catalog identities. Gateway aliases need an explicit identity binding. Matching a deployment name or accepting configuration is not an execution test. Known incompatible reasoning metadata blocks dispatch; unknown metadata remains provisional. Native edit/embedding services cannot be enabled by binding them to a chat alias.

Every task has two routes: **default** and **hard/escalation**. Both model and native effort can be edited. Search the full catalog, inspect sources and change task handoff/evidence requirements. These stable instructions appear in the lead's system prefix; workers receive only their relevant contract and recipient-specific briefing guidance. Provider continuation rules and task-specific guidance remain distinct. Pair guidance is an evaluation hypothesis, not a claim about a model's psychology.

There is no default assignment-count cutoff. Automatic worker capacity uses the host’s available parallelism as a resource fallback, not a measured cost/quality optimum. Advanced settings allow explicit capacity and assignment limits. Browser, desktop, PDF and connected-tool requirements are checked against the tools actually captured for the worker. A writable GPU task can inspect hardware through Bash; no device is assumed. Tool metadata is evidence of an available interface, not proof it will work. Connected-tool workers borrow a subset of the root's frozen lease. Read-only workers receive only tools declaring read-only metadata, still under root approvals. Metadata and shell command restrictions are not a security sandbox.

## Execution and handoffs

1. The lead decides whether direct work or delegation is worthwhile. It selects a role, `hard` flag, workstream and brief; it does not choose arbitrary model IDs inside the tool call.
2. `delegate` requires an objective (`prompt`), short description, routing reason and acceptance criteria. It accepts constraints, evidence and relevant files. Host data adds the original root request, file hashes, steering, and any prior attempt's actual settled result—including provider errors and retained workspace paths.
3. `hard: true` starts on the escalation route. `repairOf` uses that same route and preserves the logical task identity, including a finished attempt from an earlier user turn in the same session. There is no third hard-task map. A completed or yielded attempt with review findings can receive one explicit same-route repair using `continueFrom`, `repair: true` and actionable evidence; another such repair is rejected. Ordinary local debugging inside a worker does not create an assignment.
4. Compatible task work can reuse its provider-native context and retained private workspace. Each invocation has a new immutable attempt record; the child session identifies the reusable context. Configuration, task identity, provider identity, effort, tool scopes, workstream and read/write posture participate in compatibility. New providers never receive another provider's native transcript. Fresh workers receive their task/model guidance, the current root request and attachment text/path references, declared file versions, constraints, acceptance criteria, evidence, project instructions and scoped tools. Prior lead decisions must be included in the brief; the full lead transcript is not copied. Inline image data without a filesystem path is not forwarded automatically.
5. Workers can call `worker_request` with `needs_help` or `needs_handoff` and evidence. This closes the tool boundary and yields. Only the lead can create a sibling helper with `helperFor`, continue the original, or transfer the work. Workers cannot create subagents, ask users directly, write memory, change policy or increase budgets.
6. `delegate` immediately returns a task ID and an immutable queue receipt. Use `dependsOn` with previously submitted task IDs or workstream names to express prerequisites. The scheduler runs ready tasks independently; fast results can unblock dependents while slow siblings continue. The lead may do independent work, or call `wait_tasks` to wait without paid status polling. Result events are delivered between provider/tool boundaries. Workers retain private workspaces, and source-version checks serialize integration at the lead’s boundaries. Conflicting work is retained for review. Context or policy incompatibility starts a fresh conversation carrying portable evidence; it never forwards a different provider’s native transcript.
7. The lead inspects results and runs combined acceptance checks. After independently resolving a blocked task, it can record `resolve_task` with concrete evidence to release dependents. This is attributed lead judgment; it is not an independent success label. Worker completion, operational verification, integration and external success labels are separate. Review workers have read-only file tools and may run the existing restricted `verify` grammar in Build mode if the root allows Bash. Test scripts still execute workspace code. Plan workers cannot execute commands or mutate source.

Declared files provide handoff context and version evidence; the natural-language editable scope is not an OS path sandbox. Normal file path approvals still apply, and arbitrary approved shell commands retain the user's operating-system rights. Copies isolate ordinary source edits, not databases, cloud resources or other external side effects.

## Provider failures

The provider layer retries eligible HTTP rate limits and temporary failures at most twice, with bounded delays. Recognized credit, authentication, missing-model and invalid-request failures are not retried. LiteFusion records explicit availability failures per provider/model for the current turn. A default worker can move once to its distinct configured escalation destination with an `availability_fallback` reason; the task’s hard/escalation map remains the same. Failed-route observations prevent repeated launches against that route during the turn. Partial source and the settled error report pass to the replacement, with a fresh context. Every attempt remains inspectable and accounted for.

A dropped POST/stream is ambiguous and is not automatically replayed. Invalid tool/parameter requests and context errors require their own correction; they are not treated as evidence that a cheaper or different model is suitable. If the escalation destination is also unavailable, the task fails visibly; independent work can continue. Account-wide credit exhaustion may block several models behind one gateway. A lead failure stops the response and retains worker progress; this release does not silently replace the lead. Configure a working lead or fix access, then continue explicitly. Restart also marks unfinished tasks interrupted without replaying paid work.

## Interface

Team Fusion, Expert Fusion and LiteFusion use compact worker rows. Task numbers follow the lead's call order, including queued calls; escalation keeps the logical task number and shows the owner change. Current activity and one recent completed action are visible; failures, requests for help and pending approval do not disappear when activity changes.

Web: **Inspect worker** opens one inspector in place of the workspace panel on wide screens. Narrow screens show a dedicated history view. Closing restores the retained conversation, workspace panel and draft. The inspector switches workers and related attempt/context history without creating another composer.

Terminal: **Ctrl+P → Inspect worker**, or `/workers`, selects one full-history screen. Enter selects, PgUp/PgDn scroll, and Esc returns to the retained conversation/draft. Stop affects only that worker; the lead is prohibited from automatically respawning its cancelled workstream for that workstream. A differently named semantic duplicate cannot be detected perfectly by a string workstream key.

Sidekick keeps its familiar persistent single-worker inline flow.

## Accounting and optional admission budget

The root request ledger includes lead, workers, retries, automatic compaction, Shunt and review. Entries carry model, reasoning where supplied, invocation identity and request start time. Reported usage has measured request duration. A cancelled/unreported request remains unreported. Tool/environment charges are not metered. There is no invented dollar total when reports are incomplete.

An optional `spend` policy can be imported with a per-accepted-turn USD limit, rescue reserve and **operator-reviewed worst-case request reservations** for every route (including lead and review):

```json
{
  "limitUsd": 10,
  "rescueReserveUsd": 2,
  "requestCeilings": [
    { "providerId": "your-gateway", "model": "your-lead-deployment", "usd": 1.5 },
    { "providerId": "your-gateway", "model": "your-worker-deployment", "usd": 0.3 }
  ]
}
```

These are illustrative amounts, not model prices. No budget is enabled by default. Every admitted request reserves its ceiling synchronously, including concurrent starts and retries. Reservations are retained for the whole turn even if usage is missing; a larger reported charge replaces the ceiling for subsequent admission. Default workers cannot consume the rescue reserve; lead and escalation work may. Unconfigured routes are blocked. Exhaustion leaves work unresolved.

This is a conservative **local admission budget**, not an exact provider-side billing cap. It relies on the operator's ceiling being an upper bound over permitted input/output and gateway pricing. Incorrect ceilings, provider billing behavior, cancellation latency and external tool charges can exceed it. Use provider/gateway quotas for an enforceable billing ceiling. Exported `reservedUsd` is separate from observed cost and must not be used as the measured ROI denominator.

## Versioned policy and Devin evaluation

Export/import is deterministic configuration, not a hidden benchmark crawl. The wrapper has `schemaVersion: 1`, `catalogVersion` and `selection`. Imports reject unknown models, roles, unsupported native efforts and incompatible catalog versions; review and migrate a future research output to the installed catalog before importing it. A policy edit is revision-checked and can be staged during a response; it applies only after active work settles. Each accepted turn pins a routing snapshot and hash, so later metadata cannot change an in-flight dispatch. Adding entirely new model families requires updating the bundled catalog/adapter, not arbitrary inference of capabilities from a name.

Read-only endpoints:

- `GET /api/litefusion/catalog`: all 63 cards and model provenance.
- `POST /api/litefusion/routes`: validate a selection and return route availability/hash; no inference call.
- `GET /api/sessions/:id/litefusion/export`: logical tasks, attempts, ancestry, requested/resolved route/effort, policy/handoff hashes, checks, usage and external labels. Each turn also reports `scheduling.leadWaitMs` and `scheduling.leadRequestsWithPendingTasks` for scheduler comparisons. Export remains available after switching architectures.

Devin should run the existing harness against frozen tasks through ordinary session endpoints, retain the exported run record, and independently grade artifacts. Use the same lead/effort alone as one control; compare Sidekick, a universal handoff, and the task-specific policy with matched budgets. Count all attempts, briefing, review and correction; retain infrastructure failures rather than dropping them. Start with a diverse held-out coding suite and task-family slices; no single public benchmark establishes all 63 roles or the whole product.

Attach a result separately with `POST /api/sessions/:id/litefusion/evaluations`:

```json
{ "turnId": "actual-root-user-message-id", "success": true, "source": "your independent evaluator/run-id", "notes": "Describe the held-out acceptance checks." }
```

Labels are append-only, attributed to their supplied source, and do not rewrite host receipts or acceptance. `success: null` means unresolved. An export includes the latest label plus all earlier labels. The runtime performs no live Harbor evaluation or model performance testing on its own. Existing research/Harbor tooling remains an offline input to the reviewed policy; this repository has no dependency on the original research folder or Python for dispatch.

## Software checks

`npm run check`, the browser suites, `npm run test:tui`, and `npm run test:tui:litefusion` use scripted local providers. The LiteFusion PTY scenario covers the 63-task editor, compact simultaneous workers, a single inspector, independent cancellation and draft restoration at wide/narrow sizes. These establish software behavior, not actual gateway parameter translation, model capability, quality improvement or cost savings. Run those model evaluations separately with explicit credentials and budget.
