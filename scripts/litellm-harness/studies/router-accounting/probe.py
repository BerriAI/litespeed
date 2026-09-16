"""Offline entrypoint/callback diagnostic; no new private helper names required."""
import asyncio
import json
from unittest.mock import patch
import litellm
from litellm import Router
from litellm.router_strategy.lowest_tpm_rpm_v2 import LowestTPMLoggingHandler_v2 as Selector


def router(default=False, pass_through=False):
    litellm.callbacks = []
    litellm.input_callback = []
    return Router(model_list=[{
        'model_name': 'group',
        'litellm_params': {'model': 'openai/gpt-4o', 'api_key': 'offline',
                          'api_base': 'https://example.invalid', 'rpm': 100,
                          **({'use_in_pass_through': True} if pass_through else {})},
        'model_info': {'id': 'deployment'},
    }], routing_strategy='usage-based-routing-v2' if default else 'simple-shuffle', num_retries=0)


def scenario(asynchronous=False, model='group', default=False, pass_through=False):
    r=router(default,pass_through);counts={'sync':0,'async':0}
    original_sync,original_async=Selector.pre_call_check,Selector.async_pre_call_check
    def counted_sync(self,*args,**kwargs):
        counts['sync']+=1
        return original_sync(self,*args,**kwargs)
    async def counted_async(self,*args,**kwargs):
        counts['async']+=1
        return await original_async(self,*args,**kwargs)
    def assert_count(expected):
        assert sum(counts.values())==expected,f'Expected {expected} pre-call checks; observed {counts}'
    def assert_isolated():
        assert not any(isinstance(c,Selector) for c in litellm.callbacks),'Override selector leaked into callbacks'
        assert not any(isinstance(c,Selector) for c in litellm.input_callback),'Override selector leaked into input_callback'
    def kwargs(override):
        options={'routing_strategy':'usage-based-routing-v2'} if override else {}
        if pass_through:return {'model':model,'request_kwargs':options}
        return {'model':model,'messages':[{'role':'user','content':'hi'}],'mock_response':'ok',**options}
    def check_result(result):
        assert (result['model_info']['id']=='deployment') if pass_through else (result.choices[0].message.content=='ok')
    def sync():
        call=r.get_available_deployment_for_pass_through if pass_through else r.completion
        check_result(call(**kwargs(not default)));assert_count(1)
        if not default:
            assert_isolated()
            check_result(call(**kwargs(False)));check_result(call(**kwargs(False)));assert_count(1)
        check_result(call(**kwargs(not default)));assert_count(2)
    async def async_():
        call=r.async_get_available_deployment_for_pass_through if pass_through else r.acompletion
        check_result(await call(**kwargs(not default)));assert_count(1)
        if not default:
            assert_isolated()
            check_result(await call(**kwargs(False)));check_result(await call(**kwargs(False)));assert_count(1)
        check_result(await call(**kwargs(not default)));assert_count(2)
    with patch.object(Selector,'pre_call_check',counted_sync),patch.object(Selector,'async_pre_call_check',counted_async):
        if asynchronous:asyncio.run(async_())
        else:sync()
    return counts


rows=[]
for name,args in [
    ('sync-group-override',{}),
    ('async-group-override',{'asynchronous':True}),
    ('sync-deployment-override',{'model':'deployment'}),
    ('async-deployment-override',{'asynchronous':True,'model':'deployment'}),
    ('sync-default-accounting',{'default':True}),
    ('async-default-accounting',{'asynchronous':True,'default':True}),
    ('sync-pass-through-override',{'pass_through':True,'model':'deployment'}),
    ('async-pass-through-override',{'asynchronous':True,'pass_through':True,'model':'deployment'}),
]:
    try:
        counts=scenario(**args);rows.append({'case':name,'pass':True,'preCallCounts':counts})
    except Exception as error:
        rows.append({'case':name,'pass':False,'errorType':type(error).__name__,'error':str(error)[:300]})
print(json.dumps(rows))
