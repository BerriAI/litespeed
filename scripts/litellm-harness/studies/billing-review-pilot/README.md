# Focused billing reviewer pilot

**Both Medium calls finished without a final answer. A two-call follow-up is frozen; no quality conclusion.** The preceding [billing-guide study](../billing-invariants/README.md) completed all four coding attempts. The second candidate still double-counts cache writes after a favorable self-review. This pilot asks whether a fresh, bounded review can supply a concrete arithmetic counterexample.

Both calls use the same eight function excerpts from that already-known training patch and its task. Neither receives the failing probe, observed result, reference patch or solver transcript. Function selection itself uses known training evidence, so this is not blind evaluation. [Input](input.json), [frozen plan](plan.json), [generic prompt](generic-prompt.txt), [conservation prompt](conservation-prompt.txt).

The calls use Flash Medium and an8,192-token output cap, serially, with no retries. The second prompt explicitly asks for a token partition and numerical mixed case. All findings require independent checking; incomplete answers and false allegations remain visible. One response per prompt on one known patch cannot justify harness promotion.

## Safe remaining capacity

The previous gateway reserved32,768 output tokens even when a request enforced a smaller limit. Future requests now reserve the full1,048,576-token uncached-input allowance plus their actual enforced output cap. Default and larger requests still reserve the same maximum as before. This does not reduce any existing unknown charge.

A real local HTTP regression rejects the old implementation, then passes with the correction. It exercises both output-limit spellings, refusal when full-size output cannot fit, and exact preservation of an old unknown record. All12 focused gateway/budget/preflight tests and type checking pass. A gateway restart after every coding trial finished preserved the ledger byte-for-byte. [Validation](reservation-validation.json).

At restart, confirmed priced charges were$52.819461724, unknown reservations$46.930329600, pending requests0, and committed capacity$99.749791324. A new8,192-token request reserves$0.236093440. Admission still stops before the unchanged$100 ceiling, or after any missing receipt. Reservations are not actual spending. Original studies, runtimes and results remain unchanged.

## Medium outcome and follow-up

Both prompts exhausted8,192 completion tokens with empty final content. There is no delivered finding to credit. [Usage and outcomes](medium-results.json). A separately [frozen follow-up](none-plan.json) uses the same source and prompts with reasoning disabled and a2,048-token output limit. This changes two controls together and tests whether a usable answer can be delivered; it is not a clean causal estimate of reasoning effort. Every alleged defect still requires independent verification.
