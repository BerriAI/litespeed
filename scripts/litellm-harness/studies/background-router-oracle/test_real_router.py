from pathlib import Path
import importlib.util
import pytest

@pytest.mark.asyncio
async def test_background_retrieval_with_real_router(monkeypatch):
    source=Path.cwd()/'tests/test_litellm/proxy/test_common_request_processing.py'
    spec=importlib.util.spec_from_file_location('captured_background_tests',source)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    case=module.TestBackgroundResponseRetrievalGovernance()
    from litellm import Router
    def real_router():
        return Router(model_list=[{'model_name':case.GOVERNED_MODEL_GROUP,'litellm_params':{'model':'openai/gpt-4','api_key':'offline-placeholder'},'model_info':{'id':case.GOVERNED_MODEL_ID}}])
    monkeypatch.setattr(case,'_router',real_router)
    fixture=case.policy_engine.__wrapped__(case)
    next(fixture)
    try:
        await case.test_retrieving_a_background_response_attaches_its_model_post_call_pipeline(None,monkeypatch)
    finally:
        next(fixture,None)
