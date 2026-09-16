# Meta-harnesses: what the evidence supports

Research notes for the LiteLLM-specific Litespeed campaign. Sources checked September 15, 2026. This is a reading guide and an interpretation of the evidence, not a proposed large architecture. Live campaign measurements belong in [the results report](litellm-harness-results.md).

## 1. The simple idea

A coding harness is everything around the model: which files it sees, how tools work, how it edits code, what it remembers, how it verifies a change, and when it stops. A meta-harness runs experiments on that machinery. The model weights can stay fixed while the surrounding program changes.

For LiteLLM, the useful question is concrete: can repeated failures teach a cheap model where this repository hides its important behavior, and how to verify that behavior efficiently? A provider adapter, a cached authentication path and a router selection method have different failure patterns. A repository-specific harness can help expose those patterns before the model wastes a dozen turns discovering them.

There are several different claims hiding behind “self-improving.” Keep them separate:

| What changes | Example | What would demonstrate learning |
|---|---|---|
| The current solution | The agent fixes a failing test | The current task passes; nothing necessarily transfers |
| Persistent instructions | A lesson about cached budget checks | Future relevant tasks improve with the lesson |
| Retrieval and tools | A caller map or better editor | The same model completes tasks more reliably or cheaply |
| Control flow | Review before stopping; recovery after empty output | The mechanism activates and its benefit exceeds its overhead |
| The optimizer | Better instructions for diagnosing traces | It finds useful candidates faster on subsequent problems |
| Model weights | Fine-tuning or reinforcement learning | A new trained model improves under controlled evaluation |

This distinction matters for product scope. An agent that appends a lesson after every run has implemented memory. It has not yet shown that the lessons help. An agent that writes a helper script during a task has expanded its tools, but has not necessarily improved its next task. A meta-harness needs evidence connecting a persistent change to a useful outcome.

## 2. The most relevant implementations and papers

### Repository-specific skills: GEPA and gskill

GEPA keeps candidates that perform well on different task subsets, reflects on execution feedback, proposes mutations and can combine complementary candidates. Its adapter boundary is useful: evaluation produces both a score and diagnostic information. The optimizer is not restricted to a single scalar reward. The current implementation supports prompts and more general text artifacts, including code. [GEPA implementation](https://github.com/gepa-ai/gepa).

The closest published example to this campaign is **gskill**. It generates verifiable tasks from a repository with SWE-smith, then evolves repository-specific skills with GEPA. The authors report Mini-SWE-Agent/gpt-5-mini improvements from 55% to 82% on Jinja and 24% to 93% on Bleve, using separate training, validation and test tasks. They also test transfer to Claude Code. These are generated repair tasks, and the authors explicitly want harder, more representative development tasks next. The article's introductory transfer numbers and figure descriptions are not fully consistent, so the exact transfer percentages should be checked against artifacts before reuse. [gskill report](https://gepa-ai.github.io/gepa/blog/2026/02/18/automatically-learning-skills-for-coding-agents/).

**Implication for LiteLLM:** repository specialization has a direct empirical precedent. Historical PRs add realistic intent and subsystem interactions, while generated mutations can add controlled, cheap coverage. They measure different distributions; neither should silently stand in for the other.

### Full harness code search: Meta-Harness

Meta-Harness lets a coding proposer inspect earlier candidate source, traces and scores through a filesystem. Its coding artifact builds on Terminus-KIRA; a useful discovered addition was an environment snapshot before the first model turn. This is a reminder that a small deterministic context improvement can matter more than another reasoning stage. [Paper and released artifact](https://arxiv.org/html/2603.28052v1), [code](https://github.com/stanford-iris-lab/meta-harness-tbench2-artifact).

An essential qualification appears in the paper's coding experiment: search and final evaluation use the **same 89 Terminal-Bench tasks**. The authors describe this as benchmark discovery and inspect for explicit task leakage. Their other domains have different generalization experiments. My interpretation: the coding result demonstrates benchmark optimization, while an unseen-PR claim requires a separate test. Absence of hard-coded answers does not itself establish generalization.

### Same-model proposals: Self-Harness

Self-Harness mines failure evidence, asks the evaluated model for small candidate harness changes, and evaluates regressions. This directly tests the idea that the cheaper model can help improve its own surroundings. Its acceptance procedure consults both “held-in” and “held-out” scores throughout optimization. [Self-Harness](https://arxiv.org/html/2606.09498v1).

My interpretation: withholding the second split's traces is useful, but repeated use of its score makes it a validation set for selection. It is not an untouched final test. The distinction is about what the experiment can establish, not an accusation that the improvements are fictitious.

### Branching search: Darwin Gödel Machine

DGM keeps an archive of agent implementations and permits descendants of candidates that are not currently best. This can preserve a useful intermediate design that greedy hill-climbing would discard. Reported changes include editing tools, patch validation and candidate generation/ranking. The authors also document reward hacking: in a tool-use-hallucination experiment, some candidates removed markers used by the detector. [Sakana's report](https://sakana.ai/dgm/), [implementation](https://github.com/jennyzzt/dgm).

For a modest budget, the practical lesson is to retain rejected candidates and their evidence, rather than necessarily adopting an elaborate evolutionary algorithm. A failed combined change may contain one useful component. The grader and its inputs must remain outside the code the candidate is allowed to optimize.

### Memory as the learned artifact: ACE

ACE separates generation, reflection and curation. It updates an itemized playbook incrementally instead of repeatedly asking a model to rewrite all accumulated context. The paper describes loss of useful detail during wholesale rewriting, and uses identifiers and helpful/harmful feedback to manage entries. [ACE paper](https://arxiv.org/html/2510.04618v1).

This is relevant to repository knowledge that should survive many PRs. A lesson needs a scope, evidence and a way to become obsolete. “Redis is authoritative after a clean cache miss” can be useful; “always use this helper” becomes brittle when code ownership changes. Incremental memory is still a hypothesis store until downstream evaluation supports it.

### Tools created during a task: Live-SWE-agent

Live-SWE-agent starts from a minimal shell-based scaffold and encourages the model to create scripts while solving an issue. Its implemented self-evolution focuses on tool synthesis; it does not require an offline training loop. It evaluates on SWE-bench Verified and SWE-Bench Pro. [Paper](https://arxiv.org/html/2511.13646v1), [implementation](https://github.com/OpenAutoCoder/live-swe-agent).

The useful distinction is between producing a temporary instrument and permanently changing the harness. A one-off script to inspect all return statements can be excellent within a task. Promoting that script into a reusable tool requires decisions about permissions, malformed input, output limits, maintenance and whether it helps other tasks.

### Measuring mechanisms: Gated Semantic Quality-Diversity

This paper separates model diagnosis from deterministic measurement and keeps task-paired repetitions, mechanism activation records and a reserved final test. Its recurring improvements address empty reasoning-budget exhaustion and premature finalization. The repository-coding result is explicitly preliminary: a 5.1-point lift on 26 held-out SWE-bench tasks does not meet its significance threshold. [Paper](https://arxiv.org/html/2607.13683v1).

Two caveats deserve attention. The paper says mechanical enforcement of test withholding is future work. It also attributes weak SWE-bench retention to noise rather than overfitting; disjoint task splits alone cannot establish that explanation. The valuable principle is narrower: record whether a mechanism fired, preserve pairing, and be willing to report an inconclusive result.

### Improving the optimizer: Meta-Agent

Meta-Agent implements a fast loop for harness changes and an experimental slow loop for changing proposer instructions. Its repository clearly distinguishes implementation from evidence: the reported result evaluates the fast loop, and transfer or retention from the slow loop has not been measured. Its 15-task result is labeled selection data because those outcomes guided candidate choice. [Implementation and limitations](https://github.com/canvas-org/meta-agent).

That is an unusually useful reporting convention. A meta-harness can improve its own diagnosis prompt, but the next experiment must test whether it now finds better changes, rather than merely producing more persuasive explanations.

### PenguinHarness: inspect optimization and memory separately

Penguin's optimization skill describes frozen benchmarks, versioned candidates, baseline evaluation, bounded changes and rollback of rejected candidates. Its acceptance rule uses higher average benchmark score; that rule alone is not a statistical noise test. [Optimization source](https://github.com/Prism-Shadow/penguin-harness/blob/main/plugins/agent-tuning/skills/agent-optimization/SKILL.md), [evaluation source](https://github.com/Prism-Shadow/penguin-harness/blob/main/plugins/agent-tuning/skills/agent-evaluation/SKILL.md).

Its continual-learning stop hook is a different mechanism: after enough completed turns, it prepares a bounded, condensed transcript and asks a background model to revise existing skills. The hook clips messages/tool output and excludes reasoning. My interpretation is that this is a persistent-memory workflow, not by itself proof of regression-tested optimization. These two mechanisms should not be conflated when comparing products. [Continual-learning hook](https://github.com/Prism-Shadow/penguin-harness/blob/main/plugins/continual-learning/hooks/stop.mjs).

### The GPT-OSS-20B example supplied for this campaign

Joel Niklaus reports a fixed-weight GPT-OSS-20B/OpenCode experiment improving Terminal-Bench 2.1 from 4.8% to 14.8%, with $49.97 in harness search, 23 iterations and about 2,400 development attempts. The proposer was a stronger Claude Code model; it was not purely the 20B model improving itself unaided. Reported changes include verification, continuing after merely announcing an action, and malformed-JSON recovery. Treat the cost and improvement as the author's reported experiment, not a replicated LiteLLM result. The exact Hugging Face article originally recalled was not confirmed. [User-supplied post](https://www.linkedin.com/posts/joelniklaus_same-weights-50-of-harness-search-3x-on-ugcPost-7503890355180875777-NF4m/).

## 3. What has evidence in production?

**Stripe Minions** is evidence that company-specific coding harnesses can support substantial real usage. Its February 2026 account reports over 1,300 minion-produced, human-reviewed PRs merged per week. The design combines agent decisions with deterministic workflow steps, standard isolated developer environments, scoped repository rules and bounded CI repair. The described loop allows one or two CI rounds before returning the branch for human scrutiny. This is a production account, not a randomized comparison or proof that self-modification caused the productivity gain. [Stripe's implementation account](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2).

**Databricks Agent Bricks** reports GEPA-optimized GPT-OSS-120B outperforming its baseline frontier-model comparison on an information-extraction benchmark at much lower estimated serving cost. The same optimization also improves frontier models. Its economics separate optimization cost from serving cost and explain why benefits depend on workload volume. This supports domain-specific optimization as a product capability; information extraction is not evidence of autonomous repository maintenance. [Databricks research and product report](https://www.databricks.com/blog/building-state-art-enterprise-agents-90x-cheaper-automated-prompt-optimization).

**LangChain's coding harness** improved its reported Terminal-Bench score with trace analysis, a completion checklist, environment context and loop detection. Maximum reasoning everywhere performed worse than a lower reasoning setting because of timeouts. The article reports a fixed-model harness improvement from 52.8% to 66.5%. This is a useful engineering experiment, not an untouched LiteLLM test or a measurement of production defect rates. [LangChain's report](https://www.langchain.com/blog/improving-deep-agents-with-harness-engineering).

The distinction to keep: adoption shows that a workflow is usable at scale; a controlled experiment estimates the effect of a particular change. Neither substitutes for the other. For this campaign, “delightful” also includes ordinary product behavior: selecting the architecture, retaining the chosen model, respecting Plan mode and permissions, showing edits clearly, and supporting interruption without losing the patch.

## 4. Historical PRs are useful supervision, with traps

The historical-PR idea is sound as an experiment design: start before the change, provide an issue-like requirement, ask for a patch, and score observable behavior against tests restored by an independent process. Our campaign exposed several reasons to be careful about what this score means.

**A merged diff is one solution.** Equivalent implementations can use different helpers, exception subclasses or wording. A test that directly calls a newly introduced private helper can reject a behaviorally correct alternative. Preserve the raw reference score, identify the coupled assertion, and add an independently specified behavioral check when necessary. Do not quietly replace a disappointing score after seeing it.

**The prompt can leak the solution without including the patch.** A curator that reads the reference may accidentally name its new helper, prescribe its control flow, or include an exact test recipe. Review task descriptions for observable requirements. Some exact strings are genuine API contracts; others are artifacts of the chosen implementation. Record why an exception is included.

**A later training snapshot can contain an earlier held-out fix.** Reserving its score does not undo that exposure. In this campaign, an earlier September 9 reserved corpus predates some September 10 training snapshots. It can support a retrospective reserved-outcome comparison, but not a clean chronological claim. A newer corpus was selected separately before solver outcomes.

**Qualify the evaluator before solving.** The base should fail the selected behavior, and the reference should pass in the installed environment. Missing fixtures, new imports unavailable on the base, or a failing reference are dataset problems. Declare exclusions before seeing model outputs. Shared modern dependencies can also differ from historical CI; passing qualification does not reconstruct every old environment.

**Prove which code was imported.** An editable Python installation can silently load the live checkout when a supposed snapshot contains only tests. That happened in the initial router and Langfuse supplemental reference checks here. Fresh exact-commit archives and assertions on every imported LiteLLM module reproduced the same outcomes. Host probes also wrote bytecode into reusable bases; twelve later trials inherited it. Their original acceptance verdicts reproduced with caches disabled, but the contaminated baselines remain disclosed. `-B` prevents writes, not stale-cache reads: use a fresh bytecode prefix as well. [Audit and corrections](../scripts/litellm-harness/snapshot-hygiene-audit.json).

**Filesystem instructions are insufficient isolation.** Early runs in this campaign read outside the intended snapshot. Their raw scores remain visible and flagged. Later runs enforce a filesystem boundary, give each run private temporary files, protect host test metadata and restore reference tests only after solving. This remains a trusted-model evaluation, not a complete adversarial sandbox.

**Infrastructure can change the answer.** Anthropic reports a six-point Terminal-Bench spread between resource configurations. Our own campaign saw overloaded shared-host runs and blocked Git/pytest operations, which made latency and completion comparisons misleading. Resource limits, concurrency and environment protocol are experimental variables. [Anthropic's infrastructure study](https://www.anthropic.com/engineering/infrastructure-noise).

## 5. What the LiteLLM traces have taught us

These are campaign observations, not claims that each corresponding intervention has already won a final comparison.

1. **Navigation must expose executable branches.** Function names and filenames can miss an inline cached-budget comparison. A useful repository tool returns relevant conditions, counterpart entrypoints and test partners, not just a broad folder map.
2. **Finding the right helper is not enough.** Router and streaming behavior can bypass it through early returns or separate adapters. A passing test of a shared helper does not prove the reported entrypoint is covered.
3. **Correct review can still lead to an incorrect repair.** A router critic identified missing direct-entrypoint accounting. The solver demonstrated that naively adding another check would double-count inside its existing wrapper design, then rejected the broader finding. It needed to reconsider ownership of the check. The second attempt improved one raw check but left real gaps.
4. **Reasoning and context have failure modes of their own.** Three broad Medium-reasoning audits consumed 24,000 completion tokens each without a final review. A narrower audit returned actionable findings, but its question was informed by training failures. That supports targeted diagnosis, not a universal reviewer claim.
5. **A passing patch can disappear at cancellation.** One solver temporarily removed its own fix to compare against baseline and was interrupted before restoration. Restoring only its model-authored block on a diagnostic copy passed the checks. The original incomplete result stays incomplete. Review guidance now keeps the working patch intact.
6. **More testing is not automatically better.** A whole provider directory can contain live-service tests and unrelated failures. Exact nodes and small discriminating probes often answer the actual question with less cost and confusion.
7. **Observe activation accurately.** Initial maps and review notices are visible in saved messages. Read-window defaults are inserted before arguments are saved, so historical traces cannot always distinguish host defaults from explicit model choices. The analyzer reports that uncertainty instead of inventing an activation count.


8. **Merged PR tests can miss an explicit requirement.** A Langfuse candidate passed all 60 original cases but missed a stated keep condition for different trace/session IDs. A reference-aware critic suggested the gap; a public-entrypoint probe confirmed candidate 4/6, base 2/6 and reference 6/6. The original scores remain unchanged. [Reproducible probe and candidate](../scripts/litellm-harness/studies/identity-precedence/README.md).
9. **A feature must actually activate.** The timed-out routing run recorded 21 pytest-related jobs but no test-focus reminder. Its environment-prefixed commands lacked a safely attributable check verdict, and the reminder incorrectly depended on that verdict. Version 24 separately counts completed test-like activity without claiming it passed.
10. **A blind judge is a separate capability to evaluate.** On the Langfuse candidate, a fresh reviewer given the task, diff and source but no reference or test results failed at all three tested settings: Medium and Low exhausted 8,000 output tokens without an answer; no reasoning completed but missed the confirmed defect after retracting several false accusations. This is one exploratory case, not a universal result. The reference-aware critic helped build a better training probe; it did not establish a reliable production judge.

    A later [focused four-call pilot](../scripts/litellm-harness/studies/focused-review/README.md) recovered a verified router precedence defect with Medium reasoning, but also alleged a nonexistent `None` return from an omitted helper. Its Langfuse attempts still failed. Supplying a smaller context can help completion while leaving missing dependencies that invite false findings; executable witnesses and the actual callee contract remain necessary.

    Even a proposed executable reproduction can be wrong. A [review of the harness's command-history fix](../scripts/litellm-harness/studies/command-history/README.md) supplied two small alleged failures, both based on counting a root directory the code never counted. Executing those scenarios captured the changes correctly. Separately, a [budget-guide trial](../scripts/litellm-harness/studies/counter-values/README.md) received the right stale-cache counterexample but chose test values that hid it and rationalized stale local state. Check what ran and what values it covered; delivered guidance and plausible test code are intermediate evidence.

    Task wording can also steer a wrong implementation. Two streaming replays interpreted “its own hook” as a method declared on the leaf class, excluding inherited custom hooks required by the reference tests. A one-line host diagnosis makes both pass, but the curated task never explicitly mentioned inheritance. [The retained comparison](../scripts/litellm-harness/studies/feature-effort/legacy-inheritance/README.md) preserves that ambiguity rather than assigning the entire failure to the model. PR-derived task writing is part of the measurement pipeline and needs its own review.
11. **Find a behavioral oracle outside the patch's own assumptions.** Ten completed router-candidate replays passed the original one-case acceptance but all failed extra precedence checks. Some new tests asserted the same incorrect union as the patch; old comments and a listing helper reinforced that assumption. Comparing candidate IDs with actual request selection exposed the mismatch. One patch fixed wildcard lookup while introducing a named-team regression. [Probe, snapshots and audit](../scripts/litellm-harness/studies/router-precedence/README.md).


12. **A failing reference test can also overstate the defect.** The background-response acceptance test mocked one router lookup method; a candidate used another valid existing method. Replacing only the mock with a real Router gave base failure, reference success and candidate success. Keep the raw failure, publish the diagnostic, and avoid teaching implementation choices solely to satisfy a mock. [Oracle audit](../scripts/litellm-harness/studies/background-router-oracle/README.md).
13. **A stable system prompt does not guarantee a stable cached prefix.** Job-completion updates here rewrote a second, early runtime message. Exact outbound-payload comparisons found those changes before requests with over 150,000 input tokens and only approximately 4,500 cached tokens. The system/tool hash stayed unchanged. Inspect actual serialized history, not just the system hash. The completed six-pair synthetic test supports the prefix mechanism. The separate coding comparison reduced token-priced spend by 45.3% on two development tasks but kept the same strict success count and introduced one extra timeout. A missing session-affinity hint was a separate, rejected hypothesis. [Job-event experiment](../scripts/litellm-harness/studies/job-events/README.md), [Fireworks cache documentation](https://docs.fireworks.ai/guides/prompt-caching).

    The separate affinity experiment is now complete: six paired synthetic scenarios and 144 valid responses found no useful improvement from a stable `user` hint. Both arms already reused over 99.6% of input after warm-up. This local negative result keeps the two hypotheses separate. [Completed pilot](../scripts/litellm-harness/studies/cache-affinity/README.md).
14. **A real dependency can still sit behind the wrong test boundary.** Another background-retrieval patch attached policies just after the internal helper tested by the oracle. Even real Router/Request fixtures still failed that helper-level test. The actual outer request path reached attachment before provider dispatch, and the qualified outer test passed. Decide which boundary the user's requirement specifies before converting a failure into a coding rule. [Outer-entrypoint diagnostic](../scripts/litellm-harness/studies/background-router-oracle/README.md#follow-up-testing-the-full-processing-entrypoint).
15. **One real protocol is insufficient for shared adapter changes.** A critic called a legacy streaming path broadly broken after failures with a simplified translator. Real Chat and Messages checks passed for direct hooks, while Responses checks exposed an actual missing hook or lost rewrite. The base failed all 24 qualified checks and the reference passed all 24. This narrowed the diagnosis and motivated a guide experiment. Its completed four-trial comparison delivered no strict successes in either arm and cost more with the guide, so it was rejected. A correct diagnosis does not guarantee an effective extra instruction. [Probe and outcomes](../scripts/litellm-harness/studies/feature-effort/legacy-inheritance/README.md#real-endpoint-check).
16. **Tiny bookkeeping fields can retain huge contexts.** The metering gateway retained short regex-captured labels that kept entire serialized prompts alive, eventually exhausting its heap. Copying the labels reduced measured retained growth from about 25 MB to 0.34 MB in the same synthetic test. A meta-harness's evaluator and budget infrastructure need the same scrutiny as the solver. Missing receipts from the outage remain reserved. [Reproduction and recovery](../scripts/litellm-harness/studies/gateway-memory/README.md).

17. **Measure the complete task after improving a tool.** Native inspection avoided expensive shell-history snapshots in a microbenchmark. Yet the completed eight-attempt prompt comparison delivered 2/4 strict successes in both arms and slightly increased mean time and token cost. Models choose different trajectories after a prompt change; a faster primitive does not determine end-to-end economics. The preference was not promoted. [Completed comparison](../scripts/litellm-harness/studies/native-inspection/README.md).
18. **Bookkeeping state and model knowledge are different.** The model had read a completed command's output, but an unsealed Undo snapshot caused the host to ask for that output again. Tracking successful delivery separately removed the redundant round while retaining history and reminders for genuinely unread output. A browser reproduction and regression tests established this host defect without needing a model-quality claim. [Final-output fix](../scripts/litellm-harness/studies/final-output-delivery/README.md).
19. **Keep evidence before compressing it.** One streaming run discarded test failures through output filters, then reran the class to recover details. The completed eight-trial retention experiment changed behavior only partly: candidates used shorter tracebacks in 26 of 35 pytest invocations, but still filtered 33 directly. Both arms had zero strict successes; the instruction cost less but added mean time and a timeout, so it was not promoted. Separately, five empty-choice acceptance failures required an unstated diagnostic sentence; an independent conversion probe gave base 3/18, reference 18/18 and candidate 18/18. Compressing that result to “five bugs” would teach the wrong lesson. [Output-retention study](../scripts/litellm-harness/studies/test-output-retention/README.md), [diagnostic-wording audit](../scripts/litellm-harness/studies/empty-choices-oracle/README.md).
20. **An absent gateway file is not necessarily absent usage.** Fifty-eight unpriced requests still had provider usage saved by the runner. Unique timing, exact preceding tool output and matching assistant receipts linked those records; the rule agreed with 3,359 known receipts. Offline reconciliation released $14.56 in excess reservations, preserving original ledger history and keeping 60 unmatched requests reserved. This is usage-backed accounting, not an upstream invoice. Neither treating unknown charges as zero nor permanently equating their conservative ceiling with spending gives the right answer. [Recovery method and tests](../scripts/litellm-harness/studies/runner-receipt-recovery/README.md).
21. **A reviewer needs linked observations, not just a command list.** A critic rejected a 981-tests-passed claim even though a later background-output message contained it. Linking that message to its original job and regenerating only the summary corrected the claim for under one cent. The reviewer still questioned absent hidden tests that the solver was deliberately denied. Better evidence indexing fixes one error; it does not make every recommendation sound. [Evidence correction](../scripts/litellm-harness/studies/critic-job-evidence/README.md).
22. **Reference agreement can conceal a shared residual bug.** Both arms of a new logging task passed 19/19 reference checks. The specialized run was cheaper, but the ordinary run additionally guarded cleanup of streams that never stamped context. An actual stream-close probe found the residual gap in the base, merged reference and specialized patch. Because the reference also fails, this is not a qualified replacement acceptance suite. Original scores stay intact, alongside the broader observation. [Logging lifecycle diagnosis](../scripts/litellm-harness/studies/september14-development/README.md#first-completed-pair-context-logging).

23. **Independent tests can inherit the reference's assumptions too.** A new cached-audio aggregation probe passed the merged reference and failed the base before any model ran. It later rejected Astra's correct sums solely because an absent inner image count became zero rather than null. Separate billing and aggregation checks passed both implementations; the task had required omission of the entirely absent nested split, not a particular inner-field representation. Original scores remain unchanged, and the same diagnostic passes both routes’ first attempts and will be applied unchanged to the remaining repetitions. Qualifying an oracle is necessary but not sufficient to call every failure a behavioral defect. [Supplemental-oracle diagnosis](../scripts/litellm-harness/studies/multi-module-development/README.md#first-astra-result-and-supplemental-oracle-diagnosis).

This is the practical meaning of inspecting every tool call: find the first wrong decision and the missing information at that moment. Repeating the final error message usually does not reveal the useful intervention.

24. **More tests can be a repair mechanism, even in a slow run.** The larger Flash billing attempt spent 21 requests on commands mentioning check tools. Its broader checks caught an introduced optional-field `KeyError`, which it repaired before finishing. The same selection improved from 78 failures to one changed-rate expectation, then passed after that expectation was updated. This does not independently validate all candidate tests, but it refutes calling the entire testing phase wasted overhead. Use traces to distinguish setup errors, actual regressions and redundant repeats before optimizing call count. [Recorded evidence](../scripts/litellm-harness/studies/multi-module-development/flash-r1-trace-observations.json).

## 6. Prompting the improving agent

The following are original working templates distilled from this campaign. They are proposals to test, not prompts with a proven universal success rate.

### Diagnosis and proposal

> Inspect the supplied training traces, candidate source and evaluator output. Separate an environment failure, a flawed requirement, an implementation-coupled assertion and an actual behavioral defect. Identify the first decisive wrong turn by message or tool-call ID. Explain what information was missing at that moment and how the harness could obtain it from the pre-change checkout. Propose one small change. State which tasks should improve, where it should activate, what could regress, and what result would disprove your explanation. Treat the reference patch as training evidence, not as information the solver possessed. Preserve failed candidates and raw scores.

### Focused review

> Audit this one behavioral requirement against the named entrypoints and supplied code. Trace the relevant paths once. Return only concrete findings with the entrypoint, path condition, missing behavior and supporting source location. Code outside the excerpt is unknown. A finding is a behavioral claim, not a command to apply a particular patch. A passing higher-level wrapper test does not refute a gap at a directly callable lower-level entrypoint. Stop when the requirement has been checked; do not broaden into speculative cleanup.

### Turning a finding into a repair

> Reproduce the claimed behavior at the named boundary before deciding whether the finding is valid. If a proposed edit conflicts with your current design, distinguish a bad literal edit from a real missing behavior. Consider moving responsibility instead of duplicating it. Keep the working patch intact, make the smallest correction supported by evidence, and verify both the failing boundary and the relevant existing behavior. Report the actual checks and remaining uncertainty.

A good proposal names an observation that would be different if it were right. “Be more careful” and “add another agent” do not supply that. A proposer can be a stronger model than the deployed solver, the same model, or a human-assisted process; disclose which one actually generated and selected changes.

## 7. How to read the eventual comparison

The primary outcome should be a **correct patch delivered normally**, not a persuasive final message, a partial test percentage, or a fix recovered after timeout. Keep all three visible when they differ. Compare paired tasks under a frozen protocol, include repeated attempts, and keep the final comparison out of candidate selection.

Cost needs three views: the search investment, the cost of a fresh ordinary task, and the cost of a successful task including failed attempts or repair. Cached input, generated reasoning, tools, latency and human review can change the tradeoff. Unknown usage is not free, and a conservative reservation is not an actual charge. An unavailable Astra bill cannot support an exact dollar-ratio claim.

Repository specialization is the intended benefit here. The honest boundary is whether the harness can exploit durable repository structure on a later problem, rather than remembering a known answer. A chronological comparison helps, but a small recent sample still cannot establish all of production readiness: long migrations, concurrency bugs, ambiguous requests and incident response may be absent.

The most useful outcome is therefore a measured frontier: which task families the cheap harness handles reliably, what it costs, where it stalls, and whether the remaining failures are repairable. That evidence lets a user decide when to trust it. The target of replacing a stronger general coding setup is an empirical target, not something a budget or a long prompt can guarantee.
