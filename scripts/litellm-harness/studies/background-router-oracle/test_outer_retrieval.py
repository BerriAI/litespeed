"""Posthoc attachment probe through the full request-processing entrypoint.

Only the upstream boundary is stopped. Pre-call decoding, router lookup and
policy matching are real. This permits attachment either inside common pre-call
logic or immediately afterward, before provider dispatch.
"""
import importlib.util
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import Request, Response


class ReachedProviderBoundary(BaseException):
    pass


@pytest.mark.asyncio
@pytest.mark.parametrize("route_type", ["aget_responses", "aresponses"])
async def test_policy_attachment_before_provider_dispatch(monkeypatch, route_type):
    import litellm
    from litellm.proxy import common_request_processing as processing
    from litellm.proxy._types import UserAPIKeyAuth
    from litellm.proxy.proxy_server import ProxyConfig
    from litellm.proxy.utils import ProxyLogging
    from litellm.responses.utils import ResponsesAPIRequestUtils

    source = Path.cwd() / "tests/test_litellm/proxy/test_common_request_processing.py"
    spec = importlib.util.spec_from_file_location("captured_background_outer", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    case = module.TestBackgroundResponseRetrievalGovernance()
    fixture = case.policy_engine.__wrapped__(case)
    next(fixture)
    try:
        router = litellm.Router(model_list=[{"model_name": case.GOVERNED_MODEL_GROUP,
            "litellm_params": {"model": "openai/gpt-4", "api_key": "offline-placeholder"},
            "model_info": {"id": case.GOVERNED_MODEL_ID}}])
        encoded = ResponsesAPIRequestUtils._build_responses_api_response_id(
            custom_llm_provider="openai", model_id=case.GOVERNED_MODEL_ID, response_id="resp_upstream")
        processor = processing.ProxyBaseLLMRequestProcessing(data={"response_id": "resp_opaque", "litellm_metadata": {}})
        request = Request(scope={"type": "http", "method": "GET", "path": "/v1/responses/resp_opaque", "root_path": "", "headers": []})
        proxy_logging = MagicMock(spec=ProxyLogging)
        proxy_logging.during_call_hook = AsyncMock(return_value=None)
        proxy_config = MagicMock(spec=ProxyConfig)
        proxy_config._get_hierarchical_router_settings = AsyncMock(return_value=None)
        decoded = []
        captured = []

        async def add_request_data(data, **kwargs):
            return data

        async def decode(user_api_key_dict, data, call_type):
            decoded.append(data["response_id"])
            data["response_id"] = encoded
            return data

        async def stop_at_provider(**kwargs):
            captured.append(kwargs["data"])
            raise ReachedProviderBoundary()

        proxy_logging.pre_call_hook = AsyncMock(side_effect=decode)
        monkeypatch.setattr(processing, "add_litellm_data_to_request", add_request_data)
        monkeypatch.setattr(processing, "route_request", stop_at_provider)
        with pytest.raises(ReachedProviderBoundary):
            await processor.base_process_llm_request(request=request, fastapi_response=Response(),
                user_api_key_dict=UserAPIKeyAuth(), route_type=route_type,
                proxy_logging_obj=proxy_logging, general_settings={}, proxy_config=proxy_config, llm_router=router)
        assert decoded == ["resp_opaque"]
        assert len(captured) == 1
        data = captured[0]
        assert data["response_id"] == encoded
        assert data.get("model") is None
        metadata = data["litellm_metadata"]
        if route_type == "aget_responses":
            pipelines = metadata["_guardrail_pipelines"]
            assert [(name, [step.guardrail for step in pipeline.steps]) for name, pipeline in pipelines] == [
                ("response-governance", ["output-word-filter"])]
            assert metadata["applied_policies"] == ["response-governance"]
        else:
            assert "_guardrail_pipelines" not in metadata
            assert "applied_policies" not in metadata
    finally:
        next(fixture, None)
