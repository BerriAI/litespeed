**Verdict.** Post-hoc acceptance fails 2/16. The candidate is a partial implementation, but its streaming-eligibility test is too narrow. Steps 3–139 were mostly reconnaissance; step 11 found `supports_unified_execution` call sites, and steps 132/135 located `_pipeline_step_supports_unified_streaming` in `utils.py`, but the predicate was not opened before the first edits. Later green runs are self-authored: step 230 reports 162 passed; step 236 reports 33 passed. Neither proves the hidden eligibility cases.

**Root cause.** The candidate’s `has_legacy_post_call_hook` checks `"async_post_call_success_hook" in type(callback).__dict__`, i.e. only a hook defined directly on the concrete class. Acceptance failures show the consequence:
- `test_streaming_step_runs_legacy_hook_and_delivers_its_rewrite[_NativeHooksGuardrail]` gets `["error"]` instead of `["pass"]`.
- `test_streaming_iterator_hook_runs_legacy_hook_and_delivers_its_rewrite[True]` has no `"count"` and emits the skip warning naming `gr-post`.

Both are consistent with rejecting a valid inherited legacy hook, including one opted into native lifecycle hooks. The reference instead distinguishes the base no-op hook from an overridden/inherited hook. I cannot prove from this trace alone that both failures share one cause, but the warning and native-hook name make that likely.

**Spec ambiguity vs defect.** “A guardrail with its own async_post_call_success_hook” can be read as “defined directly on the leaf class.” Acceptance appears to require “not the base no-op,” which includes inherited overrides. That wording is underspecified. But the overstrict leaf-only predicate is still a real defect, not just oracle coupling.

**Reusable harness change 1 — eligibility probe.** Insert this prompt after the streaming eligibility predicate is located, before edits:

> “Before editing, read the streaming eligibility predicate and the unified-execution predicate together. Determine whether a valid legacy hook must be found by class attribute lookup over the MRO, not only in the concrete class `__dict__`. Write one failing test for a guardrail with `use_native_lifecycle_hooks=True` whose `async_post_call_success_hook` is inherited, and do not proceed until it fails for the expected reason.”

*Activation:* after reconnaissance finds the predicate, before implementation. *Ablation:* remove it; the solver repeats the leaf-only assumption. *Regressions:* may bias toward one implementation; keep “attribute lookup” neutral. No private reference helper names.

**Reusable harness change 2 — coverage matrix before final.** Insert before final verification:

> “Before declaring done, build the eligibility matrix from the task: unified `apply_guardrail`; direct legacy `async_post_call_success_hook`; native-lifecycle opt-in with inherited hook; iterator-hook-only. Execute and report one test per qualifying/unsupported row, plus the smallest pre-existing pipeline/guardrail tests. Self-authored green tests alone are not coverage.”

*Activation:* after implementation, before final. *Ablation:* remove it; the candidate’s step 211/234 tests only covered the direct leaf hook. *Regressions:* longer runs; risk of brittle internal assertions, so prefer public eligibility behavior.

**Uncertainty.** The executed-command index records tests at steps 179–236, so absence is not alleged. I cannot measure hidden coverage or claim the proposed changes improve acceptance beyond the observed predicate gap. No new private helper names are used in the proposed prompts.