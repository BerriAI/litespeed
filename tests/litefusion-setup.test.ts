import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bindExactModels, liteFusionLeadPrompt, type LiteFusionSelection } from '../shared/litefusion.js';
import { liteFusionPreset, pendingArchitectureLabel } from '../shared/architecture-config.js';
import { liteFusionReadiness, liteFusionReadinessLabel } from '../shared/litefusion-readiness.js';
import { captureLiteFusion, resolveLiteFusion } from '../server/litefusion-routing.js';
import { ModelCatalogCache, modelCatalog } from '../server/budget.js';
import { LiteFusionDiscovery } from '../server/litefusion-discovery.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import type { Model, Provider } from '../shared/types.js';

const selection:LiteFusionSelection={kind:'litefusion',gatewayProviderId:'p'};
const provider:Provider={id:'p',name:'Gateway',kind:'openai',baseUrl:'http://localhost:1'};
const model=(id:string,canonicalId?:string):Model=>({id,canonicalId,name:id,providerId:'p'});
it('repairs legacy routes from discovered identities without changing preferences or explicit overrides',()=>{
  const cache=new ModelCatalogCache();cache.remember(provider,[model('gemini/gemini-3.8-flash'),model('openai/gpt-6-astra')]);
  const policy={...selection,lead:{providerId:'p',model:'my-lead',effort:'high' as const},handoffs:{repository_implementation:{instructions:'Keep API',acceptance:'Tests pass'}}};
  const snapshot=captureLiteFusion(policy,[provider],cache);
  expect(resolveLiteFusion(snapshot,'repository_implementation',false,false).route.route?.model).toBe('gemini/gemini-3.8-flash');
  expect(resolveLiteFusion(snapshot,'repository_implementation',true,false).route.route?.model).toBe('openai/gpt-6-astra');
  expect(policy).not.toHaveProperty('bindings');expect(snapshot.selection.lead).toEqual(policy.lead);expect(snapshot.selection.handoffs).toEqual(policy.handoffs);
  const overridden=captureLiteFusion({...policy,bindings:{gemini:{providerId:'p',model:'my-reviewed-alias'}}},[provider],cache);
  expect(resolveLiteFusion(overridden,'repository_implementation',false,false).route.route?.model).toBe('my-reviewed-alias');
});
it('accepts unique explicit identity metadata, never fuzzy names, versions or ambiguous aliases',()=>{
  expect(bindExactModels(selection,[model('company-coder','gemini-3.8-flash')]).bindings?.gemini?.model).toBe('company-coder');
  expect(bindExactModels(selection,[model('a','gemini-3.8-flash'),model('b','gemini-3.8-flash')]).bindings?.gemini).toBeUndefined();
  expect(bindExactModels(selection,[model('claude-opus-5-20260801'),model('opus-best'),model('gemini-3.8-flash-preview')]).bindings).toEqual({});
});
it('selects a discovered Opus or Astra lead and asks for a lead if neither exists',()=>{
  expect(liteFusionPreset('p',[model('openai/gpt-6-astra')]).lead).toEqual({providerId:'p',model:'openai/gpt-6-astra',effort:'high'});
  expect(liteFusionPreset('p',[model('openai/gpt-6-astra'),model('anthropic/claude-opus-5')]).lead?.model).toBe('anthropic/claude-opus-5');
  expect(liteFusionPreset('p',[model('unrecognized')]).lead?.model).toBe('');
});
it('counts actual specialist routes separately from lead-owned tasks and reports backups',()=>{
  const cache=new ModelCatalogCache();cache.remember(provider,[model('openai/gpt-6-astra')]);
  const snapshot=captureLiteFusion(selection,[provider],cache),ready=liteFusionReadiness(snapshot.routes);
  expect(ready.backup).toBeGreaterThan(0);expect(ready.leadOnly).toBeGreaterThan(0);expect(ready.total).toBeLessThan(63);
  expect(ready.leadOnlyTasks).not.toContain('repository_implementation');
  expect(liteFusionReadinessLabel(liteFusionReadiness(captureLiteFusion(selection,[provider],new ModelCatalogCache()).routes))).toContain('No specialists connected');
});
it('deduplicates discovery, backs off failures, and retries changed credentials',async()=>{
  modelCatalog.clear();let count=0,now=1000;const discover=new LiteFusionDiscovery(async()=>{count++;throw new Error('Do not expose secret credential');},()=>now);
  const [a,b]=await Promise.all([discover.ensure(selection,[provider]),discover.ensure(selection,[provider])]);
  expect(count).toBe(1);expect(a).toBe(b);expect(a).not.toContain('secret');await discover.ensure(selection,[provider]);expect(count).toBe(1);
  await discover.ensure(selection,[{...provider,apiKey:'changed'}]);expect(count).toBe(2);
  now+=31_000;await discover.ensure(selection,[provider]);expect(count).toBe(3);
});
it('does not describe same-architecture settings as an architecture switch',()=>{
  expect(pendingArchitectureLabel({architecture:selection,pendingArchitecture:{id:'p',requestedAt:0,expectedRevision:0,configuration:{providerId:'p',model:'lead',architecture:selection,planner:null,shunt:null,modelReasoning:{},outputStyle:null}}})).toContain('Model settings updated');
});

const listen=(server:Server)=>new Promise<string>(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${(server.address() as {port:number}).port}`)));
const close=(server:Server)=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
describe('automatic setup through the real API and runner with a local fake gateway',()=>{
  let directory:string,store:Store,gateway:Server,server:Server,url:string,runner:ReturnType<typeof createApp>['runner'];
  let models:any[],requests:any[],catalogRequests:number;
  const api=async(path:string,body?:unknown)=>{const res=await fetch(url+'/api'+path,{method:body?'POST':'GET',headers:{'content-type':'application/json'},body:body?JSON.stringify(body):undefined});expect(res.ok).toBe(true);return res.json();};
  beforeEach(async()=>{
    modelCatalog.clear();requests=[];catalogRequests=0;models=[{id:'anthropic/claude-opus-5'},{id:'gemini/gemini-3.8-flash'},{id:'openai/gpt-6-astra'}];directory=await mkdtemp(join(tmpdir(),'lf-setup-'));store=new Store(join(directory,'state'));
    gateway=createServer(async(req,res)=>{
      if(req.method==='GET'){catalogRequests++;res.setHeader('content-type','application/json');res.end(JSON.stringify({data:models}));return;}
      const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString());requests.push(body);
      const root=body.model==='anthropic/claude-opus-5';
      const runtime=body.messages.map((m:any)=>m.content).filter((c:any)=>typeof c==='string').join('\n').split('\n').find((line:string)=>line.startsWith('LiteFusion availability captured'));
      const availability=runtime?JSON.parse(runtime.slice(runtime.indexOf(': ')+2)):null;
      const delegate=root&&!body.messages.some((m:any)=>m.role==='tool')&&availability&&!availability.unavailableDefault.includes('repository_implementation');
      const calls=[{name:'delegate',arguments:JSON.stringify({roleId:'repository_implementation',workstream:'feature',description:'Inspect project',prompt:'Report one concrete observation.',reason:'Independent specialist investigation',acceptance:['Report returned'],files:[],constraints:[],evidence:[]})},{name:'wait_tasks',arguments:'{}'}];
      const delta=delegate?{tool_calls:calls.map((f,index)=>({index,id:`c${index}`,type:'function',function:f}))}:{content:root?'Accepted report or handled directly: no eligible specialist.':'Worker observation: fixture inspected.'};
      res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({choices:[{delta,finish_reason:delegate?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
    });
    const baseUrl=await listen(gateway);store.saveSettings({workspace:directory,providers:[{...provider,baseUrl}],defaultProvider:'p',defaultModel:'anthropic/claude-opus-5',memoryEnabled:false});const app=createApp({store});runner=app.runner;server=createServer(app.app);url=await listen(server);
  });
  afterEach(async()=>{runner.stopAll();await runner.whenIdle();await close(server);await close(gateway);store.close();modelCatalog.clear();await rm(directory,{recursive:true,force:true});});
  it('opens an unbound old session, shows readiness, and actually calls a specialist without editing settings',async()=>{
    const s=await api('/sessions',{architecture:selection,permissionMode:'auto'});
    const before=await api(`/sessions/${s.id}`);expect(before.litefusion.primary).toBeGreaterThan(0);expect(before.session.architecture.bindings).toBeUndefined();
    await api(`/sessions/${s.id}/messages`,{content:'Investigate this project.'});await runner.whenIdle();
    const after=await api(`/sessions/${s.id}`);expect(after.delegations).toHaveLength(1);expect(after.delegations[0].model).toBe('gemini/gemini-3.8-flash');expect(requests.some(body=>body.model==='gemini/gemini-3.8-flash'&&body.reasoning_effort==='high')).toBe(true);expect(catalogRequests).toBe(1);
    expect(JSON.stringify(requests[0].messages)).toContain('delegate coherent specialist tasks by default');
    expect(after.session.pendingArchitecture).toBeUndefined();expect(after.session.configRevision).toBe(s.configRevision);
  });
  it('discovers on a direct send without opening settings, and exposes lead-only gateways honestly',async()=>{
    models=[{id:'anthropic/claude-opus-5'}];const s=await api('/sessions',{architecture:selection,permissionMode:'auto'});
    await api(`/sessions/${s.id}/messages`,{content:'Investigate this project.'});await runner.whenIdle();
    expect(catalogRequests).toBe(1);const ready=(await api('/litefusion/routes',selection)).readiness;
    // Some catalog roles deliberately use Opus, so a known lead may also be a worker.
    expect(ready.leadOnly).toBeGreaterThan(0);expect(ready.leadOnlyTasks).toContain('repository_implementation');expect(requests.every(body=>body.model==='anthropic/claude-opus-5')).toBe(true);
    models=[{id:'unrecognized'}];modelCatalog.clear();const preview=await api('/litefusion/routes',selection);expect(preview.readiness.primary+preview.readiness.backup).toBe(0);
  });
  it('keeps a captured route snapshot unchanged while later discovery changes',async()=>{
    const s=await api('/sessions',{architecture:selection});await api(`/sessions/${s.id}`);
    const snapshot=captureLiteFusion(selection,store.settings().providers);models=[{id:'other'}];modelCatalog.clear();await runner.liteFusionDiscovery.ensure(selection,store.settings().providers);
    expect(resolveLiteFusion(snapshot,'repository_implementation',false,false).route.route?.model).toBe('gemini/gemini-3.8-flash');
    expect(captureLiteFusion(selection,store.settings().providers).routes.repository_implementation.default.status).toBe('unavailable');
  });
});
