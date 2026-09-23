import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

if (process.platform !== 'darwin') throw new Error('Run the native updater smoke check on a Mac with a desktop session.');
const exec = promisify(execFile), source = resolve(import.meta.dirname, '../..');
const artifacts = resolve(process.argv[2] || join(source,'release-artifacts'));
const release = JSON.parse(await readFile(join(artifacts,`desktop-manifest-darwin-${process.arch}.json`),'utf8'));
assert.ok(release.build > 1);
const temp = await realpath(await mkdtemp(join(tmpdir(),'litespeed-native-update-'))), state = join(temp,'saved data'), cache = join(state,'desktop-updates'), stage = join(cache,'stage-smoke');
const extracted = join(temp,'download');await mkdir(extracted);
execFileSync('/usr/bin/ditto',['-x','-k',join(artifacts,release.asset.file),extracted]);
const target = join(temp,'Installed with spaces/Litespeed.app');await mkdir(join(temp,'Installed with spaces'));
execFileSync('/bin/cp',['-cR',join(extracted,'Litespeed.app'),target]);
const root=join(target,'Contents/Resources/litespeed');
const prior={schema:1,version:release.version,build:release.build-1,platform:release.platform};
await writeFile(join(root,'desktop-release.json'),JSON.stringify(prior));
execFileSync('/usr/libexec/PlistBuddy',['-c',`Set :CFBundleVersion ${prior.build}`,join(target,'Contents/Info.plist')]);
// Compile the current bridge into the disposable old app, including its opt-in audit entry point.
execFileSync('xcrun',['swiftc','-swift-version','5','-O','-target',`${process.arch==='arm64'?'arm64':'x86_64'}-apple-macosx14.0`,'-framework','AppKit','-framework','WebKit',join(source,'desktop/macos/Litespeed.swift'),'-o',join(target,'Contents/MacOS/Litespeed')],{stdio:'pipe'});
for(const name of ['desktop-update-helper.mjs','desktop-updates.mjs','updates.mjs'])await cp(join(source,'bin',name),join(root,'bin',name));
execFileSync('/usr/bin/codesign',['--force','--deep','--sign','-',target],{stdio:'pipe'});
await mkdir(stage,{recursive:true});execFileSync('/bin/cp',['-cR',join(extracted,'Litespeed.app'),join(stage,'Litespeed.app')]);
const next={...release,tag:`desktop-v${release.version}-preview.${release.build}`};
await writeFile(join(cache,'checked.json'),JSON.stringify({checkedAt:Date.now(),release:next}));
await writeFile(join(cache,'pending.json'),JSON.stringify({path:'stage-smoke/Litespeed.app',target,release:next}));
const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${probe.address().port}`;await new Promise(done=>probe.close(done));
const audit=join(source,'.ui-audit/updater-native');await rm(audit,{recursive:true,force:true});await mkdir(audit,{recursive:true});
const env={...process.env,LITESPEED_DATA_DIR:state,LITESPEED_DESKTOP_URL:base,LITESPEED_WORKSPACE:temp,LITESPEED_DESKTOP_BUNDLE:'1',LITESPEED_DESKTOP_SKIP_IMPORT:'1',LITESPEED_NO_UPDATE_CHECK:'1',LITESPEED_DESKTOP_AUDIT:'1',LITESPEED_DESKTOP_UPDATE_AUDIT:join(audit,'after'),PLAYWRIGHT_BROWSERS_PATH:join(root,'runtime/browsers')};
const api=async(path,data,method)=>{const response=await fetch(base+'/api'+path,{method:method||(data?'POST':'GET'),...(data?{headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
const wait=async(read,label)=>{for(let i=0;i<600;i++){if(await read())return;await new Promise(done=>setTimeout(done,100));}throw new Error(label);};
let oldServer,oldApp,result;
try {
  oldServer=JSON.parse((await exec(join(root,'runtime/node'),[join(root,'bin/desktop-server.mjs')],{cwd:root,env})).stdout).pid;assert.ok(oldServer);
  await api('/settings',{providers:[{id:'fixture',name:'Local update check',kind:'openai',baseUrl:'http://127.0.0.1:1'}],defaultProvider:'fixture',defaultModel:'fixture',theme:'dark'},'PATCH');
  const task=await api('/sessions',{workspace:temp,title:'Saved through app update'});
  const settings=await api('/settings'),identity=(await api('/health')).storeId;
  assert.equal(identity,createHash('sha256').update(await realpath(state)).digest('hex'));
  // Queued messages must block restart before any native PID or app replacement is considered.
  await api(`/sessions/${task.id}/queue`,{content:'A saved queued thought.'});
  const blocked=await fetch(base+'/api/updates/restart',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appPid:process.pid})});
  assert.equal(blocked.status,409);assert.match((await blocked.json()).error,/queued messages/);
  const detail=await api(`/sessions/${task.id}`);await api(`/sessions/${task.id}/queue/${detail.queue.items[0].id}`,undefined,'DELETE');
  assert.equal((await api('/updates')).restartRequired,true);
  oldApp=spawn(join(target,'Contents/MacOS/Litespeed'),['--audit-dir',join(audit,'before'),'--audit-command','updates','--audit-restart-update'],{cwd:root,env,stdio:'ignore'});
  await wait(async()=>{try{result=JSON.parse(await readFile(join(cache,'last-result.json'),'utf8'));return true;}catch{return false;}},'The native update did not finish');
  assert.equal(result.ok,true,result.error);
  assert.equal((await api('/health')).desktopBuild,release.build);
  assert.equal((await api('/health')).storeId,identity);
  assert.deepEqual(await api('/settings'),settings);
  assert.equal((await api(`/sessions/${task.id}`)).session.title,'Saved through app update');
  await wait(async()=>{try{return (await readFile(join(audit,'after/native-webview.png'))).length>0;}catch{return false;}},'The updated app did not produce its own WebKit snapshot');
  const view=JSON.parse(await readFile(join(audit,'after/native-state.json'),'utf8'));assert.equal(view.bridge,true);assert.ok(view.text.includes('Saved through app update'));
  console.log('Native update passed: queued work blocked restart; the real native bridge closed the old app/server; the helper verified and replaced the app, restarted both, retained settings/history and rendered the updated native WebKit view. No provider generation or real user data was used.');
} finally {
  // These IDs come exclusively from processes launched for this disposable installation.
  for(const pid of [oldApp?.pid,oldServer,result?.appPid,result?.serverPid]){if(pid)try{process.kill(pid,'SIGTERM');}catch{}}
  await new Promise(done=>setTimeout(done,1000));
  await rm(temp,{recursive:true,force:true});
}
