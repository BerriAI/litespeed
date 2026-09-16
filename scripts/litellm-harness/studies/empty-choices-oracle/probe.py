import asyncio, copy, json, uuid
from datetime import datetime
from litellm import ModelResponse
from litellm.exceptions import APIError
from litellm.litellm_core_utils.llm_response_utils.convert_dict_to_response import convert_to_model_response_object, convert_to_streaming_response, convert_to_streaming_response_async
from litellm.litellm_core_utils.streaming_handler import CustomStreamWrapper
from litellm.litellm_core_utils.litellm_logging import Logging

BASE={"id":"usage-only","created":1,"model":"gpt-4o","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":0,"total_tokens":4}}
async def convert(kind, payload):
    if kind == "normal": return [convert_to_model_response_object(response_object=payload, model_response_object=ModelResponse(), response_type="completion")]
    if kind == "sync": return list(convert_to_streaming_response(response_object=payload))
    return [c async for c in convert_to_streaming_response_async(response_object=payload)]

def logging():
    return Logging(litellm_call_id=str(uuid.uuid4()),call_type="completion",model="gpt-4o",messages=[],function_id=str(uuid.uuid4()),stream=True,start_time=datetime.now())

async def main():
    rows=[]
    for kind in ["normal","sync","async"]:
        for case,value in [("empty",[]),("missing",None),("NoneType",None),("dict",{}),("str",""),("int",0)]:
            payload=copy.deepcopy(BASE)
            if case=="missing": payload.pop("choices")
            else: payload["choices"]=value
            try:
                chunks=await convert(kind,payload)
                ok=case=="empty" and len(chunks)==1 and chunks[0].choices==[] and getattr(chunks[0],"usage",None).prompt_tokens==4
                rows.append({"name":f"{kind}:{case}","pass":bool(ok),"choices":[len(c.choices) for c in chunks]})
            except Exception as exc:
                message=str(exc)
                ok=case!="empty" and isinstance(exc,APIError) and "choices" in message and (case=="missing" or case in message)
                rows.append({"name":f"{kind}:{case}","pass":bool(ok),"errorType":type(exc).__name__,"diagnosticNamesChoicesAndType":bool(ok)})
    for kind in ["sync","async"]:
        for include_usage in [False,True]:
            stream=convert_to_streaming_response(response_object=copy.deepcopy(BASE)) if kind=="sync" else convert_to_streaming_response_async(response_object=copy.deepcopy(BASE))
            wrapper=CustomStreamWrapper(completion_stream=stream,model="gpt-4o",logging_obj=logging(),custom_llm_provider="cached_response",stream_options={"include_usage":True} if include_usage else None)
            try:
                chunks=list(wrapper) if kind=="sync" else [c async for c in wrapper]
                usage_preserved=any(getattr(getattr(c,"usage",None),"prompt_tokens",None)==4 for c in chunks)
                rows.append({"name":f"wrapper:{kind}:include_usage={include_usage}","pass":bool(not include_usage or usage_preserved),"returned":[{"choiceCount":len(c.choices),"finishReasons":[x.finish_reason for x in c.choices],"deltaContents":[getattr(getattr(x,"delta",None),"content",None) for x in c.choices],"usagePromptTokens":getattr(getattr(c,"usage",None),"prompt_tokens",None)} for c in chunks]})
            except Exception as exc:rows.append({"name":f"wrapper:{kind}:include_usage={include_usage}","pass":False,"errorType":type(exc).__name__})
    print(json.dumps(rows))
asyncio.run(main())
