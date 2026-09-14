# LiteFusion: all 63 task cards

Research snapshot 2026-09-13 · policy 2026-09-13.1. The runtime uses the exact source policy in `shared/litefusion-catalog.json`. These are proposed configurations, not measured local success probabilities.

Lead-owned rows keep the selected lead. Mercury Edit 2 and Voyage Code 4 are unavailable native services; their shared escalation routes implement explicit suggestions/search only. Environment gates still apply. See [runtime details](litefusion.md).

| # | Task ID / work | Default | Hard / escalation | Execution |
| --- | --- | --- | --- | --- |
| 1 | `controller` — Single controller: decomposition, dispatch and integration | Claude Opus 5 / high | Claude Fable 5.1 / xhigh | lead |
| 2 | `agent_harness_construction` — Build and tune a multi-model agent harness | Claude Opus 5 / max | GPT-5.6 Sol / xhigh | worker |
| 3 | `task_classification` — Ticket classification and initial routing | GPT-5.6 Luna / none | Claude Opus 5 / high | lead |
| 4 | `developer_chat` — Natural developer conversation and clarification wording | GPT-5.6 Luna / none | Gemini 3.8 Flash / high | lead |
| 5 | `progress_messages` — Progress messages, changelog summaries and status formatting | GPT-5.6 Luna / none | Claude Haiku 4.5 / off | lead |
| 6 | `requirements` — Ambiguous requirement analysis and acceptance criteria | Claude Opus 5 / high | Claude Fable 5.1 / xhigh | lead |
| 7 | `architecture` — System architecture, boundaries and consequential trade-offs | GPT-6 Astra / xhigh | Claude Fable 5.1 / xhigh | worker |
| 8 | `api_contract` — API/interface design and backward compatibility | GPT-6 Astra / xhigh | Claude Fable 5.1 / xhigh | worker |
| 9 | `semantic_code_index` — Semantic code search and repository indexing | Voyage Code 4 / not_applicable | Kimi K3 / max | read |
| 10 | `repository_qa` — Codebase onboarding, call paths and difficult repository Q&A | Kimi K3 / max | Claude Fable 5.1 / xhigh | read |
| 11 | `doc_lookup` — Interactive lookup in technical documentation | GPT-5.6 Luna / high | GPT-5.6 Luna / max | read |
| 12 | `long_document_extraction` — Precise extraction from long technical documents | GPT-5.6 Luna / max | Kimi K3 / max | read |
| 13 | `pdf_extraction` — Read tables and extract data from engineering PDFs | GPT-5.6 Luna / high | GPT-6 Astra / xhigh | read · pdf |
| 14 | `handoff_compression` — Compress worker history into an evidence brief | GLM-5.3-Flash / max | Claude Fable 5.1 / high | bounded |
| 15 | `memory_update` — Extract and update durable project memory | GLM-5.3-Flash / max | Claude Opus 5 / high | bounded |
| 16 | `bounded_patch` — Small implementation patch with explicit tests and interface | GLM-5.3-Flash / max | Gemini 3.8 Flash / high | worker |
| 17 | `repository_implementation` — Substantial repository feature or bug fix | Gemini 3.8 Flash / high | GPT-6 Astra / xhigh | worker |
| 18 | `mechanical_edits` — Mechanical edits, repetitive codemods and syntax repairs | GPT-5.6 Luna / high | GPT-5.6 Luna / max | worker |
| 19 | `large_refactor` — Large refactor across modules and call sites | GPT-6 Astra / xhigh | Claude Fable 5.1 / xhigh | worker |
| 20 | `dependency_migration` — Dependency/framework upgrades and API migrations | GPT-6 Astra / xhigh | Claude Fable 5.1 / xhigh | worker |
| 21 | `language_migration` — Module-level C/C++ to Rust or cross-language translation | GPT-6 Astra / xhigh | Claude Fable 5.1 / xhigh | worker |
| 22 | `inline_completion` — Editor fill-in-the-middle autocomplete | Mercury Edit 2 / not_applicable | GPT-5.6 Luna / high | bounded |
| 23 | `next_edit` — Predict the next small editor change | Mercury Edit 2 / not_applicable | GPT-5.6 Luna / high | bounded |
| 24 | `regression_tests` — Routine unit and regression test implementation | Gemini 3.8 Flash / high | Claude Fable 5.1 / xhigh | worker |
| 25 | `acceptance_tests` — High-stakes test design and independent acceptance coverage | Claude Fable 5.1 / xhigh | Claude Opus 5 / xhigh | worker |
| 26 | `flaky_tests` — Diagnose flaky tests and nondeterministic failures | GPT-6 Astra / high | GPT-6 Astra / xhigh | worker |
| 27 | `error_triage` — Initial stack-trace and CI failure triage | GLM-5.3-Flash / max | GPT-6 Astra / high | read |
| 28 | `terminal_systems` — Difficult build, terminal and environment repair | GPT-6 Astra / high | GPT-6 Astra / xhigh | worker |
| 29 | `kubernetes_incident` — Kubernetes incident/root-cause investigation | GPT-5.6 Sol / max | GPT-6 Astra / high | read |
| 30 | `infrastructure_code` — Infrastructure as code, deployment config and CI repair | Gemini 3.8 Flash / high | GPT-6 Astra / high | worker |
| 31 | `release_engineering` — Release checks, compatibility and rollback planning | GPT-6 Astra / high | Claude Fable 5.1 / xhigh | worker |
| 32 | `simple_sql` — Bounded read-only SQL and query repair | GLM-5.3-Flash / max | Gemini 3.8 Flash / high | worker |
| 33 | `complex_sql` — Complex SQL, large schemas and analytical business rules | Gemini 3.8 Flash / high | GPT-6 Astra / xhigh | worker |
| 34 | `dbt_analytics` — dbt/analytics engineering and data pipeline repair | Gemini 3.8 Flash / high | GPT-6 Astra / xhigh | worker |
| 35 | `database_migration` — Database schema migration and data preservation | GPT-6 Astra / xhigh | Claude Fable 5.1 / xhigh | worker |
| 36 | `data_notebooks` — Data cleaning, analysis notebooks and exploratory plots | GPT-5.6 Luna / max | Gemini 3.8 Flash / high | worker |
| 37 | `frontend_prototype` — Frontend layout and interactive prototypes | Qwen3.8-Flash-Next / xhigh | GPT-6 Astra / max | worker |
| 38 | `frontend_polish` — Consequential visual design and final UI polish | GPT-6 Astra / max | Claude Fable 5.1 / max | worker |
| 39 | `frontend_bug` — Frontend state, forms and interaction bug fixes | Gemini 3.8 Flash / high | GPT-6 Astra / xhigh | worker |
| 40 | `accessibility` — Accessibility remediation and keyboard interaction | Gemini 3.8 Flash / high | GPT-6 Astra / xhigh | worker |
| 41 | `browser_tests` — Playwright/browser end-to-end test implementation | Gemini 3.8 Flash / high | Claude Fable 5.1 / xhigh | worker |
| 42 | `scientific_first` — Scientific/numerical code with a strong verifier: first attempt | GPT-5.6 Luna / max | Muse Spark 1.3 / xhigh | worker |
| 43 | `scientific_specialist` — Hard numerical subproblems and mathematical function implementation | Muse Spark 1.3 / xhigh | Claude Fable 5.1 / xhigh | worker |
| 44 | `scientific_repository_repair` — Scientific repository repair and cross-module scientific integration | GPT-6 Astra / max | Claude Opus 5 / max | worker |
| 45 | `cpu_performance` — CPU algorithm and application performance optimization | GPT-6 Astra / xhigh | Claude Fable 5.1 / xhigh | worker |
| 46 | `gpu_prototype` — GPU/Triton/CUDA kernel prototype | DeepSeek V4.1 Flash / max | Claude Fable 5.1 / max | worker · gpu |
| 47 | `gpu_final` — High-value GPU kernel optimization and final implementation | Claude Fable 5.1 / max | GPT-6 Astra / xhigh | worker · gpu |
| 48 | `security_reproduction` — Authorized vulnerability reproduction and exploit regression | DeepSeek V4.1 Flash / max | Kimi K3 / max | worker |
| 49 | `secure_implementation` — Secure code generation and vulnerability remediation | Claude Fable 5.1 / high | GPT-6 Astra / high | worker |
| 50 | `security_review` — Independent security patch review and authorization logic audit | GPT-6 Astra / high | Claude Fable 5.1 / xhigh | review |
| 51 | `dependency_exploitability` — Dependency-alert reachability and exploitability assessment | Claude Opus 5 / high | GPT-6 Astra / xhigh | read |
| 52 | `cheap_code_review` — Inexpensive first-pass review finding generation | GLM-5.3-Flash / max | GPT-6 Astra / high | review |
| 53 | `final_code_review` — Consequential correctness and integration review | GPT-6 Astra / high | Claude Fable 5.1 / xhigh | review |
| 54 | `technical_documentation` — README, API documentation and developer guides | GPT-5.6 Luna / high | Kimi K3 / max | worker |
| 55 | `migration_guide` — Complex migration and integration documentation | Kimi K3 / max | Claude Fable 5.1 / high | worker |
| 56 | `tool_automation` — Stateful engineering-tool automation | DeepSeek V4.1 Flash / max | Grok 4.6 / high | worker · connected_tools |
| 57 | `c_cpp_security_repair` — C/C++ memory-safety repair with semantic preservation | GPT-5.6 Sol / medium | Claude Fable 5.1 / high | worker |
| 58 | `security_patch_backport` — Backport a known security fix across versions or forks | GPT-5.6 Sol / medium | GPT-6 Astra / xhigh | worker |
| 59 | `mcp_complex_workflows` — Complex MCP workflows across repository and business tools | Kimi K3 / max | GPT-5.6 Sol / max | worker · connected_tools |
| 60 | `browser_operation` — Complex browser operation for engineering workflows | GPT-6 Astra / medium | GPT-6 Astra / high | worker · browser |
| 61 | `browser_read_first_attempt` — Bounded read-only browser lookup: cheap first attempt | GPT-5.6 Luna / high | GPT-6 Astra / medium | read · browser |
| 62 | `desktop_operation` — Desktop GUI workflows and application verification | GPT-6 Astra / high | GPT-6 Astra / xhigh | worker · desktop |
| 63 | `whole_repository_stack_migration` — Whole-repository language, framework, platform or build-stack migration | Claude Opus 5 / xhigh | GPT-6 Astra / max | worker |

## Task evidence and handoff instructions

### controller

Own the dependency graph and acceptance decisions. Assign independent, reviewable units; keep integration authority. Delegate only when expected saved work exceeds briefing and review. Revise the plan when evidence contradicts it.

Required evidence: Every completed task links to a pinned artifact, observed checks and integration status. Reconcile conflicting worker evidence before acceptance.

Provenance: moderate · Most direct current evidence is Agent Arena code orchestration. Opus high has similar point net improvement to Astra max at lower median task cost. No public test establishes this exact org or best controller at matched effort. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://arena.ai/leaderboard/agent/code)
- [Source 2](https://cognition.com/blog/local-fusion)

### agent_harness_construction

Supply the workload, permitted API menu, serving budget, acceptance contract and existing harness. Measure the baseline before rewriting it. Inventory requirements and unresolved facts; compare model and architecture alternatives using calibration evidence. Retain useful existing routing. Explicitly test pagination, ambiguous writes, retry/idempotency behavior and complete billing. Give Opus max the actual serving-model menu, workload, lifetime volume and operating budget. Require a measured starting baseline before rewriting it, compare plausible routing designs, recover source requirements, and test the complete agent on held-out behavior. Model familiarity is not evidence for choosing a provider; preserve useful existing architecture unless measured results justify replacing it.

Required evidence: Hold-out end-to-end behavior, full serving spend, independent tests and observed failure recovery. Developer-written tests must not weaken to match behavior. Preserve client/source evidence and expose unresolved requirements; the builder may not read hidden evaluator data.

Provenance: moderate · Hyper-tau August/September native-harness results favor Opus5max/ClaudeCode23.9 budget-adjusted score versus Solxhigh/Codex22.0. Mean developer build bills are$42 and$18.2 respectively; these exclude a complete deployed-service bill. Choose Opus for a consequential reusable harness and keep Sol as the lower-build-cost alternative. Lifetime workload and actual serving economics could reverse the choice; newest Astra/Fable/Gemini3.8 were absent. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://sierra-research.github.io/hyper-tau-bench/)
- [Source 2](https://github.com/sierra-research/hyper-tau-bench)
- [Source 3](https://arxiv.org/html/2609.04611v1)

### task_classification

Provide the allowed role IDs, concise definitions, repository metadata and examples. Return role_id, stakes, ambiguity and missing inputs. Use unknown instead of inventing a category.

Required evidence: Schema validation, deterministic high-risk overrides and held-out label/confusion review.

Provenance: low · Cost/latency-oriented prior; no direct measured routing accuracy for Luna none. The code classifier must be calibrated on local labels. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/models/gpt-5-6-luna)
- [Source 2](https://cognition.com/blog/local-fusion)

### developer_chat

Supply the actual question, audience, known facts and desired response length. Write naturally; ask the smallest useful clarification. Do not make technical decisions beyond supplied evidence.

Required evidence: Faithfulness to supplied state, user preference and latency; no invented progress or commitments.

Provenance: low · Low-cost default for grounded short replies: AA reports about5.62s for a500-token answer versus6.95s for Haiku off, although Haiku has a faster first token(.71s versus.93s). Luna has much lower input/output prices. This is a proposed price/latency choice; no matched human preference experiment establishes Luna none as the quality winner. Keep Haiku off as a style/first-token-latency challenger. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://arena.ai/leaderboard/text)
- [Source 2](https://artificialanalysis.ai/models/gpt-5-6-luna)

### progress_messages

Use only the provided event log. Distinguish started, changed, checked and completed. Include the next concrete step in at most three sentences.

Required evidence: Compare claims to source event IDs and actual test/artifact status.

Provenance: low · Mechanical transformation of verified state is a low-cost prior; Luna none has no direct coding-quality guarantee. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/models/gpt-5-6-luna)

### requirements

Supply user intent, stakeholder constraints and existing behavior. Identify decisions that affect implementation; propose observable acceptance criteria and label assumptions.

Required evidence: Trace every criterion to a stated requirement or an explicit proposed assumption; challenge omissions and incompatible goals.

Provenance: low · Controller evidence transfers plausibly; requirements/design benchmarks do not prove current-model leadership. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://arena.ai/leaderboard/agent/code)
- [Source 2](https://arxiv.org/html/2604.06683v1)

### architecture

Specify workloads, SLOs, trust boundaries, data ownership and migration constraints. Ask for alternatives, failure modes, reversibility and a decision record; allow independent exploration.

Required evidence: Executable feasibility spikes where possible, explicit data-flow review, capacity assumptions and independent architectural challenge.

Provenance: moderate · Strong current refactoring/system evidence; open-ended architecture transfer remains unmeasured. SAKE accuracy and diagram similarity are insufficient. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-refactoring)
- [Source 2](https://www.tbench.ai/leaderboard/terminal-bench/4.0)
- [Source 3](https://arxiv.org/html/2604.06683v1)
- [Source 4](https://arxiv.org/html/2606.29520v1)

### api_contract

Provide existing schemas, clients, error semantics, versioning and compatibility constraints. Require a consumer map and migration path before changing contracts.

Required evidence: Contract tests, old-client compatibility, serialization and failure-mode cases.

Provenance: moderate · SWE-Atlas refactoring provides relevant consumer/interface evidence, not a direct API design leaderboard. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-refactoring)

### semantic_code_index

Version chunks by repository commit and symbol. Separate query/document embedding input types. Return path, range and source hash; combine semantic with lexical and symbol search.

Required evidence: Recall/NDCG on held-out real navigation queries, freshness checks and end-to-end task success.

Provenance: moderate · Voyage provider retrieval suite favors Code4, including over Codestral Embed; private-heavy NDCG evidence does not prove downstream coding success. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://blog.voyageai.com/2026/08/13/voyage-code-4/)

### repository_qa

Provide the concrete question and repository boundary, not a guessed answer. Permit exploration and require actual call paths, file references and distinctions between static inference and observed runtime.

Required evidence: Verify cited code and answer requirements; run a minimal probe for claims that depend on runtime.

Provenance: moderate · Kimi K3 max leads the reviewed independent SWE-Atlas-QnA coding-agent table. Its cost advantage for this exact role is not fully measured. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/agents/coding-agents)

### doc_lookup

Give the exact question and a small set of current primary docs. Find the supporting passage first and quote only the relevant line or API field.

Required evidence: Every factual claim has a matching current source; abstain on absent documentation.

Provenance: low · A latency-saving step below the measured Luna-max long-context result; interactive high-effort quality is a proposed transfer. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/evaluations/artificial-analysis-long-context-reasoning)
- [Source 2](https://artificialanalysis.ai/models/gpt-5-6-luna)

### long_document_extraction

Supply the full relevant context, exact fields and citation format. Separate explicit statements, deductions and missing facts; preserve contradictory passages.

Required evidence: Source-grounding checks and independently reviewed sampled extractions.

Provenance: moderate · AA-LCR: Luna max 83.67%, approximately $.0209 per question; Kimi max 88.67% at $.3086. The default uses a proposed five-point quality tolerance; freeze this before a new held-out comparison. · Equation profile: long_document_extraction.

- [Source 1](https://artificialanalysis.ai/evaluations/artificial-analysis-long-context-reasoning)
- [Source 2](https://artificialanalysis.ai/models/gpt-5-6-luna)

### pdf_extraction

Provide original pages and expected fields/units. Distinguish headers, footnotes and table cells. Report unreadable regions and check extracted totals.

Required evidence: Page-level citations, arithmetic reconciliation and visual inspection of uncertain cells.

Provenance: low · GDP.pdf measures free-form answers grounded in PDF packages with criterion-level judging. Luna high is an inexpensive first attempt; this does not directly measure exact engineering-table extraction. · Equation profile: professional_pdf_first_attempt.

- [Source 1](https://artificialanalysis.ai/models/gpt-5-6-luna)

### handoff_compression

Preserve objective, constraints, decisions, unresolved contradictions, exact paths, commands, errors and artifact hashes. Separate observed facts from hypotheses. Do not compress away failures.

Required evidence: Schema validation plus lead checks of requirements, contradictions and artifact references; replay on a holdout before relying on it.

Provenance: low · Low-cost long-context performance is suggestive; no benchmark directly proves lossless coding handoff compression. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/models/glm-5-3-flash)
- [Source 2](https://cognition.com/blog/local-fusion)
- [Source 3](https://xiaowu0162.github.io/longmemeval-v2/)

### memory_update

Write only stable decisions and useful corrections with source, scope and date. Preserve superseded facts as history; do not treat past authorization as current permission.

Required evidence: Conflict/duplication checks, cited provenance and downstream memory-use evaluation.

Provenance: low · Long-context and memory benchmarks favor task-specific memory design; current model assignment is a cost-oriented prior. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://xiaowu0162.github.io/longmemeval-v2/)
- [Source 2](https://artificialanalysis.ai/models/glm-5-3-flash)

### bounded_patch

Give the exact behavior, editable scope, interfaces, invariants and acceptance commands. Permit local investigation; escalate a scope mismatch or repeated unchanged failure.

Required evidence: Targeted behavioral and regression checks outside the patch; validate diff scope and actual exit codes.

Provenance: moderate · DeepSWE equal-task result .635 at about $.484 per attempt. Low-cost first-stage candidate; small-patch specialization and final cascade quality remain unmeasured. · Equation profile: bounded_patch_first_attempt.

- [Source 1](https://deepswe.datacurve.ai/)

### repository_implementation

Provide outcome, invariants and completion boundary. Allow targeted exploration and a revised implementation plan. Preserve native thought signatures across tool turns.

Required evidence: New behavior plus regression tests, type/build checks and independent acceptance review.

Provenance: moderate · DeepSWE fixed-harness equal-task quality .7397 near Astra xhigh .7412, at about $2.35 per attempt. Harness and local workload may change the ordering. · Equation profile: repository_implementation.

- [Source 1](https://deepswe.datacurve.ai/)

### mechanical_edits

Provide the precise rewrite rule, positive and negative examples, affected symbols and files. Prefer deterministic AST tools when available; change only verified matches.

Required evidence: AST/diff inspection, parse/type checks and idempotence of the transformation.

Provenance: low · Bounded transformation prior; open-ended DeepSWE performance is much weaker at high than max, so scope must remain mechanical. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://deepswe.datacurve.ai/)

### large_refactor

Map all callers and compatibility obligations, identify obsolete paths and prove intended behavior preservation. Do not make tests easier to fit the patch.

Required evidence: Unchanged acceptance tests, complete consumer updates and independent diff review.

Provenance: moderate · Current SWE-Atlas refactoring leader at 59.05%; no comparable task-cost column. Chosen for quality under behavior-preservation stakes. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-refactoring)

### dependency_migration

Provide current/target versions, official migration docs, removed APIs and compatibility policy. Inventory consumers and stage reversible changes.

Required evidence: Clean install, build, representative end-to-end flows and rollback/compatibility tests.

Provenance: moderate · Relevant refactoring evidence and Fusion migration study; exact newest-version upgrade success/ROI not established. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-refactoring)
- [Source 2](https://cognition.com/blog/local-fusion)

### language_migration

Specify ABI, ownership, threading, serialization and unsafe-code policy. Preserve semantics before optimizing; isolate unavoidable unsafe boundaries with invariants.

Required evidence: Differential/property tests, sanitizer runs, ABI checks and explicit unsafe review.

Provenance: low · Current strong refactoring prior for a bounded component; CRUST/Multi-SWE evidence does not establish this model as the migration winner. Use the separate whole-repository stack migration role for a complete language or framework replacement. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-refactoring)
- [Source 2](https://github.com/anirudhkhatry/CRUST-bench)

### inline_completion

Send prefix, suffix, language and current file version through the FIM endpoint. Keep output bounded to the insertion; reject stale suggestions.

Required evidence: Accepted-edit rate, syntactic validity, suggestion latency and subsequent revert rate.

Provenance: moderate · Dedicated FIM endpoint and provider comparison of edit/completion tasks; independent current quality/cost validation is limited. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://www.inceptionlabs.ai/blog/introducing-mercury-edit-2)

### next_edit

Send 3–5 current snippets, 3–5 chronological edits, cursor and a 10–15-line editable region. Use the documented edit endpoint and replacement-region parser.

Required evidence: Source-version match, bounded diff, user acceptance and persistent correctness after later edits.

Provenance: moderate · Dedicated next-edit model uses recent edit history. Provider benchmark combines heterogeneous scores; no universal rank claim. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://www.inceptionlabs.ai/blog/introducing-mercury-edit-2)

### regression_tests

Provide intended behavior, existing test conventions and bug reproduction. Demand assertions that fail on the broken behavior, including relevant edge cases.

Required evidence: Run tests against both broken and fixed variants where available; use mutants for assertion discrimination.

Provenance: moderate · SWE-Atlas test-writing gives Gemini a useful quality signal; the table does not expose an exact effort/cost for that row, so high is proposed. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-tw)

### acceptance_tests

Design tests from requirements before seeing the worker rationale. Cover invariants, error paths, state transitions and adversarial cases; identify what remains untested.

Required evidence: Demonstrated failure on meaningful mutants/regressions and pass on correct implementation; independently inspect security-sensitive assertions.

Provenance: moderate · Fable5.1 xhigh leads SWE-Atlas test writing at 67.04%; framework includes test correctness and mutant discrimination. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-tw)

### flaky_tests

Supply repeat logs, seeds, timing, environment diffs and isolation boundaries. Separate race, dependency, clock and infrastructure hypotheses; change one factor at a time.

Required evidence: Repeated reproduction and disappearance under controlled conditions; report confidence and remaining nondeterminism.

Provenance: low · Terminal/system strength is relevant; no direct current-model flaky-test ROI comparison found. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://www.tbench.ai/leaderboard/terminal-bench/4.0)

### error_triage

Return the first causal error with exact raw evidence, affected component and two testable hypotheses. Keep logs accessible; label speculation and stop after a bounded investigation.

Required evidence: Controller checks the cited error and confirms the proposed discriminating command before broader work.

Provenance: low · Cheap bounded diagnosis prior. Do not let a weak scout’s confident hypothesis anchor the stronger investigator. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://deepswe.datacurve.ai/)
- [Source 2](https://cognition.com/blog/local-fusion)

### terminal_systems

Give exact environment, artifact target, commands/errors already observed and resource limits. Allow autonomous diagnosis, but require a working artifact and reproducible instructions.

Required evidence: Actual clean build/run and behavioral checks; classify provider/environment failure separately while retaining its cost.

Provenance: moderate · Official TB4 native-agent high 57.88% versus max 58.18%, with about 30.5% lower published cost. Fixed AA harness instead favors xhigh. · Equation profile: terminal_systems_native.

- [Source 1](https://www.tbench.ai/leaderboard/terminal-bench/4.0)
- [Source 2](https://artificialanalysis.ai/agents/coding-agents)

### kubernetes_incident

Provide topology, time range, deployment changes, traces/metrics/logs and read-only tools. Seek the minimal causal set and evidence that distinguishes competing causes.

Required evidence: Correct affected component and causal explanation; remediation is a separate task with its own change authorization.

Provenance: moderate · Sol max leads the reviewed ITBench-AA table at 56.21%; newest Astra/Fable are absent from that comparison. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/models/gpt-5-6-sol)
- [Source 2](https://github.com/IBM/ITBench)

### infrastructure_code

Specify environment, desired resources, state ownership, secrets references and rollback constraints. Work against a disposable plan/state snapshot and surface destructive actions.

Required evidence: Provider plan/schema checks, least-change diff and staging behavior; the controller separately owns deployment acceptance.

Provenance: low · Repository implementation transfer; current task-specific deployment correctness/ROI is not measured. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://deepswe.datacurve.ai/)
- [Source 2](https://github.com/ucsb-mlsec/DevOps-Gym)

### release_engineering

Supply release scope, dependency graph, deployment order, compatibility window and rollback triggers. Produce executable checks and explicit stop conditions.

Required evidence: Fresh build, migration/rollback rehearsal, version/asset consistency and observed post-release criteria.

Provenance: low · Strong systems prior; release safety is not established by generic coding score. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://www.tbench.ai/leaderboard/terminal-bench/4.0)

### simple_sql

Provide dialect, schema, keys, business definitions and representative rows. Resolve joins, null handling, time zones and aggregation grain before drafting SQL.

Required evidence: Execute against known-answer fixtures, adversarial null/duplicate cases and a read-only database copy.

Provenance: low · Low-cost code-generation prior. BIRD/LiveSQL current tables do not contain a matched September pool for this choice. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://livesqlbench.ai/)
- [Source 2](https://deepswe.datacurve.ai/)

### complex_sql

Supply authoritative business rules with version dates, schema and intended result grain. Inspect data in a sandbox; make intermediate checks and reconcile totals.

Required evidence: Known-answer and perturbation tests, business-rule review, row-level reconciliation and query-plan resource bounds.

Provenance: low · New-model transfer from strong repository reasoning; LiveSQL evidence is mostly older models and differing harnesses, so no validated current ROI winner. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://livesqlbench.ai/)
- [Source 2](https://deepswe.datacurve.ai/)

### dbt_analytics

Provide source/target models, lineage, freshness, materialization and contract requirements. Identify where records are lost, duplicated or mis-keyed.

Required evidence: dbt tests, source-target reconciliation, null/uniqueness checks and representative incremental reruns.

Provenance: low · Repository repair transfer; ADE-bench is a useful evaluation target but does not rank the complete latest model pool. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://deepswe.datacurve.ai/)
- [Source 2](https://github.com/dbt-labs/ade-bench)

### database_migration

Specify table scale, locks, online constraints, old/new application versions and rollback needs. Include backfill, dual-read/write and invariant checks where needed.

Required evidence: Disposable database rehearsal, conservation/reconciliation checks and compatibility during each migration phase.

Provenance: low · Consequential systems/refactoring prior; SQL benchmark query success cannot prove safe migrations. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-refactoring)
- [Source 2](https://livesqlbench.ai/)

### data_notebooks

Provide data schema, analytical question, units and valid ranges. Inspect missingness and leakage, then produce reproducible code and explicit data assumptions.

Required evidence: Recomputed totals, held-out checks, clean-kernel execution and consistency between chart and source data.

Provenance: low · Cheap numerical/code first-attempt prior; SciCode is not an end-to-end data-analysis productivity benchmark. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/models/gpt-5-6-luna)

### frontend_prototype

Supply complete user flows, design references, target viewports and real data states. Let it implement, then inspect the running UI and fix actual visual/interaction defects.

Required evidence: Rendered viewport inspection plus working navigation/forms, accessibility basics and functional tests.

Provenance: moderate · Arena WebDev Qwen3.8-Flash-Next scores 1635 preliminary at low token price; exact Next API is commercially offered. Native default xhigh is verified; Arena effort itself is unstated. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://arena.ai/leaderboard/code/webdev)
- [Source 2](https://vercel.com/ai-gateway/models/qwen3.8-flash-next)

### frontend_polish

Provide screenshots, working app, design intent and specific usability defects. Preserve working flows; inspect results at target sizes before declaring completion.

Required evidence: Side-by-side visual QA, keyboard/accessibility checks and unchanged functional acceptance flows.

Provenance: moderate · Astra max leads current WebDev preference at 1800 versus Fable5.1 max 1758. This is preference evidence, not measured functional success or task ROI. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://arena.ai/leaderboard/code/webdev)

### frontend_bug

Provide exact reproduction, expected state transitions, network behavior and viewport. Fix the causal state/interaction issue and demonstrate the flow.

Required evidence: Browser reproduction before/after, console/network checks and targeted interaction tests.

Provenance: moderate · Repository feature/repair evidence is more relevant than style preference alone; frontend transfer needs local validation. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://deepswe.datacurve.ai/)

### accessibility

Provide failing audits and the affected interaction. Fix semantics, focus order, labels and contrast using current standards; verify with actual keyboard and accessibility tooling.

Required evidence: Automated rules plus keyboard/screen-reader-relevant manual checks; do not equate a zero automated-error count with complete accessibility.

Provenance: low · Proposed implementation specialist; visual preference scores do not establish accessibility compliance. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://deepswe.datacurve.ai/)
- [Source 2](https://arena.ai/leaderboard/code/webdev)

### browser_tests

Specify user-visible outcomes, stable selectors, test data and environment lifecycle. Avoid brittle sleeps; make failure evidence observable.

Required evidence: Run against actual app, prove relevant failure detection and check rerun stability.

Provenance: low · General test-writing and implementation transfer; no matched current browser-test ROI table. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-tw)
- [Source 2](https://deepswe.datacurve.ai/)

### scientific_first

Supply equations, definitions, units, boundary conditions and tolerances. Require independent numerical checks, not merely reproduction of one output.

Required evidence: Analytical cases, conservation identities, randomized differential checks and declared precision.

Provenance: moderate · AA SciCode subproblems: Luna max 53.59%, modeled $.0093 each. This is subproblem ROI, not completed research-project ROI. · Equation profile: scientific_code_first_attempt.

- [Source 1](https://artificialanalysis.ai/models/gpt-5-6-luna)

### scientific_specialist

Give the scientific specification and allowed approximations. Permit independent derivation; request assumptions, conditioning and correctness evidence before optimization.

Required evidence: Independent reference calculations and stress cases; inspect numerical stability and scientific interpretation.

Provenance: moderate · AA SciCode Muse1.3 xhigh 59.72% at $.0372 per subproblem lies on the reviewed quality/cost frontier. Gateway effort equivalence needs Devin validation. · Equation profile: scientific_code_stronger_attempt.

- [Source 1](https://artificialanalysis.ai/models/muse-spark-1-3-xhigh)
- [Source 2](https://vercel.com/ai-gateway/models/muse-spark-1.3)

### scientific_repository_repair

Supply the scientific contract, units, invariant, repository snapshot and reproducible discrepancy. Separate necessary scientific definitions from a suggested diagnosis. Permit independent hypothesis testing and follow the invariant through every affected module; do not prescribe a patch location. Give Astra max the scientific contract and observed discrepancy, with room to discover the cause. Label supporting domain material separately from a proposed diagnosis: poorly grounded guidance can anchor a repair. Require independent numerical and cross-module validation before accepting it.

Required evidence: Rebuild the submitted patch on a clean baseline. Check alternative numerical regimes, equivalent representations, boundary cases and regression behavior with verifier data outside the worker context. The public96-task default cannot reproduce the119-task leaderboard.

Provenance: moderate · SWE-bench Science September11 results: Astra max/Codex50.42% exact private-test success versus Opus5max/ClaudeCode47.90% on119tasks. This supports a quality reference, not demonstrated ROI or a statistically separated model-only winner. Token totals lack a complete bill. Opus max is a useful independent escalation, especially for scientific root-cause exploration. · Equation profile: scientific_repository_quality_reference.

- [Source 1](https://swescience.github.io/)
- [Source 2](https://github.com/OpenMOSS/SWE-bench-Science)
- [Source 3](https://arxiv.org/abs/2608.19799v2)

### cpu_performance

Supply profile, workload distribution, baseline, allowed memory budget and correctness invariants. Optimize measured bottlenecks; keep benchmark and test code outside editable scope.

Required evidence: Distribution-wide correctness, randomized differential tests and repeated wall-clock measurements on matched hardware.

Provenance: low · Strong difficult-code prior; AlgoTune/GSO establish useful correctness-plus-speed evaluation but not a matched latest API ROI winner. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://labs.scale.com/leaderboard/sweatlas-refactoring)
- [Source 2](https://github.com/ScalingIntelligence/AlgoTune)

### gpu_prototype

Specify shapes, dtypes, precision, device and permitted operations. Keep reference and checks inaccessible for editing. Treat correctness as a prerequisite to any speed claim.

Required evidence: Mutated inputs, multiple seeds/shapes/dtypes, strict numerical bounds, state-reset tests and anti-cheating checks before timing.

Provenance: moderate · V4.1 Flash has strong custom-deck gate results; one accepted Mega cell has a documented semantic error within tolerance. Prototype-only assignment until strict verification. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://kernelbench.com/models/deepseek-flash)

### gpu_final

Provide a trusted performance harness, target GPU, strict numerical contract and end-to-end workload. Require reasoning about persistent state, memory safety and timing methodology.

Required evidence: Independent regrade on new inputs, sanitizer/race checks where supported, stable timing and application-level equivalence.

Provenance: moderate · Fable5.1 max has strong audited speed on five custom cells with substantial model cost; incomplete coverage and GPU bills prevent universal ROI claims. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://kernelbench.com/models/claude-fable-5-1)

### security_reproduction

Provide permitted sandbox, vulnerable/fixed builds, threat preconditions and success condition. Return the smallest reproducible proof with exact environment and differential behavior.

Required evidence: Independent vulnerable/fixed differential replay; distinguish actual exploit from crash, false alarm and environment failure.

Provenance: moderate · Provider reports V4.1 Flash CyberGym 88.1 and SEC-bench-Pro 62.8 at max; current independent replication is missing. These test reproduction, not safe patch writing. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://huggingface.co/deepseek-ai/DeepSeek-V4.1-Flash)

### secure_implementation

Give threat model, trust boundaries, invariants and adversarial requirements. Fix the cause while preserving functionality; inspect alternate entry points and related patterns.

Required evidence: Functional tests plus exploit regression, independent security review and relevant static/dynamic analysis; no self-certification.

Provenance: moderate · Endor current secure-code result favors Fable5.1; exact source effort is unstated, so high is a proposed economical starting setting. Absolute secure success remains low. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://www.endorlabs.com/research/ai-code-security-benchmark)

### security_review

Inspect requirements, threat model and diff independently before reading the author rationale. For each finding provide reachable path, violated invariant and concrete evidence; report coverage gaps.

Required evidence: Reproduce feasible findings or prove the invariant violation; reject unsupported severity claims and recheck fixed behavior.

Provenance: moderate · Complementary current secure-code evidence. Cross-model review benefit and high-effort optimality are proposed, not measured. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://www.endorlabs.com/research/ai-code-security-benchmark)

### dependency_exploitability

Provide resolved dependency versions, the advisory, relevant deployment configuration and trust boundaries. Trace upstream vulnerable behavior into downstream reachable call paths; separate code absence, unreachable paths and configuration/environment assumptions. Return evidence and unresolved uncertainty, not a blanket safe label. Give Opus high resolved dependency versions, downstream call sites and real deployment assumptions. Require an affected/not-affected argument tied to observable reachability and configuration. Preserve uncertainty; a concise confident label cannot close an alert.

Required evidence: Independently verify relevant call paths and deployment assumptions. A not-affected recommendation cannot automatically close an alert without its evidence and applicable configuration being reviewed.

Provenance: low · VEX-Bench shows that affected-class recall, exact justification and overall accuracy differ. Its older Opus4.6 high has strong recall; no current Opus5 result exists. Opus5 high is a proposed careful triage lead, not a measured VEX winner. Old V4Flash weakness must not be transferred numerically to4.1. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://arxiv.org/html/2609.08040v1)

### cheap_code_review

Review the actual diff with relevant surrounding code. Return only actionable findings with triggering input, file/line and consequence; keep uncertainty explicit.

Required evidence: Independent reviewer reproduces/corroborates findings; track precision, recall and review minutes, not number of comments.

Provenance: moderate · Kodus CodeReviewBench reports GLMFlash roughly $.08/PR, precision41/recall39/F1 40 on 30 PRs. Effort is not disclosed; max is proposed. F1 is not success probability. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://codereviewbench.com/leaderboard)

### final_code_review

Read requirements and diff before author narrative. Trace changed consumers and edge cases. Return only substantiated defects, missing checks and unresolved release risks.

Required evidence: Tests/reproductions attached to findings, no duplicate comments, and independent acceptance checks.

Provenance: moderate · CodeRabbit current labelled-bug coverage and broad system evidence support the shortlist; precision/cost/effort gaps prevent a validated ROI winner. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://www.coderabbit.ai/blog/gpt-6-astra-code-review-evaluation)
- [Source 2](https://labs.scale.com/leaderboard/sweatlas-refactoring)
- [Source 3](https://www.endorlabs.com/research/ai-code-security-benchmark)

### technical_documentation

Provide code-derived facts, runnable commands and audience. Explain the actual workflow with one minimal example, requirements and known limitations; do not invent API flags.

Required evidence: Execute documentation examples in a clean environment and check every API name against source/current docs.

Provenance: low · Cheap bounded writing prior using verified source material; no current documentation-quality/cost winner established. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/models/gpt-5-6-luna)
- [Source 2](https://github.com/evalplus/repoqa)

### migration_guide

Provide old/new interfaces, known compatibility breaks and tested patches. Organize by user action; link exact code evidence and unresolved cases.

Required evidence: Follow the guide on a representative old client; verify commands and resulting behavior.

Provenance: moderate · Repository Q&A and long-context strengths transfer to synthesizing accurate guidance; writing-specific ROI is unmeasured. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://artificialanalysis.ai/agents/coding-agents)
- [Source 2](https://artificialanalysis.ai/evaluations/artificial-analysis-long-context-reasoning)

### tool_automation

Give desired final state, allowed actions, object IDs and constraints. Verify actual tool/database state after writes; keep a ledger of side effects and reversibility.

Required evidence: Final-state predicates and absence of unintended changes, plus idempotence where required.

Provenance: moderate · V4.1 Flash leads the reviewed AA AutomationBench partial score. Partial credit and missing comparable whole-task cost do not establish dollars per success. · Equation profile: stateful_tool_quality_reference.

- [Source 1](https://artificialanalysis.ai/models/deepseek-v4-1-flash)

### c_cpp_security_repair

Provide the sanitizer report, vulnerable snapshot, build environment and reproduction. Require localization beyond the crash stack and preservation of valid inputs. Let the worker investigate the root cause; do not prescribe a single-function patch. Return the patch, causal explanation and validation evidence. Give Sol medium the reproduction, sanitizer report and versioned build environment. Ask it to trace the violated invariant to its origin rather than patching only the crash site. Allow edits across the necessary dependency path; verify benign behavior independently.

Required evidence: Check multiple exploit variants, benign-path sanitizer behavior, reference-passing regressions and observable output semantics. Require independent security review; missing validation stages never count as passes.

Provenance: moderate · September PatchBench reports Sol medium with Codex at59.2% joint security/semantic pass, versus97.2% on the supplied PoC alone. This is the best published configuration in that paper, not a demonstrated ROI winner against Astra/Fable5.1/DeepSeek4.1. Costs are missing; a$5 cap is not a task bill. Manual audit still found partially unfixed accepted patches. · Equation profile: c_cpp_security_quality_reference.

- [Source 1](https://arxiv.org/html/2609.04075v1)
- [Source 2](https://github.com/ai-sec-lab/PatchBench/tree/8dd22756cb4d29ee2cebf5e179544b963c2bcbbd)

### security_patch_backport

Provide the reviewed upstream fix, source/target commits, affected symbols and supported target versions. Re-derive the security invariant in the target, trace renamed/moved dependencies and adapt the smallest complete fix. Distinguish missing context from a clean cherry-pick. Give Sol medium both versioned code states and the reviewed upstream repair intent. Require a target-side dependency and symbol map before adapting the patch. A successful textual application is not a security verdict.

Required evidence: Target-version build and regression checks, vulnerable/patched PoC differential, compatibility tests and independent review of propagated dependencies. Textual similarity to the upstream patch is insufficient.

Provenance: low · Sol medium is a transfer from current C/C++ repair evidence. Porting Benchmark shows that source-patch structural agreement can disagree with executable remediation; no September model/effort/cost comparison establishes this backport winner. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://arxiv.org/html/2608.17671v1)
- [Source 2](https://arxiv.org/html/2609.04075v1)

### mcp_complex_workflows

Provide desired final states, exact object IDs, permissions and immutable starting snapshots. Permit investigation across tools, preserve intermediate artifacts, and verify each consequential state change against the request.

Required evidence: Independent final-state predicates, collateral-change checks and complete side-effect ledger. Confirm tool versions and final object IDs before acceptance.

Provenance: moderate · MCPMark Verified KimiK3max96.06% versus Solmax92.91% on127tasks. Costs are unavailable and these are single runs; this is the measured quality choice, with ROI unresolved. Do not transfer old unverified MCPMark results to this cohort. · Equation profile: mcp_tool_quality_reference.

- [Source 1](https://mcpmark.ai/leaderboard/verified)

### browser_operation

Provide target task and allowed actions. Read the current page state before acting, retain screenshots/DOM evidence, and verify the intended final state.

Required evidence: Independent final-state checks and action log; handle dialogs and unexpected navigation explicitly.

Provenance: moderate · Browser Use V2 current60-task figure reports Astra medium77.3% weighted rubric completion, well above the plotted alternatives. This is partial completion, not77.3% fully solved tasks; exact current per-task outputs/costs were not public in the reviewed tree. Gemini3.8 and Fable5.1 are absent. Higher-effort escalation is a hypothesis. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://github.com/browser-use/benchmark/tree/421390ea7fa4708f3d89d7695f9a16debb861daf)

### browser_read_first_attempt

Give one concrete lookup, allowed domains and exact fields. Read current page state, retain source passages, and return missing facts rather than expanding into an open-ended browsing project.

Required evidence: Check every returned field against the visible source, preserve URL/time and escalate missing or conflicting evidence.

Provenance: low · Browser Use V2 plots Luna high around41% weighted rubric completion at about$.36 per task. This is a promising cheap first pass, not measured success on this narrower read-only role; authoritative extraction and escalation are required. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://github.com/browser-use/benchmark/tree/421390ea7fa4708f3d89d7695f9a16debb861daf)

### desktop_operation

State the goal, app, input artifacts and permitted actions. Observe before acting; prefer structured app controls and verify the saved artifact or final state.

Required evidence: Artifact/content validation plus observable UI state; do not equate successful clicks with task completion.

Provenance: low · Strong current system/computer-use prior. OSWorld ranks agent systems with varying step limits; it does not provide a directly comparable September ROI winner. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://www.tbench.ai/leaderboard/terminal-bench/4.0)
- [Source 2](https://osworld-v1.xlang.ai/)

### whole_repository_stack_migration

Provide the original working system, exact target stack, migration intent and observable interfaces. Require removal of the old implementation from the build closure, then preserve behavior. Give the worker ownership of architecture within those constraints; distinguish necessary redesign from a wrapper around the old stack.

Required evidence: Independently audit that the migration actually happened, rebuild from submitted source, run all reference-passing behavioral checks, then generate differential counterexamples. Passing the old tests alone is insufficient; record verification cost and remaining untested interfaces.

Provenance: moderate · SWE Refactor Bench directly favors Opus 5 xhigh: 5/20 fully accepted migrations, versus Sol max 4/20; mean developer API costs $74.9 versus $143.5. The 47/100 composite is not a success probability. Astra/Fable 5.1 are absent and six-agent verification cost is missing. This narrow role differs from localized refactoring. · Equation profile: none (judgment/transfer proposal).

- [Source 1](https://arxiv.org/html/2608.23564v1)
