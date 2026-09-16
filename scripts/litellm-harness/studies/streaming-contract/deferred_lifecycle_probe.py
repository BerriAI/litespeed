import asyncio, datetime, json
import litellm
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm.litellm_core_utils.litellm_logging import Logging
from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.common_utils.user_api_key_cache import UserApiKeyCache
from litellm.proxy.utils import ProxyLogging
from litellm.proxy.common_request_processing import ProxyBaseLLMRequestProcessing
from litellm.types.proxy.policy_engine.pipeline_types import GuardrailPipeline,PipelineStep
from litellm.types.utils import ModelResponseStream,ModelResponse
import litellm.proxy.proxy_server as server

class NativeHook(CustomGuardrail):
    use_native_lifecycle_hooks=True
    def __init__(self,name):
        super().__init__(guardrail_name=name,event_hook="post_call",default_on=True)
        self.calls=0
    async def apply_guardrail(self,inputs,request_data,input_type,logging_obj=None):
        raise AssertionError("Native lifecycle must not use unified hook")
    async def async_post_call_success_hook(self,data,user_api_key_dict,response):
        self.calls+=1
        return response

async def stream():
    yield ModelResponseStream(id="probe",model="offline-model",created=1,choices=[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":None}])
    yield ModelResponseStream(id="probe",model="offline-model",created=1,choices=[{"index":0,"delta":{"content":""},"finish_reason":"stop"}])

async def main():
    server.llm_router=None
    managed,other=NativeHook("managed"),NativeHook("other")
    litellm.callbacks=[managed,other]
    log=Logging(model="offline-model",messages=[{"role":"user","content":"hi"}],stream=True,call_type="acompletion",start_time=datetime.datetime.now(),litellm_call_id="probe",function_id="probe")
    auth=UserAPIKeyAuth(api_key="offline-probe",request_route="/v1/chat/completions")
    pipeline=GuardrailPipeline(mode="post_call",steps=[PipelineStep(guardrail="managed",on_pass="allow",on_fail="block")])
    data={"model":"offline-model","stream":True,"messages":[{"role":"user","content":"hi"}],"metadata":{"_guardrail_pipelines":[("probe-policy",pipeline)]},"litellm_logging_obj":log}
    proxy=ProxyLogging(user_api_key_cache=UserApiKeyCache())
    delivered=[part async for part in proxy.async_post_call_streaming_iterator_hook(user_api_key_dict=auth,response=stream(),request_data=data)]
    during=(managed.calls,other.calls)
    await ProxyBaseLLMRequestProcessing._run_deferred_stream_guardrails(captured_data=data,captured_user_api_key_dict=auth,captured_logging_obj=log,assembled_response=ModelResponse(choices=[{"message":{"role":"assistant","content":"hello"}}]),cache_hit=False)
    after=(managed.calls,other.calls)
    print(json.dumps([{"name":"pipeline-hook-executes-once-before-delivery","pass":during[0]==1 and after[0]==1,"during":during[0],"after":after[0],"deliveredChunks":len(delivered)},{"name":"unmanaged-hook-still-runs-deferred","pass":during[1]==0 and after[1]==1,"during":during[1],"after":after[1]}]))
asyncio.run(main())
