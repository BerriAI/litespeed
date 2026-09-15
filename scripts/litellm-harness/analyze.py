"""Summarize every tool/message and usage receipt without publishing raw source traces."""
from collections import Counter
import json
import os
import re
from pathlib import Path

ROOT=Path(os.environ['LITELLM_CAMPAIGN_DIR'])
records=[]
for p in sorted((ROOT/'runs').glob('*/result.json')):
    result=json.loads(p.read_text());directory=p.parent
    record={k:result.get(k) for k in ['id','kind','label','seconds','status','exit','acceptance','timedOut','contextWindow','evaluationProtocol','effort','timeoutSeconds','isolation']}
    record['run']=directory.name
    task=json.loads((directory/'task.json').read_text()) if (directory/'task.json').exists() else {}
    record['promptRevision']=result.get('promptRevision',task.get('prompt_revision',1))
    record['snapshotRevision']=result.get('snapshotRevision',task.get('snapshot_revision',1))
    record['taskPrompt']=task.get('prompt') or (directory/'prompt.txt').read_text().split('\n\nImplement the fix in this checkout')[0]
    if (directory/'harness-source.json').exists():
        snapshot=json.loads((directory/'harness-source.json').read_text())
        record['harnessCommit']=snapshot['base']
        source=snapshot['files']['server/litellm-harness.ts']
        record['harnessSha256']=source['sha256']
        version=re.search(r"LITELLM_HARNESS_VERSION='([^']+)'",source['source'])
        record['harnessVersion']=version[1] if version else None
    if (directory/'messages.json').exists():
        archives=json.loads((directory/'archives.json').read_text()) if (directory/'archives.json').exists() else []
        record['compactions']=len(archives)
        raw=[m for archive in archives for m in archive['messages']]+json.loads((directory/'messages.json').read_text())
        unique={}
        for message in raw:
            key=(message['role'],message['createdAt'],message.get('toolCallId'),tuple(c['id'] for c in message.get('toolCalls',[])))
            unique[key]=message
        messages=sorted(unique.values(),key=lambda m:m['createdAt'])
        calls=list({c['id']:c for m in messages for c in m.get('toolCalls',[])}.values())
        usage=result.get('usage',{})
        record['reportedRequests']=usage.get('reportedRequests')
        units=[r['usage'] for r in usage.get('breakdown',[]) if r.get('usage')]
        record.update({'requests':usage.get('requests'),'inputTokens':(sum(x.get('inputTokens',0) for x in units) if units else None),'cachedTokens':(sum(x.get('cachedTokens',0) for x in units) if units else None),'outputTokens':(sum(x.get('outputTokens',0) for x in units) if units else None),'computedUsd':(sum((x.get('inputTokens',0)-x.get('cachedTokens',0))*0.22/1e6+x.get('cachedTokens',0)*0.007/1e6+x.get('outputTokens',0)*0.66/1e6 for x in units) if units else None),'toolCounts':dict(Counter(c['name'] for c in calls)),'toolErrors':[{k:c.get(k) for k in ['name','args','status','output']} for c in calls if c.get('status') in ['error','denied']],'checks':[{'command':c['execution']['command'],'exit':c['execution'].get('exitCode')} for c in calls if c.get('execution',{}).get('checkKey')],'readCharacters':sum(len(c.get('output') or '') for c in calls if c['name'] in ['read_file','grep','glob','litellm_context']),'toolOutputCharacters':sum(len(c.get('output') or '') for c in calls),'bashOutputCharacters':sum(len(c.get('output') or '') for c in calls if c['name'] in ['bash','bash_output']),'finalCharacters':len(result.get('final',''))})
        signatures=Counter((c['name'],json.dumps(c.get('args',{}),sort_keys=True)) for c in calls)
        record['exactRepeatedCalls']=sum(n-1 for n in signatures.values() if n>1)
        for step,m in enumerate([m for m in messages if m['role']=='assistant'],1):
            if any(c['name'] in ['write_file','edit_file'] or c.get('changes') for c in m.get('toolCalls',[])):
                record['firstEditRound']=step;break
        (directory/'trace-analysis.json').write_text(json.dumps(record,indent=2))
    elif (directory/'codex.jsonl').exists():
        events=[json.loads(line) for line in (directory/'codex.jsonl').read_text().splitlines()]
        usage=next((e.get('usage',{}) for e in reversed(events) if e.get('type')=='turn.completed'),{})
        record.update({'inputTokens':usage.get('input_tokens'),'cachedTokens':usage.get('cached_input_tokens'),'outputTokens':usage.get('output_tokens'),'computedUsd':None,'toolCounts':dict(Counter(e['item']['type'] for e in events if e.get('type')=='item.completed' and 'item' in e))})
    record['completed']=not bool(result.get('timedOut')) and (result.get('exit')==0 if result['kind']=='codex' else result.get('status')=='idle')
    records.append(record)
(ROOT/'analysis.json').write_text(json.dumps(records,indent=2))
for r in records:
    print(json.dumps({k:r.get(k) for k in ['run','seconds','requests','firstEditRound','computedUsd','acceptance']}))
