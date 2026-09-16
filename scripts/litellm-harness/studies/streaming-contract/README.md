# Endpoint-aware streaming guide

**Unpromoted development experiment on one already inspected task.**

The [real endpoint diagnosis](../feature-effort/legacy-inheritance/README.md#real-endpoint-check) separated simplified-adapter failures from actual Chat, Messages and Responses behavior. A generic manual assembler worked for two wire formats but skipped the real Responses hook. Another patch invoked that hook but lost its rewrite. Both also excluded inherited hooks; the task's word “own” makes that requirement ambiguous.

The [candidate](candidate.patch) adds a matching-source-gated guide for legacy/post-call streaming guardrail tasks. It points to the existing endpoint translators, asks for real format checks and distinguishes resolved overrides from leaf-class declarations when the intended contract includes inheritance. It adds no tools, reviewer model or runtime bypass. The production harness remains unchanged pending results. Nineteen navigation tests and typechecking pass before freeze.

The [plan](plan.json) fixes two new attempts per arm, Medium reasoning, 900 seconds, protocol 6 and the campaign's three global slots. The unchanged control and candidate both include production v34's history and test-navigation fixes. Runtime dependencies are physical copies inside each frozen worktree. Order is randomized before launch. The solver receives the existing curated task, not the withheld probe or reference patch.

Success requires normal completion, original acceptance and all 24 qualified real-adapter checks. The report retains those dimensions separately. The probe fails 24/24 on the historical base and passes 24/24 on the human reference. Its source and qualification are linked in the plan. This extra criterion was declared before these new attempts; it does not retrospectively change older scores. Two repetitions on one known task cannot estimate generalization or establish an Astra comparison.

## First repetition (interim)

The guide attempt `5933dea8` times out at 901.24 seconds: 8/16 original checks and 16/24 real-adapter checks. It passes all direct and inherited Chat/Messages cases but none of the eight Responses cases; those hooks are never invoked. The unmodified control `045a21e0` finishes normally at 881.94 seconds: 9/16 original and 8/24 real checks. It passes direct Chat/Messages cases, excludes inherited hooks, and passes the wrong native shape to direct Responses hooks. Token-priced costs are $0.5661 and $0.4939 respectively.

Both therefore fail the declared success criterion. The guide was delivered, yet manual generic assembly remained in the candidate. Its improved inherited-hook behavior does not establish that the guidance caused the difference, or compensate for the missing Responses path. The second repetition remains pending; no promotion is justified. A separately declared [Astra training diagnostic](../astra-legacy/README.md) will use the same withheld endpoint checks. It is distinct from the untouched chronological comparison.
