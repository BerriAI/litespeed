import datetime,json
from unittest.mock import MagicMock
import litellm
from litellm.integrations.langfuse.langfuse import LangFuseLogger
rows=[]
for level in ['DEFAULT','ERROR']:
 for session,extra,expected in [('trace-alpha',{},'call-unique'),('session-beta',{},'trace-alpha'),('session-beta',{'langfuse_session_id':'session-beta'},'call-unique')]:
  logger=LangFuseLogger.__new__(LangFuseLogger);logger.Langfuse=MagicMock();logger.langfuse_sdk_version='2.60.0'
  now=datetime.datetime.now()
  result=logger.log_event_on_langfuse(kwargs={'call_type':'completion','litellm_call_id':'call-unique','litellm_trace_id':'trace-alpha','litellm_params':{'metadata':{'session_id':session},'proxy_server_request':{'headers':{'x-litellm-session-id':'trace-alpha',**extra}}},'messages':[{'role':'user','content':'hello'}],'optional_params':{}},response_obj=None if level=='ERROR' else litellm.ModelResponse(choices=[{'message':{'role':'assistant','content':'ok'}}]),start_time=now,end_time=now,level=level,status_message='provider error' if level=='ERROR' else None)
  sent=logger.Langfuse.trace.call_args.kwargs['id'];returned=result['trace_id']
  rows.append({'level':level,'session':session,'headers':extra,'expected':expected,'used':sent,'returned':returned,'pass':sent==returned==expected})
print(json.dumps(rows))
