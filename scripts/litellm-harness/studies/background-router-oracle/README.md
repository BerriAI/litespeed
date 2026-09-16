# Background retrieval: router test-double coupling

The first High-reasoning training replay finished with **6/7 original acceptance checks**. Its one failure did not establish the missing retrieval behavior claimed by that raw score.

The human test supplies a `MagicMock` configured only for `get_deployment(model_id)`. The candidate calls the existing `get_model_info(id=...)` method, which also returns the deployment and model-group name on the real router. That method was left unconfigured by the test double. The candidate receives a mock instead of a dictionary and returns without attaching the policy.

The retained diagnostic changes only that router fixture to an actual `Router`, then executes the original retrieval test and assertions through the existing request-processing entrypoint:

| Snapshot | Same retrieval assertion, real router |
|---|---|
| Starting source | Fails |
| Human reference | Passes |
| High-reasoning candidate `4c64c9b6` | Passes |

The [qualification record](qualification.json) identifies exact source revisions and probe hash. The [probe](test_real_router.py) runs with the public `offline-pytest.py` wrapper on a full source snapshot containing the recorded reference test file. That wrapper disables network and adjacent bytecode and asserts every imported LiteLLM module comes from that snapshot.

**Original scores and frozen study inputs remain unchanged.** This posthoc diagnostic establishes the observed mock coupling for this candidate and this assertion; it does not establish that every candidate implements every untested retrieval condition correctly. Future study interpretation must report both the raw oracle result and any qualified real-router diagnostic, rather than prescribing `get_deployment` as a harness lesson solely to satisfy the mock.

## Follow-up: request test-double shape

The Medium-reasoning attempt `17f57e85` also had a 6/7 raw score, but replacing only the router mock still failed. Its patch chose the metadata field through the existing request-route helper. The human test left both the request's ASGI scope and URL path unconfigured, so the mocked route did not identify a Responses endpoint.

A [second diagnostic](test_real_router_and_request.py) adds a concrete GET `/v1/responses/{id}` scope and URL to the request double, together with the real Router; it keeps the original entrypoint and assertions. The starting code fails, the human reference passes, and all three inspected candidate patches pass (High `4c64c9b6`, Medium `17f57e85`, grouped edits `3080a797`). [Recorded outcomes](request-path-diagnostic.json).

**The Medium attempt still timed out at 900 seconds and does not count as a completed solution.** Neither diagnostic upgrades its completion status or changes the original 6/7 score. These checks demonstrate how two different incomplete test doubles can reject valid implementation choices; they do not certify the rest of an unfinished patch.

A later grouped-edit study control (`8c4360a4`) also finished normally at 6/7. A real router alone did not resolve its failure, because this candidate chose the metadata field through the request-route helper. The combined real-router/concrete-request diagnostic passes. This prevents interpreting the grouped-edit candidate's original 7/7 versus this control's 6/7 as a demonstrated behavioral advantage; original scores and study criteria remain unchanged.

## Follow-up: testing the full processing entrypoint

The second grouped-edit candidate (`d25104ed`, normal completion at 781.14 seconds) also scores 6/7. Both the original test and the real-router/concrete-request variant fail. This time the reason is placement: those tests stop at `common_processing_pre_call_logic`, while this patch attaches policies immediately afterward inside `_process_llm_request`. The real `aget_responses` endpoint calls `base_process_llm_request`, which traverses both stages before provider dispatch. The task requires attachment after the pre-call hook; it does not require one particular internal helper to perform it.

The [outer-entrypoint probe](test_outer_retrieval.py) preserves real pre-call decoding, router lookup and policy matching, then stops at the upstream-provider boundary. It asserts that retrieval has the model policy attached after the response ID changes, keeps the retrieval's model field unchanged, and excludes submission. [Qualification](outer-retrieval-diagnostic.json) gives base 1/2 (retrieval fails), reference 2/2, and this candidate 2/2, with snapshot imports checked. The original 6/7 remains unchanged.

This is another reason to distinguish a failing test from a demonstrated user-facing regression. Replacing test doubles with real dependencies helps, but a test can still require the change at a particular internal stage. The outer probe verifies these two attachment conditions only; it does not certify downstream execution or all untested behavior.
