import datetime,json
from unittest.mock import MagicMock
import litellm
from litellm.integrations.langfuse.langfuse import LangFuseLogger
rows=[]
for level in ['DEFAULT','ERROR']:
 logger=LangFuseLogger.__new__(LangFuseLogger);logger.Langfuse=MagicMock();logger.langfuse_sdk_version='2.60.0';now=datetime.datetime.now()
 result=logger.log_event_on_langfuse(kwargs={'call_type':'completion','litellm_call_id':'c1','litellm_trace_id':'sess-abcdef','litellm_params':{'metadata':{},'proxy_server_request':{'headers':{'x-litellm-session-id':'sess-abcdef','langfuse_session_id':'other-session'}}},'messages':[{'role':'user','content':'hello'}],'optional_params':{}},response_obj=None if level=='ERROR' else litellm.ModelResponse(choices=[{'message':{'role':'assistant','content':'ok'}}]),start_time=now,end_time=now,level=level,status_message='provider error' if level=='ERROR' else None)
 sent=logger.Langfuse.trace.call_args.kwargs['id'];returned=result['trace_id'];session=logger.Langfuse.trace.call_args.kwargs.get('session_id');rows.append({'level':level,'used':sent,'returned':returned,'session':session,'pass':sent==returned=='c1' and session=='other-session'})
print(json.dumps(rows))
