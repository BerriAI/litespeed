# Focused billing reviewer pilot

**Complete. No verified billing defect was delivered by any of the four review calls.** The preceding [billing-guide study](../billing-invariants/README.md) completed all four coding attempts. The second candidate still double-counts cache writes after a favorable self-review. This pilot asks whether a fresh, bounded review can supply a concrete arithmetic counterexample.

Both calls use the same eight function excerpts from that already-known training patch and its task. Neither receives the failing probe, observed result, reference patch or solver transcript. Function selection itself uses known training evidence, so this is not blind evaluation. [Input](input.json), [frozen plan](plan.json), [generic prompt](generic-prompt.txt), [conservation prompt](conservation-prompt.txt).

The calls use Flash Medium and an8,192-token output cap, serially, with no retries. The second prompt explicitly asks for a token partition and numerical mixed case. All findings require independent checking; incomplete answers and false allegations remain visible. One response per prompt on one known patch cannot justify harness promotion.

## Safe remaining capacity

The previous gateway reserved32,768 output tokens even when a request enforced a smaller limit. Future requests now reserve the full1,048,576-token uncached-input allowance plus their actual enforced output cap. Default and larger requests still reserve the same maximum as before. This does not reduce any existing unknown charge.

A real local HTTP regression rejects the old implementation, then passes with the correction. It exercises both output-limit spellings, refusal when full-size output cannot fit, and exact preservation of an old unknown record. All12 focused gateway/budget/preflight tests and type checking pass. A gateway restart after every coding trial finished preserved the ledger byte-for-byte. [Validation](reservation-validation.json).

At restart, confirmed priced charges were$52.819461724, unknown reservations$46.930329600, pending requests0, and committed capacity$99.749791324. A new8,192-token request reserves$0.236093440. Admission still stops before the unchanged$100 ceiling, or after any missing receipt. Reservations are not actual spending. Original studies, runtimes and results remain unchanged.

## Medium outcome and follow-up

Both prompts exhausted8,192 completion tokens with empty final content. There is no delivered finding to credit. [Usage and outcomes](medium-results.json). A separately [frozen follow-up](none-plan.json) uses the same source and prompts with reasoning disabled and a2,048-token output limit. This changes two controls together and tests whether a usable answer can be delivered; it is not a clean causal estimate of reasoning effort. Every alleged defect still requires independent verification.

## Verified result

| Prompt | Effort | Output limit | Final delivered | Verified task violations | USD |
|---|---|---:|---|---:|---:|
| Generic | Medium |8192|No, length limit|0|0.00732622|
| Conservation | Medium |8192|No, length limit|0|0.00734037|
| Generic | None |2048|Yes|0|0.00253770|
| Conservation | None |2048|Yes|0|0.00260216|

Total **$0.01980645**. [Follow-up outcomes and assessment](none-results.json), original final answers ([generic](none-generic.md), [conservation](none-conservation.md)). Final answers are retained as model claims; private reasoning is not published.

The generic reviewer alleges an absent-rate fallback defect. Its example executes correctly on both candidate and reference: total and breakdown each equal$0.00004. A separate cap-order allegation exposes a real reference difference on internally inconsistent counts (nested192, aggregate1), but the task supplies no modality priority: candidate$0.0058044, reference$0.0057764. That difference stays visible and is not counted as a proven task violation. The conservation reviewer correctly retraces the original$0.0015328 example but never tests the mixed cache-write case and misses the known overcharge. [Witness source](witness_probe.py), [frozen witness plan](witness-plan.json), [executed results](witness-results.json).

These outputs reinforce a narrow lesson: a delivered prompt, a positive self-review, or a numerical example is not evidence that the important interaction was checked. This pilot does not validate a replacement reviewer or justify promoting either prompt.

## Current admission limit

After all four responses settle, confirmed priced spend is**$52.839268174** and unknown reservations remain**$46.930329600 across186 requests**. No request is pending. The committed bound is**$99.769597774**; remaining capacity$0.230402226 is below the minimum$0.230687380 reservation for the full input window plus one output token. No further request fits the current safe bound. This is not$100 in actual spending. Billing reconciliation is required to release unknown charges; the supplied key is restricted to inference routes and billing endpoints return403.
