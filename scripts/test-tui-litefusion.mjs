/** Local-only acceptance: the real PTY, app, runner and scripted HTTP provider. */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import pty from 'node-pty';
import xterm from '@xterm/headless';

const root=resolve(import.meta.dirname,'..'),config=await mkdtemp(join(tmpdir(),'litefusion-pty-'));
const artifacts=join(root,'test-results-tui','litefusion');await mkdir(artifacts,{recursive:true});
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
  const settings=await api('/settings');session=await api('/sessions',{workspace:settings.workspace,providerId:'fixture',model:'test-model',permissionMode:'auto',architecture:{kind:'litefusion',gatewayProviderId:'fixture',bindings:{glm:{providerId:'fixture',model:'test-fast'}}}});
  emulator=new xterm.Terminal({cols:120,rows:40,allowProposedApi:true});
  terminal=pty.spawn(process.execPath,['bin/litespeed.mjs','tui','--url',base,'--session',session.id],{cwd:root,name:'xterm-256color',cols:120,rows:40,env:{...process.env,TERM:'xterm-256color',LITESPEED_DISABLE_PROJECT_CONFIG:'1',LITESPEED_CONFIG_DIR:config,XDG_CONFIG_HOME:config,XDG_STATE_HOME:config}});
  terminal.onData(data=>emulator.write(data));await waitFor(()=>screen().includes('Commands [Ctrl+P]')&&screen().includes('Ask Litespeed'),'composer ready');await delay(200);
  assert(screen().includes('+ specialists'));
  terminal.write('/models\r');await waitFor(()=>screen().includes('Architecture: LiteFusion'),'LiteFusion saved in TUI');terminal.write('\x1b[H'+'\x1b[B'.repeat(3)+'\r');
  await waitFor(()=>screen().includes('All 63 task routes and handoffs'),'routing editor');terminal.write('\r');await waitFor(()=>screen().includes('all 63 tasks'),'searchable task catalog');terminal.write('technical documentation');await delay(150);terminal.write('\r');await waitFor(()=>screen().includes('Hard / escalation:')&&screen().includes('Luna'),'task route pair');await save('01-task-routing');
  for(let i=0;i<4;i++){terminal.write('\x1b');await delay(100);}
  await waitFor(()=>!screen().includes('↑↓ choose')&&screen().includes('Ask Litespeed'),'return to conversation');
  terminal.write('LITEFUSION_BROWSER implement both files\r');await waitFor(async()=>{const d=await detail();return d.delegations?.length===2&&d.delegations.every(t=>t.recentActivity?.length);},'both workers executed tools');
  await waitFor(()=>screen().includes('Task 1 ·')&&screen().includes('Task 2 ·'),'compact task rows');assert(!screen().includes('alpha worker report'));assert(!screen().includes('beta worker report'));await save('02-compact-workers');
  terminal.write('Preserve this draft');await delay(150);await inspect('Write beta');await waitFor(()=>screen().includes('beta worker report'),'beta history');assert(!screen().includes('alpha worker report'));await save('03-worker-inspector');
  click('Stop worker');await waitFor(async()=>{const d=await detail();return d.delegations.find(t=>t.description==='Write beta')?.status==='cancelled';},'stop beta without waiting for alpha',3000);
  assert.equal((await detail()).delegations.find(t=>t.description==='Write alpha').status,'running');
  terminal.write('\x1b');await waitFor(()=>screen().includes('Preserve this draft'),'draft restored');assert(!screen().includes('beta worker report'));
  await fetch(base+'/fixture/delegations/release',{method:'POST'});await waitFor(async()=>['idle','error'].includes((await detail()).session.status),'lead settles');
  terminal.resize(80,24);emulator.resize(80,24);await delay(150);await inspect('Write alpha');await waitFor(()=>screen().includes('alpha worker report'),'narrow history');await save('04-narrow-inspector');terminal.write('\x1b');await waitFor(()=>screen().includes('Preserve this draft'),'narrow draft restored');await save('05-narrow-draft');
  const exported=await api(`/sessions/${session.id}/litefusion/export`);assert.equal(exported.assignments.length,2);assert.equal(exported.turns[0].evaluation.success,null);
  console.log('LiteFusion PTY passed: 63-task editor, compact parallel rows, one history inspector, independent cancellation, preserved draft and narrow layout.');
}finally{
  if(session&&base){await api(`/sessions/${session.id}/cancel`,{}).catch(()=>{});await fetch(base+'/fixture/delegations/release',{method:'POST'}).catch(()=>{});}
  terminal?.kill();emulator?.dispose();server.kill('SIGTERM');await rm(config,{recursive:true,force:true});
}
