# LiteLLM-specific harness

Choose **LiteLLM specific** in the model picker when working at the root of the LiteLLM repository. It uses your selected model with repository navigation, smaller source reads, focused-test reminders and a review after edits.

## Use it

1. Start Litespeed in your LiteLLM checkout. Open the model picker in the terminal or browser.
2. Choose **Architecture → LiteLLM specific**.
3. Select your gateway and **`fireworks_ai/deepseek-v4p1-flash`**. Choose **High** reasoning to match the evaluation. Save.
4. Describe the change normally. The architecture also works in Plan mode for reading and explaining code.

The campaign used a verified 1,048,576-token context limit. To reproduce that setting, open **Settings → Providers → Context window overrides** and add the exact Flash model ID with `1048576` tokens after confirming your gateway exposes that capacity. The architecture otherwise uses normal Litespeed model discovery or its planning default; choosing the architecture does not change provider limits.

Your gateway credentials stay in the normal local provider configuration. Selecting the architecture preserves your model choice; it does not silently route requests to another provider. There is no specialist model to configure. Optional planner and Shunt models remain available through the existing settings; both were disabled in the campaign.

The equivalent session API selection is:

```json
{
  "providerId": "your-gateway-provider-id",
  "model": "fireworks_ai/deepseek-v4p1-flash",
  "architecture": {"kind": "litellm-specific"}
}
```

## What changes

**Find the relevant code and tests together.** The `litellm_context` tool searches function/class names and inline code in the relevant provider, proxy, router or shared-utility directories, ranks source paths, and suggests existing tests. Queries that mention multiple areas search all of them; for example, team/router queries search both proxy and router symbols. The scan interleaves those areas so a large directory cannot exhaust the budget before the others are visited. The output reports which areas were scanned. Inline results expose checks inside large functions whose names do not describe the behavior. This finds behavior inside generically named files as well as obvious filename matches. Symbol scans are bounded and report partial coverage. A source path returns a symbol outline; adding a query filters that outline, which helps with large files such as `router.py`. Adding an exact symbol name reads its definition with numbered lines. The tool indexes the current checkout and does not consult future Git commits, external PRs or an answer database.

**Read a useful slice first.** Unspecified `read_file` calls default to 160 lines in this architecture. Explicit ranges still work. Definitions are bounded at 240 lines and indicate when more remains. Navigation excludes generated dashboard output, hidden files, dependencies, external symlinks and binary or oversized files. Python outlines use syntax patterns, not a complete Python parser; duplicate definitions require an explicit line range.

**Recall relevant repair lessons.** A task query can return a short guide learned from development fixes: cached response boundaries, budget counter recovery, router resolution and request-local state, or DashScope rerank endpoints. Guides appear only for matching queries when a relevant source file exists in the checkout. They name likely bypass paths and concrete counterexamples, and explicitly require verification against the current code. They contain no future test patches and do not treat a previous fix as proof of today's bug.

**Use LiteLLM's structure.** Versioned instructions describe provider transformations, shared response/streaming utilities, router, proxy, enterprise code, types, mirrored tests and dashboard source. They direct the model to respect repository guidance, preserve caller inputs and check relevant sync/async and streaming counterparts.

**Turn exploration into action.** After 12 tool calls without a recorded edit, one reminder asks an implementation task to state its hypothesis and use a minimal regression or executable probe to distinguish it from alternatives. It also tells read-only tasks to finish their explanation when the evidence is sufficient. This does not grant permission to edit or prevent further necessary investigation.

**Stop wasting checks.** After four recorded check commands, one reminder asks the model to identify the remaining uncertainty. LiteLLM test files can mix mocked unit tests with live service tests. The reminder encourages precise selections and discourages repeatedly rerunning successful checks or toggling a patch to investigate unrelated flakiness. It does not block additional testing when needed.

**Review the actual change.** Before a Build turn with recorded edits finishes, the host requests one focused review. The model should check coverage of each requested code path, examine a concrete counterexample, compare the surrounding contract and run a relevant check if permitted. The review highlights protocol representation, URL composition, caller-owned state and absent/null/false distinctions. It uses the same selected model and normal tools. It is a quality prompt, not an independent correctness oracle.

The review can add work and latency. It runs once per changed turn; it does not run for read-only explanations or Plan mode. Normal cancellation, permissions, receipts, history and Undo continue to apply. Successful symbol reads count as file-read evidence; an outline or missing symbol does not.

## Permissions and limits

The navigator is available only when the underlying read, glob and grep capabilities are available. Any ask/deny rule or explicitly matched hook on those tools disables the composite navigator, leaving ordinary tools to enforce the configured policy. Configured sidecars also use this fallback so that navigation cannot skip their interception. This intentionally conservative behavior prevents a repository-navigation shortcut from bypassing a scoped file restriction.

Opening another repository produces a navigation hint instead of fabricated LiteLLM results. This architecture is repository specialization, not model training or an operating-system sandbox. It does not automatically modify its own instructions in response to a user's session. Improvements are evaluated and versioned in the code.

## How it was improved

The campaign replays historical LiteLLM changes through the actual Litespeed runner. It captures messages, tool arguments/results, token usage, patches and timing, then scores the resulting code with separately held reference tests. Runs of the installed Codex CLI use `gpt-6-astra` with High reasoning for comparison. There is no substitute model behind that baseline.

The initial navigation-only version reduced work on one Bedrock mapping task, but it still missed URL edge cases. Adding more up-front instructions did not fix that reliably. A review after edits did catch a malformed streaming query in a real run and corrected it before completion. Router traces exposed another waste pattern: repeated checks, patch toggling and broad test selections. Those observations motivated the verification reminder and filtering of large symbol outlines. A proxy budget replay then exposed repeated investigation of a shared check while missing a different inline condition in the authentication fast path. The navigator now returns inline matches as well as named definitions, and the exploration reminder asks for a concrete probe rather than further speculation.

The later repair guides addressed repeated rediscovery of repository-specific behavior. On the empty-response development case, a guide led the model to fix two cached-streaming crashes that earlier runs missed; five exact diagnostic-string checks still failed. On DashScope, the guide helped a completed run pass 10/10 checks, A plain-model High run passed 2/10, but its later audit found live-checkout access, so it is not a controlled baseline. Budget and router-strategy development runs still reached their time limits. A fresh budget run with a 900-second allowance finished in 625 seconds but passed only 3/5 checks. These are development observations, not a generalization claim.

Guide provenance is reviewable in the public LiteLLM fixes: [empty responses](https://github.com/BerriAI/litellm/commit/b7dad8b44e30e87e6ae174ea6f58054e17cfc8a5), [budget recovery](https://github.com/BerriAI/litellm/commit/d963e9fa6e770e359bdf17bbf2c47c729667e1b6), [candidate resolution](https://github.com/BerriAI/litellm/commit/2000642592670baf38c46f4c6e3bcb851c59d79e), [request strategy isolation](https://github.com/BerriAI/litellm/commit/b0071f363f8dd55a3a252e61f51f088ac5bab73c), and [DashScope reranking](https://github.com/BerriAI/litellm/commit/e907e5ee9b562ab0160eab8cd6245eb4f40c9256). These are training/development cases, not the reserved comparison cases.

See the [campaign protocol](../scripts/litellm-harness/README.md), [original frozen comparison](../scripts/litellm-harness/comparison-plan.json), [repair-guide follow-up plan](../scripts/litellm-harness/replication-plan.json), and [measured results](litellm-harness-results.md). The earlier measured versions are reported separately. The shipped v13 also fixes mixed-area navigation and shares the scan budget across relevant areas. It has focused regressions, training replays and a [separate evaluation on the same known tasks](../scripts/litellm-harness/final-evaluation-plan.json). That last evaluation is post-hoc, not fresh held-out evidence. These mechanisms do not establish a universal win over another coding agent.

### Changes that did not earn a place

- More up-front boundary advice alone did not reliably fix the Vertex URL case. A review after the model had made a patch exposed the concrete query-string error in one run.
- A separate, stateless patch-review request mainly produced speculative warnings. It was not added to the architecture.
- Changing the requested reasoning effort did not consistently solve the investigation loops. Low development runs still timed out on budget and empty-response tasks. Max produced a passing Vertex patch but reached the 600-second development limit before finishing. High remains the setting used in the frozen comparison; the picker preserves the user's choice.
- A smaller context cap and incomplete historical snapshots were evaluation mistakes. They were corrected before the comparison. Repeating a model run against a broken environment would have produced misleading evidence.

### What the measurements mean

The success target is a completed run whose patch passes every selected reference check. Reference tests are stronger evidence than the model's own summary, but they remain incomplete and sometimes enforce incidental wording. For example, five failures in an empty-response development run were exact diagnostic-string differences, while two were real cached-streaming crashes. The raw pass count keeps those failures; this distinction prevents interpreting every red test as the same kind of defect.

The campaign is repository specialization through evaluated code and prompt changes. It does not train model weights, use a hidden stronger model to make the candidate edits, or automatically rewrite the production harness after an ordinary session. The original replay protocol withheld reference patches from task workspaces, but failed to isolate the shell: four v9 trials read the live checkout, including newer source and tests. Those trials are flagged in the results and cannot support a fair comparison. The workbench now launches new solvers behind a tested macOS filesystem boundary that blocks those reads; the old results do not inherit that protection. The frozen test tasks were reserved from candidate iteration; their requirements and acceptance tests were still curated from public historical changes.

For local UI verification, run `npm run test:tui:litellm` for the real terminal picker, persistence, Plan navigation and narrow layout. The browser equivalent is `npx playwright test tests/e2e/litellm-harness.spec.ts`.
