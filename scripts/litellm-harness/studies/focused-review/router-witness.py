import json
from litellm import Router

def deployment(name,identity,**info):
 return {'model_name':name,'litellm_params':{'model':'openai/*' if name=='openai/*' else 'openai/gpt-4o','api_key':'offline','api_base':'https://example.invalid'},'model_info':{'id':identity,**info}}
rows=[]
for name,models,team,expected in [
 ('no-global-pattern-team-fallback',[deployment('team-pattern','team-wild',team_id='t1',team_public_model_name='openai/*')],'t1',['team-wild']),
 ('none-review-other-team-direct-name',[deployment('gpt-4o','other-team',team_id='other'),deployment('openai/*','global-wild')],'t1',['global-wild']),
 ('medium-review-named-team-shadows-global',[deployment('team-exact','named-team',team_id='t1',team_public_model_name='gpt-4o'),deployment('openai/*','global-wild')],'t1',['named-team']),
]:
 r=Router(model_list=models);patterns=r.pattern_router.get_deployments_by_pattern('gpt-4o')
 candidates=sorted(r.get_candidate_model_ids_for_route('gpt-4o',team_id=team))
 try:selected=r.get_available_deployment(model='gpt-4o',messages=[],request_kwargs={'metadata':{'user_api_key_team_id':team}})['model_info']['id']
 except Exception as error:selected=type(error).__name__+': '+str(error)[:180]
 rows.append({'case':name,'patternsType':type(patterns).__name__,'candidateIDs':candidates,'selected':selected,'claimExpectedIDs':expected,'pass':candidates==expected and selected in expected})
print(json.dumps(rows))
