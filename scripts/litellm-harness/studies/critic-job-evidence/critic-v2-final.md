**Trace review**

Acceptance is green (52 passed, 0 failed), so the candidate is viable. The trace, however, overstates verification in several places. Global index must be checked before absence claims: step 123 (combined `test_user_api_key_auth_mcp.py` + `test_mcp_server_manager.py`) is recorded only as a background job start, not a completed result; the final “981 passed” claim is therefore not evidenced in the global index. Step 121’s 479 passed and step 119’s 15 passed are recorded. Step 133’s 151 passed covers unrelated passthrough/adapter files and gives no coverage for the requested behavior. Acceptance provides the strongest evidence and partially discharges these gaps, but the trace’s own coverage claims remain weaker than stated.

**Findings against requirements**

- **Req 1 (step 51, 60).** Candidate implemented a denylist: oauth2 special case; `oauth2_id_jag`, `oauth_delegate`, `true_passthrough`, `oauth2_token_exchange` false; everything else true unless client-auth header. The task enumerates an allowlist. For the enumerated modes the outcome matches, and `oauth2_token_exchange` is plausibly OAuth-family, but the task says “e.g.” for the false set, leaving unenumerated modes underspecified. Candidate may admit future/unlisted auth modes. This is a latent scope risk, not an observed acceptance failure; reference uses the stricter allowlist.
- **Req 2 (step 77, 115, 135).** Candidate eventually added focused non-oauth2 challenge tests; acceptance passes. But steps 115/117/135 show the bearer/fallback path was inferred from an existing helper and green self-tests, not read directly before the “no code change” claim. No measured defect.
- **Req 3 (step 131, 137).** Step 131 admits the PRM test covers only `auth_type=none` and assumes the path is auth-type agnostic; step 137 nevertheless reports full verification. Requirement 3 explicitly demands every non-oauth2 type and both spellings. Acceptance green is reassuring, but trace evidence is incomplete.
- **Req 4 (steps 45–49).** This is the strongest part of the trace: reads establish scope sealing/redemption already generic, so only admission gates change. Candidate’s `server.auth_type != MCPAuth.oauth2` branch is equivalent to the reference’s admitted set, where non-oauth2 advertising servers become `m2m`.
- **Req 5 (steps 54, 71, 73, 81).** Candidate admits the property in the shared named-discovery gate. It flagged, but did not resolve, that the named AS route may still serve per-server issuer metadata while PRM advertises `["<base>/mcp"]`. That is an underspecified document-shape question, not a proven defect. Acceptance passes.

**Oracle coupling / underspecification**

Self-authored tests in steps 95–105 and the rewritten old-contract tests in 81–93/95–105 are coupled to the candidate’s chosen semantics. They are not independent oracles. `oauth2_token_exchange` false, and the requirement-5 AS-route shape, are underdetermined by the task text. Do not treat any self-authored green subset as proof of hidden-test coverage.

**Reusable harness changes (max two)**

1. **Coverage matrix before editing.**
   - Exact prompt text: “Before any edit, write a coverage matrix from the task text: enumerate every auth_type named True/False, every extra-header spelling, both per-server URL spellings, and the single-target/CSV/header-mismatch/unknown cases. For each cell name the source function or test that will observe it. Do not mark a cell covered because a different auth_type passed or because the code path looks generic.”
   - Activation: after task read and initial reconnaissance, before the first source edit.
   - Ablation: current trace (step 131 only `none` for Req 3; steps 77/79 self-selected subsets) leaves breadth gaps.
   - Possible regression: longer test runs and matrix overfitting to visible cells; not proof of hidden correctness.

2. **Observable-emitter verification before “no code change.”**
   - Exact prompt text: “When you claim a requirement needs no code change, first read the exact function that emits the observable—status code, WWW-Authenticate value, or JSON field—and cite its line. If only a helper or a green test you wrote is available, treat the requirement as unverified and add a focused test or make the minimal change.”
   - Activation: when planning final audit or marking any requirement covered without a source edit.
   - Ablation: steps 77, 115, 135 inferred the challenge path; acceptance green does not retroactively validate the trace’s reasoning.
   - Possible regression: may invite churn in already-correct paths and overfit self-authored tests.

**Uncertainty**

No measured improvement is claimed for either prompt change. The candidate passes acceptance; the trace review identifies evidence-quality gaps and underspecified semantics, not a demonstrated behavioral failure.
