import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sandboxCommand, sandboxBackend } from '../server/command-sandbox.js';
const execute=promisify(execFile);
async function reportNativeFailure(error:unknown):Promise<never>{
  const detail=error as {code?:unknown;signal?:unknown;stderr?:unknown;stdout?:unknown};
  let denials='';
  if(process.platform==='darwin')try{denials=(await execute('/usr/bin/log',['show','--last','1m','--style','compact','--predicate','eventMessage CONTAINS "Sandbox:"'],{timeout:10000,maxBuffer:1024*1024})).stdout.slice(-12000);}catch{}
  throw new Error(`Native confinement failed: ${JSON.stringify({code:detail.code,signal:detail.signal,stderr:detail.stderr,stdout:detail.stdout})}\n${denials}`,{cause:error});
}
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
let directory:string,workspace:string,data:string;
beforeEach(async()=>{directory=await realpath(await mkdtemp(join(tmpdir(),'litespeed-confinement-test-')));workspace=join(directory,'project');data=join(directory,'state');await mkdir(workspace);await mkdir(data);});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});

it('refuses unsupported or outside-workspace execution instead of falling back',async()=>{
  await expect(sandboxCommand('true',directory,workspace,data)).rejects.toThrow(/unavailable|inside/);
});

it('enforces workspace writes, protected reads, outside paths, and network isolation',async context=>{
  if(!sandboxBackend()){context.skip();return;}
  // This managed Linux test host may forbid user/network namespaces. Mac release
  // CI always exercises the actual backend; Linux checks fail closed below.
  const probe=await sandboxCommand('true',workspace,workspace,data);
  try {await execute(probe.executable,probe.args,{cwd:workspace,env:probe.env,timeout:5000});}
  catch(error){if(process.platform==='linux'&&/Operation not permitted|namespace/i.test(String(error))){await probe.cleanup();context.skip();return;}await reportNativeFailure(error);}
  finally{await probe.cleanup();}
  await writeFile(join(directory,'outside'),'outside');await writeFile(join(workspace,'.env'),'secret');await writeFile(join(data,'private'),'private');
  const host=createServer(socket=>socket.destroy());await new Promise<void>(resolve=>host.listen(0,'127.0.0.1',resolve));
  const port=(host.address() as {port:number}).port;
  const command=[
    'printf success > inside.txt',
    `if cat ${quote(join(directory,'outside'))} >/dev/null 2>&1; then exit 41; fi`,
    `if printf bad > ${quote(join(directory,'outside'))} 2>/dev/null; then exit 42; fi`,
    'if cat .env >/dev/null 2>&1; then exit 43; fi',
    `if cat ${quote(join(data,'private'))} >/dev/null 2>&1; then exit 44; fi`,
    // The command cannot reach a service on the host, including loopback.
    `${quote(process.execPath)} -e 'const s=require("node:net").connect(${port},"127.0.0.1");s.on("error",()=>process.exit(0));s.on("connect",()=>process.exit(45));'`,
  ].join('\n');
  let launch:Awaited<ReturnType<typeof sandboxCommand>>|undefined;
  try{launch=await sandboxCommand(command,workspace,workspace,data);await execute(launch.executable,launch.args,{cwd:workspace,env:launch.env,timeout:10000});}
  catch(error){await reportNativeFailure(error);}
  finally{await launch?.cleanup();await new Promise<void>(resolve=>host.close(()=>resolve()));}
  expect(await readFile(join(workspace,'inside.txt'),'utf8')).toBe('success');
  expect(await readFile(join(directory,'outside'),'utf8')).toBe('outside');
});
