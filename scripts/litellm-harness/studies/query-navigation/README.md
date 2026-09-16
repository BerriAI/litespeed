# Full-query scope and explicit symbol ranking

**Experimental; not promoted.** The first larger billing trace's starting map searched cache and response areas but omitted `litellm/cost_calculator.py`. A later file query named `_calculate_input_cost` explicitly, yet several generic rate matches appeared ahead of it. These are observed navigation outputs, not proof that they caused the run's latency.

The candidate uses the entire bounded query when selecting repository areas, keeps explicit underscore identifiers within the 24-token ranking budget, recognizes pricing/billing language, adds the core billing module to that scope, and prioritizes exact underscore identifiers or a single-term symbol query. Natural-language words that happen to name a function do not get that exact-name boost in a multiword query. Existing scan/output bounds and read protections apply. This is a bundle; its study cannot isolate the contribution of each part.

Three new regressions fail before the change and pass afterward. Type checking and 34 focused harness/runner tests pass. Repeating the actual two recorded queries against the answer-free historical base exposes the realtime cost-processing class and ranks the named function first. [Navigation observations](navigation-observations.json) retain both outputs. No model is involved in that capability check.

## Frozen comparison

The [plan](plan.json) declares eight attempts: two repetitions per arm on the known mock-input-token task and larger cached-audio billing task, with Medium reasoning, protocol 7, the shared three-slot queue, and 900/1800-second limits respectively. Both arms use the v52 production runtime, including the price-map limit correction. They do not include experimental grouped edits or chronological notices, so these results must not be pooled with earlier v46 billing trials.

Success requires normal completion and unchanged reference checks. For billing, this new study prospectively adds the qualified seven-check billing/aggregation probe (base0/7, reference7/7), identically in both arms. The older study's four-check representation assertion and scores remain unchanged and separately reported. All cases are already known development data; the September 15 final corpus remains reserved. New queuing stops at $80 committed to preserve final-comparison funds.

Reconstruct the control at public PR commit `0fdc384`, then apply [candidate.patch](candidate.patch) in a separate copy for the candidate. Install dependencies inside each runtime. Private experiment commits are recorded identities; they are not required downloads. Use fresh labels and a local plan with your new commit identities for reproduction. [Results](results.json).
