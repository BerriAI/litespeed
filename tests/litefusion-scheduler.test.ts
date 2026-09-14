import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import type { LiteFusionSelection } from '../shared/litefusion.js';
import { LiteFusionTasks } from '../server/litefusion-tasks.js';

const listen=(server:Server)=>new Promise<string>(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${(server.address() as {port:number}).port}`)));
const close=(server:Server)=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
const reply=(res:ServerResponse,content='Done')=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{content},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);};
const calls=(res:ServerResponse,list:Array<{name:string;args:Record<string,unknown>}>)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(`data: ${JSON.stringify({choices:[{delta:{tool_calls:list.map((call,index)=>({index,id:`call-${index}`,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}))},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`);};
const assignment=(workstream:string,extra:Record<string,unknown>={})=>({roleId:'bounded_patch',workstream,description:workstream,prompt:`Complete ${workstream}`,reason:'Independent scoped work',acceptance:['Report exact evidence'],files:['backend.txt'],...extra});
const policy:LiteFusionSelection={kind:'litefusion',gatewayProviderId:'fixture',concurrency:2,bindings:{glm:{providerId:'fixture',model:'worker'},gemini:{providerId:'fixture',model:'rescue'}}};
const until=async(check:()=>boolean)=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw new Error('Expected task transition did not occur');await new Promise(resolve=>setTimeout(resolve,5));}};

describe('asynchronous LiteFusion scheduling',()=>{
  let directory:string,store:Store,provider:Server,runner:ReturnType<typeof createApp>['runner'];
  let requests:any[],respond:(body:any,res:ServerResponse)=>void;
  beforeEach(async()=>{directory=await realpath(await mkdtemp(join(tmpdir(),'litefusion-scheduler-')));store=new Store(join(directory,'state'));requests=[];respond=(_body,res)=>reply(res);provider=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);respond(body,res);}catch(error){res.writeHead(500);res.end(String(error));}});store.saveSettings({workspace:directory,providers:[{id:'fixture',name:'Fixture',kind:'openai',baseUrl:await listen(provider)}],defaultProvider:'fixture',defaultModel:'lead',memoryEnabled:false});runner=createApp({store}).runner;});
  afterEach(async()=>{runner.stopAll();await runner.whenIdle();await close(provider);store.close();await rm(directory,{recursive:true,force:true});});
  it('lets the lead work and starts a fast-task dependent while a slow sibling still runs',async()=>{
    await writeFile(join(directory,'config.txt'),'Existing configuration');
    const session=store.createSession({architecture:policy,permissionMode:'auto'});let slow:ServerResponse|undefined,dependent=false,leadWorked=false;
    respond=(body,res)=>{
      if(body.model==='lead'){
        const tasks=runner.tasks.list(session.id);
        if(!tasks.length){calls(res,[{name:'delegate',args:assignment('backend')},{name:'delegate',args:assignment('ui')},{name:'delegate',args:assignment('integration',{dependsOn:['backend']})}]);return;}
        if(!leadWorked){leadWorked=true;expect(tasks.some(task=>task.status==='running')).toBe(true);calls(res,[{name:'read_file',args:{path:'config.txt'}}]);return;}
        if(tasks.some(task=>task.status==='running'||task.status==='queued'))calls(res,[{name:'wait_tasks',args:{}}]);else reply(res,'Combined work ready for review.');return;
      }
      const text=JSON.stringify(body.messages);
      if(text.includes('Complete ui')){slow=res;return;}
      if(text.includes('Complete integration')){dependent=true;expect(slow).toBeDefined();expect(runner.tasks.list(session.id).find(task=>task.workstream==='ui')!.status).toBe('running');expect(text).toContain('Prerequisite backend');reply(res,'Dependent completed with backend evidence.');return;}
      if(body.messages.at(-1)?.role==='tool')reply(res,'Backend created backend.txt.');else calls(res,[{name:'write_file',args:{path:'backend.txt',content:'backend implementation'}}]);
    };
    runner.start(session.id,'Implement login. Keep the existing configuration.');await until(()=>dependent);
    const task=runner.tasks.list(session.id).find(task=>task.workstream==='integration')!;expect(await readFile(join(task.workspace!,'backend.txt'),'utf8')).toBe('backend implementation');
    reply(slow!,'UI completed.');await runner.whenIdle();
    const metrics=runner.tasks.metrics(session.id,store.messages(session.id).find(message=>message.role==='user')!.id);expect(metrics.leadWaitMs).toBeGreaterThan(0);expect(metrics.leadRequestsWithPendingTasks).toBeGreaterThan(0);
    expect(leadWorked).toBe(true);expect(runner.tasks.list(session.id).every(task=>task.status==='completed')).toBe(true);
    const messages=store.messages(session.id),origins=messages.flatMap(message=>(message.toolCalls??[]).filter(call=>call.name==='delegate'));
    expect(origins).toHaveLength(3);
    for(const call of origins){expect(JSON.parse(call.output!).status).toBe('queued');expect(call.delegationId).toBeTruthy();expect(messages.filter(message=>message.role==='tool'&&message.toolCallId===call.id).length).toBeGreaterThanOrEqual(1);}
    expect(messages.filter(message=>message.role==='system'&&message.content.startsWith('LiteFusion task result.'))).toHaveLength(3);
  });
  it('keeps a receipt immutable when delegate and wait share one assistant batch',async()=>{
    const session=store.createSession({architecture:policy,permissionMode:'auto'});
    respond=(body,res)=>{if(body.model!=='lead'){reply(res,'Worker evidence.');return;}if(!runner.tasks.list(session.id).length)calls(res,[{name:'delegate',args:assignment('inspect')},{name:'wait_tasks',args:{}}]);else if(runner.tasks.list(session.id).some(task=>task.status==='running'||task.status==='queued'))calls(res,[{name:'wait_tasks',args:{}}]);else reply(res);};
    runner.start(session.id,'Inspect the task.');await runner.whenIdle();
    const [attempt]=runner.delegations.list(session.id);expect(attempt.status).toBe('completed');
    const messages=store.messages(session.id),origin=messages.find(message=>message.id===attempt.parentMessageId)!,call=origin.toolCalls!.find(call=>call.id===attempt.toolCallId)!;
    expect(JSON.parse(call.output!).status).toBe('queued');expect(call.status).toBe('completed');expect(runner.delegations.report(session.id,attempt.id)).toContain('Worker evidence.');
    const at=messages.indexOf(origin),next=messages.findIndex((message,index)=>index>at&&message.role==='assistant');
    expect(messages.slice(at+1,next<0?undefined:next).filter(message=>message.role==='tool'&&message.toolCallId===call.id)).toHaveLength(1);
  });
  it('cancels a queued dependent without launching it or stopping its sibling',async()=>{
    const session=store.createSession({architecture:{...policy,concurrency:1},permissionMode:'auto'});let held:ServerResponse|undefined;
    respond=(body,res)=>{if(body.model!=='lead'){held=res;return;}const tasks=runner.tasks.list(session.id);if(!tasks.length)calls(res,[{name:'delegate',args:assignment('first')},{name:'delegate',args:assignment('later',{dependsOn:['first']})}]);else if(tasks.some(task=>task.status==='running'||task.status==='queued'))calls(res,[{name:'wait_tasks',args:{}}]);else reply(res);};
    runner.start(session.id,'Run these tasks.');await until(()=>Boolean(held));const later=runner.tasks.list(session.id).find(task=>task.workstream==='later')!;
    const cancelled=await runner.cancelTask(session.id,later.id);expect(cancelled.status).toBe('cancelled');expect(runner.tasks.list(session.id).find(task=>task.workstream==='first')!.status).toBe('running');
    reply(held!,'First finished.');await runner.whenIdle();expect(requests.filter(body=>body.model==='worker')).toHaveLength(1);expect(runner.tasks.list(session.id).find(task=>task.id===later.id)!.status).toBe('cancelled');
  });
  it('returns from a blocked dependency graph rather than polling models forever',async()=>{
    const session=store.createSession({architecture:policy,permissionMode:'auto'});let leadCalls=0;
    respond=(body,res)=>{if(body.model!=='lead'){calls(res,[{name:'worker_request',args:{outcome:'needs_help',reason:'Missing API contract',evidence:'No retry semantics specified'}}]);return;}if(++leadCalls===1)calls(res,[{name:'delegate',args:assignment('contract')},{name:'delegate',args:assignment('dependent',{dependsOn:['contract']})}]);else reply(res,'The contract needs clarification.');};
    runner.start(session.id,'Investigate before implementing.');await runner.whenIdle();expect(leadCalls).toBeLessThan(5);expect(runner.tasks.list(session.id).find(task=>task.workstream==='contract')!.status).toBe('blocked');expect(runner.tasks.list(session.id).find(task=>task.workstream==='dependent')!.status).toBe('interrupted');expect(runner.delegations.list(session.id)).toHaveLength(1);
  });
  it('does not overwrite source changed by the lead while a worker is finishing',async()=>{
    await writeFile(join(directory,'backend.txt'),'original');const session=store.createSession({architecture:policy,permissionMode:'auto'});let finishing:ServerResponse|undefined;
    respond=(body,res)=>{if(body.model==='lead'){if(!runner.tasks.list(session.id).length)calls(res,[{name:'delegate',args:assignment('patch')}]);else if(runner.tasks.list(session.id).some(task=>task.status==='running'||task.status==='queued'))calls(res,[{name:'wait_tasks',args:{}}]);else reply(res,'Conflict needs review.');return;}if(body.messages.at(-1)?.role==='tool'){finishing=res;return;}calls(res,[{name:'write_file',args:{path:'backend.txt',content:'worker change'}}]);};
    runner.start(session.id,'Change the backend.');await until(()=>Boolean(finishing));await writeFile(join(directory,'backend.txt'),'new root change');reply(finishing!,'Changed backend.');await runner.whenIdle();
    expect(await readFile(join(directory,'backend.txt'),'utf8')).toBe('new root change');const task=runner.tasks.list(session.id)[0];expect(task.status).toBe('failed');expect(await readFile(join(task.workspace!,'backend.txt'),'utf8')).toBe('worker change');expect(runner.delegations.list(session.id)[0].litefusion?.integration).toBe('conflict');
  });
  it('automatically falls back after an explicit quota failure and preserves partial files',async()=>{
    const session=store.createSession({architecture:policy,permissionMode:'auto'});let defaultCalls=0,rescueCalls=0;
    respond=(body,res)=>{
      if(body.model==='lead'){
        const tasks=runner.tasks.list(session.id);
        if(!tasks.length)calls(res,[{name:'delegate',args:assignment('recover')}]);
        else if(tasks.some(task=>['queued','running'].includes(task.status)))calls(res,[{name:'wait_tasks',args:{}}]);
        else reply(res,'Recovered task ready for review.');return;
      }
      if(body.model==='worker'){
        if(++defaultCalls===1){calls(res,[{name:'write_file',args:{path:'backend.txt',content:'retained partial implementation'}}]);return;}
        res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'insufficient_quota',message:'Insufficient credits'}}));return;
      }
      rescueCalls++;expect(JSON.stringify(body.messages)).toContain('insufficient_quota');reply(res,'Reviewed the retained implementation.');
    };
    runner.start(session.id,'Complete the implementation.');await runner.whenIdle();
    expect(defaultCalls).toBe(2);expect(rescueCalls).toBe(1);
    const task=runner.tasks.list(session.id)[0];expect(task.status).toBe('completed');expect(task.attemptIds).toHaveLength(2);
    const attempts=runner.delegations.list(session.id);expect(attempts[1].litefusion).toMatchObject({reason:'availability_fallback',contextReused:false,tier:'escalation'});
    expect(await readFile(join(directory,'backend.txt'),'utf8')).toBe('retained partial implementation');
    expect(store.messages(session.id).at(-1)?.content).not.toContain('remain unresolved');
  });
  it('stops after both eligible routes fail without an infinite fallback loop',async()=>{
    const session=store.createSession({architecture:policy,permissionMode:'auto'});
    respond=(body,res)=>{if(body.model==='lead'){const tasks=runner.tasks.list(session.id);if(!tasks.length)calls(res,[{name:'delegate',args:assignment('blocked')}]);else if(tasks.some(task=>['queued','running'].includes(task.status)))calls(res,[{name:'wait_tasks',args:{}}]);else reply(res,'The gateway needs credits.');return;}
      res.writeHead(402,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{code:'insufficient_credits'}}));};
    runner.start(session.id,'Implement it.');await runner.whenIdle();expect(requests.filter(body=>body.model!=='lead')).toHaveLength(2);expect(runner.tasks.list(session.id)[0].status).toBe('failed');
  });
  it('lets lead evidence resolve a blocked prerequisite and unblock its dependent',async()=>{
    const session=store.createSession({architecture:policy,permissionMode:'auto'});
    respond=(body,res)=>{
      const tasks=runner.tasks.list(session.id);
      if(body.model==='lead'){
        if(!tasks.length)calls(res,[{name:'delegate',args:assignment('contract')},{name:'delegate',args:assignment('dependent',{dependsOn:['contract']})}]);
        else if(tasks.some(task=>task.workstream==='contract'&&task.status==='blocked'))calls(res,[{name:'resolve_task',args:{taskId:tasks.find(task=>task.workstream==='contract')!.id,evidence:'User contract requires retry-safe writes; lead inspected the interface.'}}]);
        else if(tasks.some(task=>['queued','running'].includes(task.status)))calls(res,[{name:'wait_tasks',args:{}}]);else reply(res,'Ready for review.');return;
      }
      if(JSON.stringify(body.messages).includes('Complete contract'))calls(res,[{name:'worker_request',args:{outcome:'needs_help',reason:'Missing contract',evidence:'Need write semantics'}}]);
      else {expect(JSON.stringify(body.messages)).toContain('Lead resolution of contract');reply(res,'Implemented the contract.');}
    };
    runner.start(session.id,'Implement the workflow.');await runner.whenIdle();expect(runner.tasks.list(session.id).every(task=>task.status==='completed')).toBe(true);
    expect(runner.tasks.list(session.id)[0].resolution?.kind).toBe('lead');expect(store.messages(session.id).at(-1)?.content).not.toContain('remain unresolved');
  });
  it('recovers queued tasks as interrupted without replaying provider work',()=>{
    const session=store.createSession({architecture:policy}),message={id:'origin',sessionId:session.id,role:'assistant' as const,content:'',createdAt:Date.now(),toolCalls:[{id:'call',name:'delegate',args:{},status:'running' as const}]};store.saveMessage(message);
    const input=assignment('pending') as any;input.constraints=[];input.evidence=[];
    runner.tasks.submit(session.id,'turn','policy',message,message.toolCalls[0],input);
    const recovered=new LiteFusionTasks(store);expect(recovered.list(session.id)[0].status).toBe('interrupted');expect(requests).toHaveLength(0);
  });
});
