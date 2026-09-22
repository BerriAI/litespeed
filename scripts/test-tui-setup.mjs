/** Exercise real terminal defaults, customization, fallback and missing-model setup. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import pty from 'node-pty';
import xterm from '@xterm/headless';
const root=resolve(import.meta.dirname,'..'),config=await mkdtemp(join(tmpdir(),'litespeed-setup-'));
const artifacts=join(root,'test-results-tui','setup');await mkdir(artifacts,{recursive:true});
const server=spawn(process.execPath,['--import','tsx','scripts/e2e-server.ts'],{cwd:root,env:{...process.env,LITESPEED_E2E_PORT:'0',LITESPEED_E2E_NO_VITE:'1'},stdio:['ignore','pipe','pipe']});
let log='',terminal,emulator;
server.stdout.on('data',chunk=>log+=chunk);server.stderr.on('data',chunk=>log+=chunk);
const screen=()=>emulator?Array.from({length:emulator.rows},(_,row)=>emulator.buffer.active.getLine(emulator.buffer.active.viewportY+row)?.translateToString(true,0,emulator.cols)??'').join('\n'):'';
const delay=ms=>new Promise(done=>setTimeout(done,ms));
async function waitFor(check,label){const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await delay(70);}throw new Error(label+'\n'+screen()+'\n'+log.slice(-1000));}
async function stop(){terminal?.kill();await delay(250);emulator?.dispose();terminal=undefined;emulator=undefined;}
try{
  await waitFor(()=>log.includes('Litespeed E2E ready'),'fixture ready');
  const base=/ready at (http:\/\/[^\s]+)/.exec(log)[1];
  const api=async(path,body,method)=>{const res=await fetch(base+'/api'+path,{method:method??(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await res.json();assert(res.ok,JSON.stringify(result));return result;};
  const settings=await api('/settings');
  async function launch(session){
    await stop();emulator=new xterm.Terminal({cols:100,rows:32,allowProposedApi:true});
    terminal=pty.spawn(process.execPath,['bin/litespeed.mjs','tui','--url',base,'--session',session.id,'--workspace',settings.workspace],{cwd:root,cols:100,rows:32,name:'xterm-256color',env:{...process.env,TERM:'xterm-256color',LITESPEED_DISABLE_PROJECT_CONFIG:'1',LITESPEED_CONFIG_DIR:config,XDG_CONFIG_HOME:config,XDG_STATE_HOME:config}});
    const display=emulator;terminal.onData(chunk=>display.write(chunk));
    await waitFor(()=>screen().includes('Commands [Ctrl+P]'),'terminal ready');
  }
  for(const scenario of [
    {path:'setup-defaults',driver:'openai/gpt-6-astra',sidekick:'openai/gpt-6-sol'},
    {path:'setup-fallbacks',driver:'anthropic/claude-fable-5-1',sidekick:'anthropic/claude-opus-5-5'},
    {path:'setup-unknown',driver:'',sidekick:''},
  ]){
    await api('/settings',{providers:[{...settings.providers[0],baseUrl:settings.providers[0].baseUrl+'/'+scenario.path}],defaultModel:''},'PATCH');
    const session=await api('/sessions',{workspace:settings.workspace,providerId:'fixture',model:'',architecture:null,shunt:{enabled:false}});
    await launch(session);
    await waitFor(()=>screen().includes('Review your setup')&&!screen().includes('Choosing available models'),'automatic review');
    assert(screen().includes('Sidekick Fusion'));assert(screen().includes('Shunt Off'));
    if(scenario.driver){
      assert(screen().includes('Driver: '+scenario.driver));assert(screen().includes('Sidekick: '+scenario.sidekick));
    }else{
      assert(screen().includes('Driver: Choose a model'));assert(screen().includes('Sidekick: Choose a model'));
      assert(screen().includes('Choose a model for your driver and sidekick'));
    }
    await writeFile(join(artifacts,scenario.path+'.txt'),screen());
    if(scenario.path==='setup-defaults'){
      terminal.resize(80,24);emulator.resize(80,24);await delay(200);
      await writeFile(join(artifacts,'narrow.txt'),screen());
      terminal.resize(100,32);emulator.resize(100,32);await delay(200);
      terminal.write('\x1b[H\x1b[B\x1b[B\r');
      await waitFor(()=>screen().includes('Choose your sidekick model'),'edit sidekick');
      terminal.write('test-fast');await waitFor(()=>screen().includes('test-fast')&&screen().includes('›'),'editable fallback');terminal.write('\r');
      await waitFor(()=>screen().includes('Sidekick: test-fast'),'return to review');
      terminal.write('\x1b[F\r');await waitFor(()=>!screen().includes('Review your setup'),'saved');
      const saved=(await api('/sessions/'+session.id)).session;
      assert.equal(saved.model,scenario.driver);assert.equal(saved.architecture.sidekick.model,'test-fast');assert.equal(saved.shunt.enabled,false);
      terminal.write('/setup\r');await waitFor(()=>screen().includes('Sidekick: test-fast'),'saved customization preserved');
    }
    await stop();
  }
  console.log('TUI setup passed: automatic Astra/Sol, latest Fable/Opus fallback, manual missing-model prompt, Shunt off, editable saved models, and narrow rendering.');
}finally{await stop();server.kill('SIGTERM');await rm(config,{recursive:true,force:true});}
