"""Observe tag values and order without an order-sensitive STS denial mock."""
import datetime
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch
from litellm.llms.bedrock.base_aws_llm import BaseAWSLLM

TAGS=({'Key':'team','Value':'genai'},{'Key':'env','Value':'prod'})
ROLE='arn:aws:iam::123456789012:role/TaggedRole'

class STS:
    def __init__(self):self.calls=[]
    def get_caller_identity(self):return {'Arn':'arn:aws:iam::111111111111:user/unused-offline-user'}
    def assume_role_with_web_identity(self,**params):return self.credentials('IRSA-OFFLINE')
    def assume_role(self,**params):self.calls.append(params);return self.credentials('TAGGED-OFFLINE')
    def credentials(self,key):
        return {'Credentials':{'AccessKeyId':key,'SecretAccessKey':'offline-placeholder','SessionToken':'offline-placeholder','Expiration':datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=1)}}

rows=[]
for name,irsa,external in [('direct',None,None),('external-id',None,'external'),('cross-account','arn:aws:iam::111111111111:role/eks',None),('same-account',ROLE,None)]:
    sts=STS()
    with tempfile.TemporaryDirectory() as tmp:
        token=Path(tmp)/'token';token.write_text('offline-token')
        env={k:v for k,v in os.environ.items() if not k.startswith('AWS_')}
        env['AWS_REGION']='us-east-1'
        if irsa:env.update(AWS_WEB_IDENTITY_TOKEN_FILE=str(token),AWS_ROLE_ARN=irsa)
        try:
            with patch.dict(os.environ,env,clear=True),patch('boto3.client',return_value=sts):
                credentials,_=BaseAWSLLM()._auth_with_aws_role(aws_access_key_id=None,aws_secret_access_key=None,aws_session_token=None,aws_role_name=ROLE,aws_session_name='offline-session',aws_external_id=external,aws_session_tags=list(TAGS))
            sent=sts.calls[0].get('Tags') if len(sts.calls)==1 else None
            values=sorted(sent,key=lambda x:x['Key']) if isinstance(sent,(tuple,list)) else []
            preserved=values==sorted(TAGS,key=lambda x:x['Key'])
            rows.append({'case':name,'pass':preserved and credentials.access_key=='TAGGED-OFFLINE' and (not external or sts.calls[0].get('ExternalId')==external),'tagValuesPreserved':preserved,'tupleShape':isinstance(sent,tuple),'keysInSentOrder':[x['Key'] for x in sent] if sent else [],'sortedByKey':bool(sent) and list(sent)==values})
        except Exception as error:
            rows.append({'case':name,'pass':False,'errorType':type(error).__name__,'error':str(error)[:200]})
print(json.dumps(rows))
