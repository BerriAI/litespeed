# Inherited guardrail hook: host diagnosis of a training failure

The frozen High-reasoning legacy-stream replay `0fb33cb0` timed out at 900.09 seconds and passed 14/16 original checks. Both failures involved a native-hook guardrail whose legacy post-call hook came from its parent class. The candidate's new predicate looked only in the leaf class's `__dict__`. Its comment explicitly excluded inherited hooks, even though the inherited custom implementation was the needed behavior.

**Specification caveat:** the retrospectively curated task twice says a guardrail has “its own” legacy hook and never explicitly mentions inherited overrides. The retained traces connect the leaf-class choice to that wording and to the existing unified-interface classifier. A custom inherited override is required by the reference tests, but “own” can also reasonably mean directly declared. Thus these failures do not isolate model capability from task-curation ambiguity. The diagnosis below identifies the exact difference from tested behavior; it does not prove the solver ignored an unambiguous requirement. For a future task whose intended contract includes inheritance, state “a custom override, including one inherited from an intermediate class, excluding the base default.” Frozen prompts and scores are unchanged.

On a separate copy with the independently captured original acceptance tests, replacing only that predicate with comparison of the resolved class method against `CustomGuardrail`'s default produced 16/16. [The result](diagnostic.json) records the exact old/new line and import-origin verification. This was a host-authored diagnosis informed by the failed checks, not a successful solver repair. The original 14/16 and timeout remain unchanged. No production guide is promoted from this diagnostic.

The [candidate patch](candidate.patch) and [case provenance](case.json) support reproduction: archive the recorded base commit, apply the candidate patch, restore `reference_paths` from the recorded reference commit, load the unchanged declared fixture plugins, and run `test_nodes` through the workbench's offline pytest runner. The original candidate gives 14/16. Apply only the recorded predicate change on another copy and repeat to obtain 16/16. Disable adjacent bytecode and verify imports as required by the replay protocol.

A possible reusable lesson is to test an extension point both with a directly declared override and an intermediate subclass inheriting that override, while distinguishing a custom inherited hook from the base no-op. This does not imply replacing every existing leaf-class classifier: some dispatch rules intentionally require local definitions. Both planned windowed model critiques are complete; they do not establish a tested prompt remedy.

A second frozen replay, Medium reasoning with the batched-edit candidate (`e34ad1d3`), independently made the same leaf-class predicate and failed the same two checks (14/16, 900.15-second timeout). It successfully used four batch-edit calls containing nine edits. The [second candidate patch](batched-candidate.patch), with only the same predicate corrected on a separate copy, also gives [16/16](batched-diagnostic.json). This repeated failure distinguishes the dispatch assumption from editing-tool efficiency; it still does not establish a tested prompt remedy.

## Reference-aware critic follow-up

A later windowed Flash review of the High-reasoning trace independently named the same leaf-class eligibility predicate and explicitly noticed the ambiguous word “own.” Its [final synthesis](critic-final.md) is retained as model-authored advice. The host's one-predicate diagnostic established that this difference accounts for both failed reference checks. The critic's stronger assertion that the behavior is unambiguously a defect is not warranted by the curated wording alone; production semantics require a clear contract. Its proposed extra prompts remain untested and unpromoted.

The [Medium-trace critic](medium-critic-final.md) reviewed thirteen windows and synthesized them in a fourteenth request ([usage](medium-critic-usage.json), $0.06995 token-priced). It blamed manual stream assembly for the failed simplified-adapter tests and proposed using the endpoint translator. The model's broad claim that the buffered path is not operational needed a real-adapter check.

## Real endpoint check

The [executable probe](real_stream_probe.py) uses the actual Chat Completions, Anthropic Messages and Responses translators. For each, it checks a direct legacy hook and an inherited native-lifecycle hook, with rewrite, `None`, blocking exception and ordinary-error behavior. It checks the object received at hook entry as well as the resulting stream and pipeline outcome. It uses real chunk shapes, including byte SSE events for Messages. No provider calls are made.

| Snapshot | Chat | Messages | Responses | Total |
|---|---:|---:|---:|---:|
| Historical base | 0/8 | 0/8 | 0/8 | 0/24 |
| Human reference | 8/8 | 8/8 | 8/8 | 24/24 |
| Medium first repetition (`78c8c634`) | 4/8 | 4/8 | 0/8 | 8/24 |
| High second repetition (`23506304`) | 4/8 | 4/8 | 3/8 | 11/24 |
| Medium + host predicate correction | 8/8 | 8/8 | 0/8 | 16/24 |
| High + host predicate correction | 8/8 | 8/8 | 6/8 | 22/24 |

[Results and provenance](real-stream-results.json) retain every check, verified import origins and reference production-file verification. These are posthoc training diagnostics, not replacements for the frozen scores. The original Medium and High trials remain 10/16 and 13/16, both timed out. Even with the host's one-predicate correction, their original simplified-adapter checks give only 11/16 and 14/16 respectively.

The narrower conclusion is useful: both patches handle direct hooks through real chat and Messages adapters. The Medium patch nevertheless skips the real Responses hook entirely because its manual generic assembler cannot consume Responses events. The High patch invokes it and preserves `None`/exception behavior but discards the requested text rewrite. The critic identified a relevant abstraction boundary, but its exact reference-test symptoms did not establish which real endpoints failed. Testing one endpoint would have missed this distinction. Testing only a fake translator would have overstated the defect in the other two.

Probe qualification also caught two host-test mistakes before these results: retaining a mutable response reference inspected its later write-back state, and string SSE did not match the Messages endpoint's byte-stream contract. The final probe snapshots input at hook entry and uses bytes. The earlier scratch outputs are retained privately; they are not scored evidence.

## Real-adapter checks on other mechanism trials

A [separate posthoc diagnostic](mechanism-probes.json) applies the unchanged qualified 24-case probe to all eight legacy-streaming attempts in the native-inspection and grouped-edit plans. No original study criterion, completion flag or score changes.

| Attempt | Original checks | Real checks | Normal completion |
|---|---:|---:|---|
| Native inspection, first | 14/16 | 12/24 | Yes |
| Native inspection, second | 14/16 | 12/24 | No |
| Native control, first | 16/16 | 24/24 | No |
| Native control, second | 14/16 | 12/24 | No |
| Grouped edits, first | 12/16 | 11/24 | Yes |
| Grouped edits, second | 14/16 | 12/24 | No |
| Grouped-edit control, first | 16/16 | 24/24 | No |
| Grouped-edit control, second | 16/16 | 24/24 | No |

The four 12/24 patches pass every direct-hook case across all three protocols; their remaining failures exclude inherited hooks under the task's ambiguous “own hook” wording. These patches do not have the Responses assembly defect found in the first endpoint-guide trial. Three controls pass all selected real checks, but all reach the deadline. A passing patch at cancellation does not establish a normally delivered or fully correct result.

The native control fixed inheritance late, observed 37 passing focused tests, and started another check just before cancellation. Both grouped-edit controls were still running additional tests. These observations separate semantic mistakes from delivery-time failures; they do not establish that all further testing was unnecessary. The protocol imposes a 900-second cutoff but does not send a countdown to either solver. Real-adapter coverage and the hard-cutoff delivery metric answer different questions.

The final grouped-edit legacy repetition (`b8cb7b87`) finishes normally at 770.09 seconds with 12/16 original checks and 11/24 real-adapter checks. Direct Chat and Messages pass; direct Responses runs the hook but loses its text rewrite; inherited native hooks do not run. The final native control (`e1c959a3`) times out at 901.24 seconds with 14/16 original and 12/24 real-adapter checks. The [mechanism table](mechanism-probes.json) includes all eight completed attempts. Original scores and timeout distinctions remain unchanged.
