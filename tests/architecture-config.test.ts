import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { architectureConfiguration, liteFusionConfiguration, liteFusionPreset } from '../shared/architecture-config.js';
import { WorkspacePreferences } from '../server/workspace-preferences.js';
import type { Session } from '../shared/types.js';

const listen=(server:Server)=>new Promise<string>(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${(server.address() as {port:number}).port}`)));
const close=(server:Server)=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
describe('complete architecture configurations',()=>{
  let directory:string,store:Store,server:Server,provider:Server,url:string,runner:ReturnType<typeof createApp>['runner'],held:ServerResponse|undefined;
  const request=async(path:string,body?:unknown,method=body?'POST':'GET')=>{const response=await fetch(url+'/api'+path,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()};};
  beforeEach(async()=>{
    directory=await mkdtemp(join(tmpdir(),'architecture-config-'));store=new Store(join(directory,'state'));
    provider=createServer(async(req,res)=>{if(req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'anthropic/claude-opus-5'},{id:'openai/gpt-6-astra'},{id:'anthropic/claude-opus-5-20260801'}]}));return;}for await(const _chunk of req){}held=res;});
    store.saveSettings({workspace:directory,providers:[{id:'fixture',name:'Fixture',kind:'openai',baseUrl:await listen(provider)}],defaultProvider:'fixture',defaultModel:'old-lead',memoryEnabled:false});
    const app=createApp({store});runner=app.runner;server=createServer(app.app);url=await listen(server);held=undefined;
  });
  afterEach(async()=>{runner.stopAll();await runner.whenIdle();await close(server);await close(provider);store.close();await rm(directory,{recursive:true,force:true});});
  it('discovers an exact namespaced Opus identity and applies its effort without borrowing the old model',async()=>{
    const preset=await request('/litefusion/preset?providerId=fixture');expect(preset.status).toBe(200);expect(preset.body.selection.lead).toEqual({providerId:'fixture',model:'anthropic/claude-opus-5',effort:'high'});
    const created=await request('/sessions',{...liteFusionConfiguration(preset.body.selection),mode:'plan',permissionMode:'ask'});
    expect(created.body).toMatchObject({providerId:'fixture',model:'anthropic/claude-opus-5',mode:'plan',permissionMode:'ask',modelReasoning:{'["fixture","anthropic/claude-opus-5"]':'high'}});expect(created.body.planner).toBeUndefined();expect(created.body.shunt).toBeUndefined();
  });
  it('preserves customized arrangements separately, including reasoning, planner and Shunt',()=>{
    const original=store.createSession({architecture:{kind:'sidekick-fusion',sidekick:{providerId:'fixture',model:'executor'}},planner:{providerId:'fixture',model:'planner'},shunt:{enabled:true,model:{providerId:'fixture',model:'reader'}},modelReasoning:{'["fixture","old-lead"]':'medium'},outputStyle:'learning',permissionMode:'ask'});
    const fusion=store.updateSession(original.id,liteFusionConfiguration(liteFusionPreset('fixture',[{id:'claude-opus-5'}])));
    const restored=store.updateSession(original.id,fusion.architectureConfigurations!['sidekick-fusion']!);
    expect(architectureConfiguration(restored)).toEqual(architectureConfiguration(original));expect(restored.permissionMode).toBe('ask');expect(restored.workspace).toBe(directory);
    new WorkspacePreferences(store).save(directory,restored,true);expect(new WorkspacePreferences(store).get(directory).architectureConfigurations?.litefusion?.model).toBe('claude-opus-5');
  });
  it('does not label existing Astra sessions as the preset or silently select Opus during migration',()=>{
    const session=store.createSession({model:'astra-custom',architecture:{kind:'litefusion',gatewayProviderId:'fixture'},modelReasoning:{'["fixture","astra-custom"]':'low'}});
    expect(session.model).toBe('astra-custom');expect(session.architecture).toMatchObject({lead:{model:'astra-custom',effort:'low'}});expect((session.architecture as any).presetVersion).toBeUndefined();
  });
  it('keeps direct model edits synchronized with the LiteFusion policy lead',()=>{
    const session=store.createSession(liteFusionConfiguration(liteFusionPreset('fixture',[{id:'claude-opus-5'}])) as Partial<Session>);
    const next=store.updateSession(session.id,{model:'new-lead',modelReasoning:{'["fixture","new-lead"]':'medium'}});
    expect(liteFusionConfiguration(next.architecture as any,{...next,outputStyle:'learning'}).outputStyle).toBe('learning');
    expect(next.model).toBe('new-lead');expect(next.architecture).toMatchObject({lead:{providerId:'fixture',model:'new-lead',effort:'medium'}});
  });
  it('queues a switch until work settles, rejects stale pending editors, and applies once',async()=>{
    const session=store.createSession();runner.start(session.id,'Hold this response.');
    const deadline=Date.now()+3000;while(!held){if(Date.now()>deadline)throw new Error('Fixture did not receive the lead request');await new Promise(resolve=>setTimeout(resolve,5));}
    const config=liteFusionConfiguration(liteFusionPreset('fixture',[{id:'claude-opus-5'}]));
    const queued=await request(`/sessions/${session.id}/architecture`,{...config,expectedConfigRevision:0,expectedPendingId:null},'PUT');expect(queued.status).toBe(202);expect(queued.body.model).toBe('old-lead');expect(queued.body.pendingArchitecture.configuration.model).toBe('claude-opus-5');
    const stale=await request(`/sessions/${session.id}/architecture`,{...config,expectedConfigRevision:0,expectedPendingId:null},'PUT');expect(stale.status).toBe(409);
    held!.writeHead(200,{'Content-Type':'text/event-stream'});held!.end('data: '+JSON.stringify({choices:[{delta:{content:'Finished.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');await runner.whenIdle();
    const current=store.session(session.id);expect(current.model).toBe('claude-opus-5');expect(current.pendingArchitecture).toBeUndefined();expect(current.configRevision).toBe(1);expect(current.architectureConfigurations?.single?.model).toBe('old-lead');expect(store.messages(session.id).filter(message=>message.role==='user')).toHaveLength(1);
  });
  it('round-trips saved architecture defaults and rejects mismatched arrangement keys',async()=>{
    const configuration=liteFusionConfiguration(liteFusionPreset('fixture',[{id:'claude-opus-5'}]));
    const input={workspace:directory,providerId:'fixture',model:'old-lead',architectureConfigurations:{litefusion:configuration}};
    expect((await request('/workspace-preferences',input)).status).toBe(200);
    expect((await request('/workspace-preferences?workspace='+encodeURIComponent(directory))).body.architectureConfigurations).toEqual(input.architectureConfigurations);
    expect((await request('/workspace-preferences',{...input,architectureConfigurations:{single:configuration}})).status).toBe(400);
    expect((await request('/workspace-preferences',{...input,architectureConfigurations:{}})).status).toBe(200);
    expect((await request('/workspace-preferences?workspace='+encodeURIComponent(directory))).body.architectureConfigurations).toEqual({});
  });
  it('rejects stale idle configuration rather than overwriting another client',async()=>{
    const session=store.createSession();store.updateSession(session.id,{model:'changed'});
    const response=await request(`/sessions/${session.id}/architecture`,{...architectureConfiguration(session),expectedConfigRevision:0},'PUT');expect(response.status).toBe(409);expect(store.session(session.id).model).toBe('changed');
  });
});
