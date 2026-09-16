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

The original four-check probe, **1/4 score and strict study outcome remain unchanged**. These three failures do not demonstrate three billing defects under the supplied contract. The diagnostic does not prove all consumers consider zero and absent identical. It will be applied unchanged to all four planned attempts. Prequalification catches missing behavior in the base; it does not guarantee that a newly written probe avoids reference-specific assumptions.

## First complete model pair

Flash Medium finishes normally in **1,017.86 seconds** for **$0.18754 token-priced usage**, passing **17/17 reference checks**, **1/4 original supplemental checks**, and **7/7 unchanged posthoc diagnostic checks**. Its three original supplemental failures have exactly the same zero-versus-`None` cause as Astra's. [Flash patch](flash-r1.patch).

Astra's first completion is **460.29 seconds**; its account dollar cost is unavailable. This pair supports successful implementation of the tested billing behavior by both models, with Flash taking over twice as long. It cannot establish a quality or dollar-cost advantage. Both second repetitions remain pending, and the strict predeclared study outcomes remain failures because of the supplemental representation requirement.

Flash makes 141 model requests, with 573.07 recorded model seconds and 386.80 seconds of unioned tool activity. These measurements are not a mutually exhaustive timing partition. The trace includes a structured edit rejected because the 2,395,003-byte price map exceeds the host's 2 MiB limit, then a shell-based fallback. That is a concrete host capability gap; fixing it does not change this recorded trial or establish how much faster a rerun would be.
