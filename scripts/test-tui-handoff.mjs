/** Local-only acceptance: the real PTY, app, runner and scripted HTTP provider. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import pty from 'node-pty';
import xterm from '@xterm/headless';

const root=resolve(import.meta.dirname,'..'),config=await mkdtemp(join(tmpdir(),'litefusion-pty-'));
const artifacts=join(root,'test-results-tui','handoff');await mkdir(artifacts,{recursive:true});
const server=spawn(process.execPath,['--import','tsx','scripts/e2e-server.ts'],{cwd:root,env:{...process.env,LITESPEED_E2E_PORT:'0',LITESPEED_E2E_NO_VITE:'1'},stdio:['ignore','pipe','pipe']});
let log='',terminal,emulator,base,session;
server.stdout.on('data',data=>log+=data);server.stderr.on('data',data=>log+=data);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const screen=()=>emulator?Array.from({length:emulator.rows},(_,row)=>emulator.buffer.active.getLine(emulator.buffer.active.viewportY+row)?.translateToString(true,0,emulator.cols)??'').join('\n'):'';
async function waitFor(check,label,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await delay(50);}throw new Error(`${label}\n${screen()}\n${log.slice(-1000)}`);}
async function api(path,body){const response=await fetch(base+'/api'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;}
const detail=()=>api(`/sessions/${session.id}`);
async function save(name){await writeFile(join(artifacts,name+'.txt'),screen());}
function click(marker){const lines=screen().split('\n'),row=lines.findIndex(line=>line.includes(marker));assert(row>=0,screen());const column=lines[row].indexOf(marker)+2;terminal.write(`\x1b[<0;${column};${row+1}M\x1b[<0;${column};${row+1}m`);}
async function inspect(description){terminal.write('\x10');await waitFor(()=>screen().includes('Search…'),'command palette');terminal.write('Inspect worker');await waitFor(()=>screen().includes('Inspect worker'),'worker command');terminal.write('\r');await waitFor(()=>screen().includes('Worker assignments'),'worker list');terminal.write(description);await delay(100);terminal.write('\r');await waitFor(()=>screen().includes('Read-only worker history'),'worker inspector');}
try{
  await waitFor(()=>/Litespeed E2E ready at (http:\/\/[^\s]+)/.test(log),'fixture ready');base=log.match(/Litespeed E2E ready at (http:\/\/[^\s]+)/)[1];
  const settings=await api('/settings');session=await api('/sessions',{workspace:settings.workspace,providerId:'fixture',model:'test-model',permissionMode:'auto',architecture:{kind:'litefusion',gatewayProviderId:'fixture',bindings:{gemini:{providerId:'fixture',model:'test-fast'}}}});
  emulator=new xterm.Terminal({cols:120,rows:40,allowProposedApi:true});
  terminal=pty.spawn(process.execPath,['bin/litespeed.mjs','tui','--url',base,'--session',session.id],{cwd:root,name:'xterm-256color',cols:120,rows:40,env:{...process.env,TERM:'xterm-256color',LITESPEED_DISABLE_PROJECT_CONFIG:'1',LITESPEED_CONFIG_DIR:config,XDG_CONFIG_HOME:config,XDG_STATE_HOME:config}});
  terminal.onData(data=>emulator.write(data));await waitFor(()=>screen().includes('Ask Litespeed'),'composer ready');await delay(200);
  terminal.write('LITEFUSION_HANDOFF_BROWSER\r');
  await waitFor(()=>screen().includes('Handoff retried successfully'),'recovered handoff');
  assert.equal(screen().split('Task 1 ·').length-1,1);assert(!screen().includes('Task 2 ·'));assert(!screen().includes('LiteFusion task result.'));assert(!screen().includes('Choose continueFrom'));
  click('Handoff retried successfully');await waitFor(()=>screen().includes('Choose continueFrom'),'readable handoff details');assert(!screen().includes('\\u000a'));await save('01-retry-details');
  click('Handoff retried successfully');await waitFor(()=>!screen().includes('Choose continueFrom'),'collapse handoff details');
  terminal.write('Keep my draft');await fetch(base+'/fixture/delegations/release',{method:'POST'});
  await waitFor(async()=>['idle','error'].includes((await detail()).session.status),'lead settles');
  await waitFor(()=>screen().includes('Needs lead attention'),'compact blocked worker');await delay(150);
  assert(!screen().includes('LiteFusion task result.'));assert(!screen().includes('FULL_WORKER_EVIDENCE'));assert(!screen().includes('\\u000a'));assert(screen().includes('Keep my draft'));await save('02-blocked-compact');
  await inspect('Fix heading rendering');click('Brief / evidence');await waitFor(()=>screen().includes('Worker report'),'report menu');click('Worker report');await waitFor(()=>screen().includes('Request')&&screen().includes('↑↓ / PgUp PgDn scroll'),'full report opens in inspector');await delay(100);terminal.write('\x1b[6~');await waitFor(()=>screen().includes('FULL_WORKER_EVIDENCE'),'full report evidence accessible by scrolling');await save('03-inspector-report');
  terminal.write('\x1b');await delay(100);terminal.write('\x1b');await waitFor(()=>screen().includes('Keep my draft'),'draft restored');
  terminal.resize(80,24);emulator.resize(80,24);await delay(200);assert(!screen().includes('FULL_WORKER_EVIDENCE'));assert(!screen().includes('LiteFusion task result.'));await save('04-narrow');
  console.log('Handoff PTY passed: one task, recovered retry, readable collapsed details, compact blocker/sidebar, full report in inspector, draft preserved.');
}finally{
  if(session&&base){await api(`/sessions/${session.id}/cancel`,{}).catch(()=>{});await fetch(base+'/fixture/delegations/release',{method:'POST'}).catch(()=>{});}
  terminal?.kill();emulator?.dispose();server.kill('SIGTERM');await rm(config,{recursive:true,force:true});
}
