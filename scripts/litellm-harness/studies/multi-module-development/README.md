# Larger multi-module development case

The earlier September 14 corpus selected changes of 20–450 lines and up to four production Python files. This [separate metadata rule](preparation-plan.json) targets 450–2000 changed lines, 5–12 production Python files and 1–6 Python test files over September 11–14 UTC. It selects up to six most recent matches before reading source patches or PR bodies. **Only one change qualifies by metadata**: [cached realtime-audio billing](https://github.com/BerriAI/litellm/pull/40627), spanning eight production Python files, five Python test files, and the cost map. No selection rule was widened after this result.

## Qualification before model allocation

The [catalog](catalog.json) freezes retrospective behavioral requirements, including explicit historical price corrections. These are supplied task data, not claims about current prices. Source and acceptance are separate; the solver receives the pre-change checkout and requirements. The merged patch's authorship is not assumed.

Three changed tests live in a module importing the newly introduced `CachedTokensDetails` type. Using that module would fail base collection and require a particular type name. The [curation record](curation-record.json) excludes those tests **before qualification**, with no import shim or observed solver outcome. A separately frozen [four-check probe](aggregation_probe.py) covers the omitted behavior through existing entrypoints: nested cached-token aggregation, either ordering when one event lacks the split, unchanged input data, and omission of an absent optional key from serialized usage. It accepts attributes or dictionaries without importing the new type.

| Evidence | Historical base | Merged reference |
|---|---:|---:|
| Selected reference checks | 4/17 | 17/17 |
| Independent aggregation/serialization checks | 1/4 | 4/4 |

Both processes collect the original tests without setup errors. [Original qualification](qualification.json), [supplemental qualification](aggregation-qualification.json), [completion record](qualification-complete.json). Changed production files and the cost map byte-match their pinned Git revisions. The supplemental runner verifies every LiteLLM import originates inside the chosen snapshot and disables adjacent bytecode reuse; network is denied. This establishes a usable oracle, not complete production coverage. Remaining reference assertions can still constrain rate representation.

## Frozen development comparison

The [plan](plan.json) gives actual Codex/Astra High and LiteLLM-specific Flash Medium two attempts each, with the same 1800-second limit, source, task and dependencies. Both use the prepared v46 product code plus the replay-only deadline configuration. Each result requires normal completion, all 17 selected reference checks and all four supplementary checks. Raw counts and failed attempts remain visible. The shared three-slot queue and $80 committed threshold for additional allocations preserve campaign capacity and funds.

This is a diagnosis on one larger development task. It cannot establish general superiority or attribute a difference solely to the model, harness or reasoning effort. Astra account dollar cost is unavailable. No September 15 reserved outcome or prompt is used. Reconstruct the runtime using the [verified public patch chain](../deadline/reconstruction-validation.json), then use fresh labels and a new local plan. Original input hashes and experimental identities remain unchanged.

## First Astra result and supplemental-oracle diagnosis

The first Astra High attempt finishes normally in **460.29 seconds**, passing **17/17 reference checks** and **1/4 predeclared supplemental checks**. All three supplemental failures arise solely from an absent inner cached-image count becoming `0` rather than `None`. Text/audio totals and input immutability match. The entirely absent nested key is correctly omitted. [Candidate patch](astra-r1.patch).

That inner-field representation was prescribed by our new probe, although the supplied task explicitly requires omission only of the entirely absent nested split. A separate [seven-check diagnostic](representation_probe.py) tests actual input-billing arithmetic with absent and zero image counts, combined usage billing, partially supplied splits in both orders, and nonzero cached-image aggregation. The historical base passes **0/7**, the merged reference **7/7**, and this Astra patch **7/7**. Both representations produce the requested $0.0015328 input price; the combined-event case also matches its arithmetic. [Results and scope](representation-observations.json).

The original four-check probe, **1/4 score and strict study outcome remain unchanged**. These three failures do not demonstrate three billing defects under the supplied contract. The diagnostic does not prove all consumers consider zero and absent identical. It was applied unchanged to all four planned attempts; each passes all seven checks. Prequalification catches missing behavior in the base; it does not guarantee that a newly written probe avoids reference-specific assumptions.

## First complete model pair

Flash Medium finishes normally in **1,017.86 seconds** for **$0.18754 token-priced usage**, passing **17/17 reference checks**, **1/4 original supplemental checks**, and **7/7 unchanged posthoc diagnostic checks**. Its three original supplemental failures have exactly the same zero-versus-`None` cause as Astra's. [Flash patch](flash-r1.patch).

Astra's first completion is **460.29 seconds**; its account dollar cost is unavailable. This pair supports successful implementation of the tested billing behavior by both models, with Flash taking over twice as long. It cannot establish a quality or dollar-cost advantage. The completed comparison is summarized below; the original first-pair scores remain unchanged.

Flash makes 141 model requests, with 573.07 recorded model seconds and 386.80 seconds of unioned tool activity. These measurements are not a mutually exhaustive timing partition. The trace includes a structured edit rejected because the 2,395,003-byte price map exceeds the host's 2 MiB limit, then a shell-based fallback. That is a concrete host capability gap; fixing it does not change this recorded trial or establish how much faster a rerun would be.

## Where the first Flash attempt spent its work

The run makes 141 model requests and 163 tool calls. Its first edit starts at 176.46 seconds. Request-attributed spend is $0.04326 for navigation, $0.06322 for other shell commands, $0.03744 for structured edits and $0.03207 for commands mentioning check tools; the remaining categories are retained in the [trace observations](flash-r1-trace-observations.json). These amounts charge an entire model request to its next action, not the marginal execution cost of that tool. Model time and tool intervals can overlap and do not form an exact elapsed-time decomposition.

Twenty-one check-related requests are not automatically wasted work. Calls 110–119 show broader cost tests exposing a candidate `KeyError` for an absent optional dictionary field, followed by a repair from direct indexing to `get()`. The same selection moves from 78 failed / 371 passed to 448 passed / 1 failed; updating the expected newly expanded rate object then yields 449 passed. A later combined check reports 668 passed. These are recorded execution outputs, with candidate-modified tests, not independent acceptance or complete coverage claims. The initial eight fixture errors are a separate setup issue.

The inspected sequence supports preserving checks that name a remaining compatibility question. It does not justify a hard four-test cutoff. The separate price-map tool failure motivates the reproduced host fix, while the observed navigation outputs motivate a [new controlled comparison](../query-navigation/README.md). Neither should be described as an established end-to-end speedup.

## All four attempts complete

All four finish normally before the infrastructure incident. The unchanged seven-check representation diagnostic passes for every attempt.

| Attempt | Reference checks | Original supplemental | Diagnostic | Seconds | Flash USD |
|---|---:|---:|---:|---:|---:|
| Astra 1 | 17/17 | 1/4 | 7/7 | 460.293 | unavailable |
| Astra 2 | 16/17 | 1/4 | 7/7 | 563.927 | unavailable |
| Flash 1 | 17/17 | 1/4 | 7/7 | 1017.864 | 0.187538 |
| Flash 2 | 16/17 | 4/4 | 7/7 | 1083.627 | 0.256533 |

Strict frozen outcomes are **0/2 in both arms**. Flash averages 1,050.75 seconds against Astra's 512.11 seconds, costing $0.44407 across both Flash attempts. This is one known development task, not evidence of general quality or cost superiority. [Second Astra patch](astra-r2.patch), [second Flash patch](flash-r2.patch), [full observations](representation-observations.json).

The second Astra reference failure concerns a missing cached-audio fallback rate in `BilledTokenRates`; the second Flash failure is a direct private-helper call using a dictionary without the new nested key. These are distinct from the three supplemental representation failures. The recorded failures remain; their effect on public billing paths requires a separate behavioral check before claiming an actual request fails.

## Public billing paths distinguish the remaining failures

A second, unchanged-across-snapshots [five-case probe](public_path_probe.py) checks the public total/breakdown functions with synthetic supported usage: tiered text caching, cached audio with absent/zero/explicit audio prices, and ephemeral cache writes when the aggregate creation count is zero. Base passes **2/5**, reference and both Astra patches **5/5**, and both Flash patches **2/5**. Snapshot-local imports, no network and fresh bytecode are verified. [Observations](public-path-observations.json).

Astra 2's missing fallback *metadata* does not cause wrong totals or breakdown amounts in these cases; its original rate-object assertion still fails. Flash 2's direct-helper `KeyError` does not reproduce through the public ephemeral-write path. However, a separate behavioral defect does: both Flash patches bill the 10,000 cache-creation tokens again at the full text rate when a nested cached-audio split is supplied. The overcharge is **$0.06** in each of three synthetic mixed cases, whether the audio-cache rate is absent, zero, or explicit. Both new nested-split branches bypass the old shared noncached-token budget, which subtracts cache writes before pricing full-rate input.

This is a qualified behavioral counterexample, not three unrelated defects or a production invoice. The original scores and earlier seven-check success remain unchanged. It shows why passing the requested example plus isolated existing cache-write tests can miss an interaction. A future billing-specific review should account for each token bucket once and exercise new modality handling together with existing cache writes; that proposal is now a [separately frozen candidate](../billing-invariants/README.md), with delivery tests and base/reference qualification but no paid solver result yet.
