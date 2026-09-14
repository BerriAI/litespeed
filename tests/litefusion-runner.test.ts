import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { LITEFUSION_ROLES, liteFusionLeadPrompt, type LiteFusionSelection } from '../shared/litefusion.js';
import { handoffFiles } from '../server/litefusion-handoffs.js';
import { scopeExternalLease } from '../server/external.js';
import { logicalWorkers, workerLabels } from '../shared/worker-presentation.js';
import { captureLiteFusion, resolveLiteFusion } from '../server/litefusion-routing.js';
import { ModelCatalogCache } from '../server/budget.js';

const listen=(server:Server)=>new Promise<string>(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${(server.address() as {port:number}).port}`)));
const close=(server:Server)=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
const reply=(res:ServerResponse,content='Done')=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);};
const calls=(res:ServerResponse,list:Array<{name:string;args:Record<string,unknown>}>)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{tool_calls:list.map((call,index)=>({index,id:`call-${index}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}))},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);};
const selection:LiteFusionSelection={kind:'litefusion',gatewayProviderId:'fixture',bindings:{glm:{providerId:'fixture',model:'cheap'},gemini:{providerId:'fixture',model:'coder'},astra:{providerId:'fixture',model:'strong'},luna:{providerId:'fixture',model:'reader'},kimi:{providerId:'fixture',model:'research'}}};
const assignment=(extra:Record<string,unknown>={})=>({roleId:'bounded_patch',workstream:'feature',description:'Implement the note',prompt:'Write note.txt and report the observed result.',reason:'Bounded change with exact output.',acceptance:['note.txt contains working'],constraints:[],files:['note.txt'],evidence:[],...extra});

describe('LiteFusion task runtime',()=>{
  let directory:string,store:Store,server:Server,provider:Server,url:string,runner:ReturnType<typeof createApp>['runner'];
  let requests:any[],respond:(body:any,res:ServerResponse)=>void;
  const api=async(path:string,body?:unknown)=>{const response=await fetch(url+'/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,body:await response.json()};};
  const create=async(extra:Record<string,unknown>={})=>{const result=await api('/sessions',{permissionMode:'auto',architecture:selection,...extra});expect(result.status).toBe(201);return result.body;};
  beforeEach(async()=>{
    directory=await realpath(await mkdtemp(join(tmpdir(),'litefusion-test-')));store=new Store(join(directory,'state'));requests=[];
    respond=(body,res)=>body.model==='lead'?(body.messages.some((m:any)=>m.role==='tool')?reply(res):calls(res,[{name:'delegate',args:assignment()},{name:'wait_tasks',args:{}}])):body.messages.at(-1)?.role==='tool'?reply(res,'Wrote note.txt; inspect the result.'):calls(res,[{name:'write_file',args:{path:'note.txt',content:'working'}}]);
    provider=createServer(async(req,res)=>{if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[]}));return;}const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);if(body.model==='lead'&&store.sessions().some(session=>runner?.active(session.id)&&runner.tasks.list(session.id).some(task=>task.status==='queued'||task.status==='running'))){calls(res,[{name:'wait_tasks',args:{}}]);return;}respond(body,res);});
    const baseUrl=await listen(provider);store.saveSettings({workspace:directory,providers:[{id:'fixture',name:'Local fixture',kind:'openai',baseUrl}],defaultProvider:'fixture',defaultModel:'lead',memoryEnabled:false});
    const app=createApp({store});runner=app.runner;server=createServer(app.app);url=await listen(server);
  });
  afterEach(async()=>{runner.stopAll();await runner.whenIdle();await close(server);await close(provider);store.close();await rm(directory,{recursive:true,force:true});});

  it('dispatches the catalog route and native effort, preserves requirements, and records unresolved acceptance',async()=>{
    const session=await create();runner.start(session.id,'Write the note. Preserve the public API.');await runner.whenIdle();
    expect(await readFile(join(directory,'note.txt'),'utf8')).toBe('working');
    const worker=requests.find(body=>body.model==='cheap');expect(worker.reasoning_effort).toBe('max');
    expect(JSON.stringify(worker.messages)).toContain('Preserve the public API.');
    const names=worker.tools.map((tool:any)=>tool.function.name);expect(names).toContain('worker_request');expect(names).not.toContain('delegate');expect(names).not.toContain('ask_user');
    expect(requests[0].tools.map((tool:any)=>tool.function.name)).toContain('write_file');
    const [task]=runner.delegations.list(session.id);expect(task).toMatchObject({status:'completed',model:'cheap',reasoningEffort:'max',litefusion:{roleId:'bounded_patch',tier:'default',reason:'default',contextReused:false,acceptance:'unresolved',verification:'needs_review'}});
    expect(task.recentActivity?.[0]).toContain('write_file');
    const exported=await api(`/sessions/${session.id}/litefusion/export`);expect(exported.body.turns[0].evaluation.success).toBeNull();expect(exported.body.turns[0].usage.cost).toBeUndefined();
    for(const role of LITEFUSION_ROLES)expect(JSON.stringify(requests[0].messages)).toContain(role.id);
  });
  it('rejects invalid native effort as a client error before any inference',async()=>{
    const invalid={...selection,routes:{bounded_patch:{default:{modelKey:'glm',effort:'invented'}}}};
    expect((await api('/litefusion/routes',invalid)).status).toBe(400);
    expect((await api('/sessions',{architecture:invalid})).status).toBe(400);
    expect(requests).toHaveLength(0);
  });
  it('does not let stopping a settled attempt abort its active reused context',async()=>{
    let id='',held:ServerResponse|undefined,workerCalls=0;
    respond=(body,res)=>{
      if(body.model!=='lead'){if(++workerCalls===1)reply(res,'First result.');else held=res;return;}
      const tasks=id?runner.delegations.list(id):[];
      if(!tasks.length)calls(res,[{name:'delegate',args:assignment()}]);
      else if(tasks.length===1)calls(res,[{name:'delegate',args:assignment({continueFrom:tasks[0].id})}]);
      else reply(res);
    };
    const session=await create();id=session.id;runner.start(id,'Implement and follow up.');
    const deadline=Date.now()+5000;while(!held){if(Date.now()>deadline)throw new Error('Continuation never started');await new Promise(resolve=>setTimeout(resolve,5));}
    const [first,second]=runner.delegations.list(id);expect(second.childSessionId).toBe(first.childSessionId);
    await runner.cancelDelegation(id,first.id);
    expect(runner.delegations.get(id,second.id).status).toBe('running');
    reply(held,'Continuation finished.');await runner.whenIdle();
    expect(runner.delegations.get(id,second.id).status).toBe('completed');
    expect(runner.delegations.get(id,first.id).status).toBe('completed');
  });
  it('keeps external evaluator labels separate and append-only, including unknown outcomes',async()=>{
    const session=await create();runner.start(session.id,'Write the note.');await runner.whenIdle();
    const turn=store.messages(session.id).find(m=>m.role==='user')!.id;
    expect((await api(`/sessions/${session.id}/litefusion/evaluations`,{turnId:turn,success:false,source:'Fixture evaluator'})).status).toBe(201);
    expect((await api(`/sessions/${session.id}/litefusion/evaluations`,{turnId:turn,success:null,source:'Fixture evaluator',notes:'Awaiting independent rerun'})).status).toBe(201);
    const exported=(await api(`/sessions/${session.id}/litefusion/export`)).body;
    expect(exported.turns[0].evaluations).toHaveLength(2);expect(exported.turns[0].evaluation.success).toBeNull();
    expect(exported.assignments[0].litefusion.acceptance).toBe('unresolved');
    expect((await api(`/sessions/${session.id}/litefusion/evaluations`,{turnId:'foreign-turn',success:true,source:'Fixture evaluator'})).status).toBe(404);
  });
  it('reserves all requests conservatively and leaves the rescue reserve for the lead',async()=>{
    const session=await create({architecture:{...selection,spend:{limitUsd:3,rescueReserveUsd:1,requestCeilings:[{providerId:'fixture',model:'lead',usd:1},{providerId:'fixture',model:'cheap',usd:1}]}}});
    runner.start(session.id,'Write the note.');await runner.whenIdle();
    // The worker's second request cannot consume the lead's reserved dollar.
    expect(requests.filter(body=>body.model==='cheap')).toHaveLength(1);
    const [task]=runner.delegations.list(session.id);expect(task.status).toBe('failed');expect(task.error).toContain('budget exhausted');
    const ledger=(await api(`/sessions/${session.id}/litefusion/export`)).body.turns[0].usage;
    expect(ledger.breakdown.reduce((sum:number,item:any)=>sum+item.reservedUsd,0)).toBe(3);expect(ledger.cost).toBeUndefined();
  });
  it('blocks unpriced requests under a configured budget before provider dispatch',async()=>{
    const session=await create({architecture:{...selection,spend:{limitUsd:10,rescueReserveUsd:1,requestCeilings:[{providerId:'fixture',model:'lead',usd:1}]}}});
    runner.start(session.id,'Write the note.');await runner.whenIdle();
    expect(requests.some(body=>body.model==='cheap')).toBe(false);expect(runner.delegations.list(session.id)[0].error).toContain('unpriced');
  });
  it('allows direct lead work without manufacturing a worker',async()=>{
    respond=(_body,res)=>reply(res,'The existing API uses milliseconds.');
    const session=await create();runner.start(session.id,'Explain the API unit.');await runner.whenIdle();
    expect(requests).toHaveLength(1);expect(runner.delegations.list(session.id)).toHaveLength(0);
  });
  it('keeps Plan-mode workers read-only even when the lead tries to request implementation',async()=>{
    const session=await create({mode:'plan'});runner.start(session.id,'Plan the change.');await runner.whenIdle();
    expect(requests.some(body=>body.model==='cheap')).toBe(false);
    expect(store.messages(session.id).some(m=>m.role==='tool'&&m.content.includes('Plan mode'))).toBe(true);
  });
  it('rejects references to another session before invoking a worker',async()=>{
    const other=await create();runner.start(other.id,'Write the note.');await runner.whenIdle();const foreign=runner.delegations.list(other.id)[0];requests=[];
    respond=(body,res)=>body.messages.at(-1)?.role==='tool'?reply(res):calls(res,[{name:'delegate',args:assignment({continueFrom:foreign.id})}]);
    const session=await create();runner.start(session.id,'Continue the task.');await runner.whenIdle();
    expect(runner.delegations.list(session.id)).toHaveLength(0);expect(requests.every(body=>body.model==='lead')).toBe(true);
  });
  it('passes a configured handoff to both lead and worker at the accepted version',async()=>{
    const session=await create({architecture:{...selection,handoffs:{bounded_patch:{instructions:'Retain the exact wire protocol.',acceptance:'Observe a client-server round trip.'}}}});runner.start(session.id,'Make the change.');await runner.whenIdle();
    expect(JSON.stringify(requests[0].messages)).toContain('Retain the exact wire protocol.');expect(JSON.stringify(requests.find(body=>body.model==='cheap').messages)).toContain('Observe a client-server round trip.');
  });
  it('starts a hard task on the same route used by an escalation',async()=>{
    respond=(body,res)=>body.model==='lead'?(body.messages.at(-1)?.role==='tool'?reply(res):calls(res,[{name:'delegate',args:assignment({hard:true})}])):reply(res,'Observed the task.');
    const session=await create();runner.start(session.id,'Do the hard task.');await runner.whenIdle();
    expect(requests.some(body=>body.model==='cheap')).toBe(false);expect(requests.find(body=>body.model==='coder').reasoning_effort).toBe('high');
    expect(runner.delegations.list(session.id)[0].litefusion).toMatchObject({reason:'hard',tier:'escalation'});
  });
  it('continues an escalated worker on its actual route and preserves the original requested route',async()=>{
    let id='';respond=(body,res)=>{
      if(body.model!=='lead'){reply(res,'Result with evidence.');return;}
      const tasks=id?runner.delegations.list(id):[];
      if(!tasks.length)calls(res,[{name:'delegate',args:assignment({hard:true})}]);
      else if(tasks.length===1)calls(res,[{name:'delegate',args:assignment({continueFrom:tasks[0].id})}]);else reply(res);
    };
    const session=await create();id=session.id;runner.start(id,'Implement the hard task and check the result.');await runner.whenIdle();
    const [first,second]=runner.delegations.list(id);expect(second.childSessionId).toBe(first.childSessionId);
    expect(second.litefusion).toMatchObject({requested:first.litefusion!.requested,tier:'escalation',resolved:{model:'coder'},effort:'high',contextReused:true});
  });
  it('rejects relabeling a continuation as a different task',async()=>{
    let id='';respond=(body,res)=>{
      if(body.model!=='lead'){reply(res,'Patch report.');return;}
      if(!body.messages.some((m:any)=>m.role==='tool'))calls(res,[{name:'delegate',args:assignment()}]);
      else if(!body.messages.some((m:any)=>m.role==='tool'&&m.content.includes('retain the original role')))calls(res,[{name:'delegate',args:assignment({roleId:'doc_lookup',continueFrom:runner.delegations.list(id)[0].id})}]);else reply(res);
    };
    const session=await create();id=session.id;runner.start(id,'Implement.');await runner.whenIdle();
    expect(runner.delegations.list(id)).toHaveLength(1);expect(requests.some(body=>body.model==='research')).toBe(false);
    expect(store.messages(id).flatMap(m=>m.toolCalls??[]).at(-1)?.output).toContain('retain the original role');
  });
  it('invalidates an edit suggestion when the target version changes during generation',async()=>{
    await writeFile(join(directory,'draft.ts'),'before');const [file]=await handoffFiles(directory,['draft.ts']);
    respond=async(body,res)=>{
      if(body.model==='lead'){if(body.messages.some((m:any)=>m.role==='tool'))reply(res);else calls(res,[{name:'delegate',args:assignment({roleId:'inline_completion',files:['draft.ts'],editContext:{path:'draft.ts',sha256:file.sha256,line:1,column:0}})}]);return;}
      expect(body.tools.some((t:any)=>t.function.name==='write_file')).toBe(false);
      await writeFile(join(directory,'draft.ts'),'changed concurrently');reply(res,'Suggested replacement for the old content.');
    };
    const session=await create();runner.start(session.id,'Suggest an edit.');await runner.whenIdle();
    const task=runner.delegations.list(session.id)[0];expect(task.status).toBe('failed');
    expect(task.litefusion?.filesAfter?.[0].sha256).not.toBe(file.sha256);
    expect(runner.delegations.report(session.id,task.id)).toContain('edit target changed');
    expect(await readFile(join(directory,'draft.ts'),'utf8')).toBe('changed concurrently');
  });
  it('escalates a failed attempt with stable assignment identity and failure evidence',async()=>{
    let id='';respond=(body,res)=>{
      if(body.model==='cheap'){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Fixture denied the worker request.'}}));return;}
      if(body.model!=='lead'){reply(res,'Repaired with supplied evidence.');return;}
      const records=id?runner.delegations.list(id):[];
      if(records.length===0)calls(res,[{name:'delegate',args:assignment()}]);
      else if(records.length===1)calls(res,[{name:'delegate',args:assignment({repairOf:records[0].id})}]);else reply(res);
    };
    const session=await create();id=session.id;runner.start(id,'Implement.');await runner.whenIdle();
    const [first,second]=runner.delegations.list(id);expect(first.status).toBe('failed');expect(second.status).toBe('completed');
    expect(second.litefusion).toMatchObject({assignmentId:first.litefusion!.assignmentId,previousAttemptId:first.id,tier:'escalation',reason:'escalation'});
    expect(JSON.stringify(requests.find(body=>body.model==='coder').messages)).toContain('Provider request failed (HTTP 400)');
  });
  it('can escalate a failed task in a later user turn without erasing its history',async()=>{
    let id='',repairNext=false;respond=(body,res)=>{
      if(body.model==='cheap'){res.writeHead(400);res.end('{}');return;}
      if(body.model!=='lead'){reply(res,'Repaired.');return;}
      const tasks=id?runner.delegations.list(id):[];
      if(!tasks.length)calls(res,[{name:'delegate',args:assignment()}]);
      else if(repairNext&&tasks.length===1)calls(res,[{name:'delegate',args:assignment({repairOf:tasks[0].id})}]);else reply(res,'The current attempt is settled.');
    };
    const session=await create();id=session.id;runner.start(id,'Implement.');await runner.whenIdle();
    repairNext=true;runner.start(id,'Try the escalation model with the earlier evidence.');await runner.whenIdle();
    const [first,second]=runner.delegations.list(id);expect(second.status).toBe('completed');expect(second.parentTurnId).not.toBe(first.parentTurnId);
    expect(second.litefusion?.assignmentId).toBe(first.litefusion?.assignmentId);expect(first.status).toBe('failed');
  });
  it('keeps a parallel provider failure distinct from a patch integration conflict',async()=>{
    respond=(body,res)=>{
      if(body.model==='lead'){if(body.messages.some((m:any)=>m.role==='tool'))reply(res);else calls(res,[{name:'delegate',args:assignment({workstream:'broken'})},{name:'delegate',args:assignment({workstream:'healthy'})}]);return;}
      if(body.messages.some((m:any)=>typeof m.content==='string'&&m.content.includes('"workstream": "broken"'))){res.writeHead(401);res.end('{}');}else reply(res,'No edits needed.');
    };
    const session=await create();runner.start(session.id,'Inspect two independent tasks.');await runner.whenIdle();
    const tasks=runner.delegations.list(session.id);
    expect(tasks.find(t=>t.litefusion?.workstream==='broken')).toMatchObject({status:'failed',litefusion:{failureKind:'provider',integration:'not_applied'}});
    expect(tasks.find(t=>t.litefusion?.workstream==='healthy')).toMatchObject({status:'completed',litefusion:{integration:'integrated'}});
  });
  it('does not permit a second same-route repair or erase the first attempt',async()=>{
    let id='',leadCalls=0;respond=(body,res)=>{
      if(body.model!=='lead'){reply(res,'Patch ready for review.');return;}
      const tasks=id?runner.delegations.list(id):[];
      if(++leadCalls>3){reply(res);return;}
      calls(res,[{name:'delegate',args:assignment(tasks.length?{continueFrom:tasks.at(-1)!.id,repair:true,evidence:['Independent check still fails with the same output.']}:{})}]);
    };
    const session=await create();id=session.id;runner.start(id,'Implement and repair.');await runner.whenIdle();
    const tasks=runner.delegations.list(id);expect(tasks).toHaveLength(2);expect(tasks[1].litefusion?.sameRouteRepairs).toBe(1);
    expect(runner.tasks.list(id).some(task=>task.error?.includes('one same-route repair'))).toBe(true);
    const detail=(await api(`/sessions/${id}`)).body;expect(logicalWorkers(detail)).toHaveLength(1);expect(new Set(workerLabels(detail).values())).toEqual(new Set(['Task 1']));
  });
  it('continues a compatible serial worker instead of rebuilding its context',async()=>{
    let id='';respond=(body,res)=>{
      if(body.model!=='lead'){reply(res,'Remember the delivery contract.');return;}
      const tasks=id?runner.delegations.list(id):[];
      if(!tasks.length)calls(res,[{name:'delegate',args:assignment()}]);
      else if(tasks.length===1)calls(res,[{name:'delegate',args:assignment({continueFrom:tasks[0].id,prompt:'Continue using the delivery contract.'})}]);else reply(res);
    };
    const session=await create();id=session.id;runner.start(id,'Implement in two related steps.');await runner.whenIdle();
    const [first,second]=runner.delegations.list(id);expect(second.childSessionId).toBe(first.childSessionId);expect(second.litefusion?.contextReused).toBe(true);
    const workerCalls=requests.filter(body=>body.model==='cheap');expect(workerCalls[1].messages.filter((message:any)=>message.role==='user')).toHaveLength(2);
    expect(JSON.stringify(workerCalls[1].messages)).toContain('Remember the delivery contract.');
  });
  it('yields for a sibling helper and resumes only after a complete tool boundary',async()=>{
    let id='';respond=(body,res)=>{
      if(body.model==='reader'){reply(res,'Documentation: retries are allowed after a timeout.');return;}
      if(body.model==='cheap'){
        if(body.messages.filter((message:any)=>message.role==='user').length===1)calls(res,[{name:'worker_request',args:{outcome:'needs_help',reason:'Need the retry contract.',evidence:'The implementation leaves timeout behavior unclear.',suggestedRoleId:'doc_lookup'}}]);
        else reply(res,'Used the helper evidence to finish.');return;
      }
      const tasks=id?runner.delegations.list(id):[];
      if(!tasks.length)calls(res,[{name:'delegate',args:assignment()}]);
      else if(tasks.length===1)calls(res,[{name:'delegate',args:assignment({roleId:'doc_lookup',workstream:'docs',helperFor:tasks[0].id,prompt:'Read the retry contract.'})}]);
      else if(tasks.length===2)calls(res,[{name:'delegate',args:assignment({continueFrom:tasks[0].id,evidence:['Documentation says retries are allowed after a timeout.']})}]);else reply(res);
    };
    const session=await create();id=session.id;runner.start(id,'Implement the task.');await runner.whenIdle();
    const tasks=runner.delegations.list(id);expect(tasks).toHaveLength(3);expect(tasks[0].litefusion?.outcome).toBe('needs_help');expect(tasks[1].litefusion?.helperFor).toBe(tasks[0].litefusion?.assignmentId);expect(tasks[2].childSessionId).toBe(tasks[0].childSessionId);
    const resumed=requests.filter(body=>body.model==='cheap')[1];expect(resumed.messages.some((m:any)=>m.role==='tool'&&m.content.includes('Request recorded'))).toBe(true);
  });
  it('enforces a read-only role even when the lead marks it hard',async()=>{
    respond=(body,res)=>body.model==='lead'?(body.messages.at(-1)?.role==='tool'?reply(res):calls(res,[{name:'delegate',args:assignment({roleId:'doc_lookup',hard:true})}])):body.messages.at(-1)?.role==='tool'?reply(res,'Write was refused.'):calls(res,[{name:'write_file',args:{path:'forbidden.txt',content:'no'}}]);
    const session=await create();runner.start(session.id,'Read documentation.');await runner.whenIdle();
    const worker=requests.find(body=>body.model==='reader');expect(worker.reasoning_effort).toBe('max');expect(worker.tools.some((t:any)=>['write_file','bash'].includes(t.function.name))).toBe(false);
    await expect(readFile(join(directory,'forbidden.txt'))).rejects.toThrow();
  });
  it('keeps independent parallel writes isolated and integrates their files',async()=>{
    respond=(body,res)=>body.model==='lead'?(body.messages.at(-1)?.role==='tool'?reply(res):calls(res,['a','b'].map(name=>({name:'delegate',args:assignment({workstream:name,description:name,prompt:name,files:[name+'.txt']})})))):body.messages.at(-1)?.role==='tool'?reply(res,'Done'):calls(res,[{name:'write_file',args:{path:JSON.parse(body.messages.find((m:any)=>m.role==='user').content).assignment.workstream+'.txt',content:'working'}}]);
    const session=await create();runner.start(session.id,'Create independent a and b files.');await runner.whenIdle();
    expect(await readFile(join(directory,'a.txt'),'utf8')).toBe('working');expect(await readFile(join(directory,'b.txt'),'utf8')).toBe('working');
    const tasks=runner.delegations.list(session.id);expect(tasks).toHaveLength(2);expect(tasks.every(task=>task.isolated&&task.litefusion?.integration==='integrated')).toBe(true);
  });
});

describe('LiteFusion policy evidence and bindings',()=>{
  it('preserves all 63 cards and shares the default/escalation map',()=>{
    expect(LITEFUSION_ROLES).toHaveLength(63);expect(new Set(LITEFUSION_ROLES.map(role=>role.id)).size).toBe(63);
    const prompt=liteFusionLeadPrompt(selection);for(const role of LITEFUSION_ROLES){expect(prompt).toContain(role.handoff);expect(prompt).toContain(role.acceptance);}
    const provider={id:'fixture',name:'Fixture',kind:'openai' as const,baseUrl:'http://127.0.0.1:1'};
    const snapshot=captureLiteFusion(selection,[provider]);
    expect(resolveLiteFusion(snapshot,'bounded_patch',true,false).route.route).toEqual(resolveLiteFusion(snapshot,'bounded_patch',false,true).route.route);
    expect(resolveLiteFusion(snapshot,'semantic_code_index',false,false)).toMatchObject({reason:'availability_fallback',route:{route:{model:'research'},adapter:'search'}});
    expect(resolveLiteFusion(snapshot,'inline_completion',false,false)).toMatchObject({reason:'availability_fallback',route:{route:{model:'reader'},adapter:'edit_suggestion'}});
  });
  it('keeps policy identity stable across catalog expiry while retaining current route observations',()=>{
    let now=0;const cache=new ModelCatalogCache(()=>now);
    const provider={id:'fixture',name:'Fixture',kind:'openai' as const,baseUrl:'http://127.0.0.1:1'};
    cache.remember(provider,[{id:'cheap',name:'cheap',providerId:'fixture',reasoningEfforts:['max']}]);
    const observed=captureLiteFusion(selection,[provider],cache);
    now=24*60*60*1000;const expired=captureLiteFusion(selection,[provider],cache);
    expect(observed.routes.bounded_patch.default.status).toBe('metadata-compatible');
    expect(expired.routes.bounded_patch.default.status).toBe('configured');expect(expired.hash).toBe(observed.hash);
    expect(captureLiteFusion({...selection,maxAssignments:3},[provider],cache).hash).not.toBe(observed.hash);
  });
  it('does not guess gateway aliases or silently discard unsupported effort',()=>{
    const provider={id:'fixture',name:'Fixture',kind:'openai' as const,baseUrl:'http://127.0.0.1:1',models:['flash-is-awesome']};
    const snapshot=captureLiteFusion({kind:'litefusion',gatewayProviderId:'fixture'},[provider]);expect(()=>resolveLiteFusion(snapshot,'bounded_patch',false,false)).toThrow('No exact');
    const cache=new ModelCatalogCache();cache.remember(provider,[{id:'cheap',name:'cheap',providerId:'fixture',reasoningEfforts:['low']}]);
    expect(captureLiteFusion(selection,[provider],cache).routes.bounded_patch.default).toMatchObject({status:'unavailable',reason:expect.stringContaining('does not advertise max')});
  });
});

describe('LiteFusion tool and artifact boundaries',()=>{
  it('scopes borrowed connections and cancellation without releasing the root lease',async()=>{
    let released=false,called='';const abort=new AbortController();
    const parent={definitions:['mcp_read','mcp_write'].map(name=>({type:'function' as const,function:{name,description:'fixture',parameters:{}}})),scope:(name:string)=>name,assertCurrent:()=>{if(released)throw new Error('disconnected');},execute:async(name:string)=>{called=name;return 'ok';},release:()=>{released=true;},readOnlyTools:()=>new Set(['mcp_read'])};
    const lease=scopeExternalLease(parent,['mcp_read'],abort.signal);
    await expect(lease.execute('mcp_read',{},abort.signal)).resolves.toBe('ok');expect(called).toBe('mcp_read');
    expect(()=>lease.execute('mcp_write',{},abort.signal)).toThrow('outside');abort.abort();expect(()=>lease.assertCurrent('mcp_read')).toThrow('closed');lease.release();expect(released).toBe(false);
  });
  it('hashes actual versions and rejects paths through external symlinks',async()=>{
    const root=await mkdtemp(join(tmpdir(),'lf-hash-')),outside=await mkdtemp(join(tmpdir(),'lf-outside-'));
    try{await writeFile(join(root,'file'),'one');const first=await handoffFiles(root,['file']);await writeFile(join(root,'file'),'two');expect((await handoffFiles(root,['file']))[0].sha256).not.toBe(first[0].sha256);await symlink(outside,join(root,'linked'));await expect(handoffFiles(root,['linked'])).rejects.toThrow('outside');await expect(handoffFiles(root,['linked/not-created-yet'])).rejects.toThrow('outside');await expect(handoffFiles(root,['../secret'])).rejects.toThrow('inside');}finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
  });
});
