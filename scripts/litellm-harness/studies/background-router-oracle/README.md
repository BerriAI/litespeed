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
