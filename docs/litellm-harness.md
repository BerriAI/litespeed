# LiteLLM-specific harness

Choose **LiteLLM specific** in the model picker when working at the root of the LiteLLM repository. It uses your selected model with repository navigation, smaller source reads, focused-test reminders and a review after edits.

## Use it

1. Start Litespeed in your LiteLLM checkout. Open the model picker in the terminal or browser.
2. Choose **Architecture → LiteLLM specific**.
3. Select your gateway and **`fireworks_ai/deepseek-v4p1-flash`**. Choose **High** reasoning to match the evaluation. Save.
4. Describe the change normally. The architecture also works in Plan mode for reading and explaining code.

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

**Find the relevant code and tests together.** The `litellm_context` tool searches function/class names and inline code in the relevant provider, proxy, router or shared-utility directories, ranks source paths, and suggests existing tests. Inline results expose checks inside large functions whose names do not describe the behavior. This finds behavior inside generically named files as well as obvious filename matches. Symbol scans are bounded and report partial coverage. A source path returns a symbol outline; adding a query filters that outline, which helps with large files such as `router.py`. Adding an exact symbol name reads its definition with numbered lines. The tool indexes the current checkout and does not consult future Git commits, external PRs or an answer database.

**Read a useful slice first.** Unspecified `read_file` calls default to 160 lines in this architecture. Explicit ranges still work. Definitions are bounded at 240 lines and indicate when more remains. Navigation excludes generated dashboard output, hidden files, dependencies, external symlinks and binary or oversized files. Python outlines use syntax patterns, not a complete Python parser; duplicate definitions require an explicit line range.

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

See the [campaign protocol](../scripts/litellm-harness/README.md) for reproduction and the results artifact produced by the campaign for measured scope. These mechanisms do not establish a universal win over another coding agent.
