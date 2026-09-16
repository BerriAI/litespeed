import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { expect, it } from 'vitest';
import { GatewayPause } from '../scripts/litellm-harness/gateway-pause.js';

it('persists a pause across restarts without recording sensitive exception text',()=>{
  const directory=mkdtempSync(join(tmpdir(),'campaign-pause-'));
  try {
    const pause=new GatewayPause(directory);
    expect(pause.paused).toBe(false);
    const cause=Object.assign(new Error('private credential and source'),{code:'ECONNRESET'});
    pause.interrupt('request-1','upstream-body',new TypeError('private URL',{cause}));
    expect(pause.paused).toBe(true);
    const data=readFileSync(pause.file,'utf8');
    expect(readFileSync(join(directory,'gateway-failure-request-1.json'),'utf8')).toBe(data);
    expect(JSON.parse(data)).toMatchObject({requestId:'request-1',stage:'upstream-body',errors:[{name:'TypeError'},{name:'Error',code:'ECONNRESET'}]});
    expect(data).not.toContain('private');
    expect(new GatewayPause(directory).paused).toBe(true);
    unlinkSync(pause.file);
    expect(pause.paused).toBe(true);
    expect(new GatewayPause(directory).paused).toBe(false);
  } finally {rmSync(directory,{recursive:true,force:true});}
});

it('stays closed when writing diagnostics fails',()=>{
  const directory=mkdtempSync(join(tmpdir(),'campaign-pause-'));
  const pause=new GatewayPause(directory);rmSync(directory,{recursive:true,force:true});
  expect(()=>pause.interrupt('request-1','request-capture',new Error('disk unavailable'))).toThrow();
  expect(pause.paused).toBe(true);
});

it.each(['transport','missing-usage'])('stops HTTP admission after %s without repeating reservations',async(mode)=>{
  const directory=mkdtempSync(join(tmpdir(),'campaign-gateway-'));
  const keyFile=join(directory,'key');writeFileSync(keyFile,'test-only-key',{mode:0o600});
  const stub=join(directory,'no-usage.mjs');
  writeFileSync(stub,'globalThis.fetch=async()=>new Response(JSON.stringify({choices:[]}),{status:200,headers:{"Content-Type":"application/json"}});');
  const child=spawn(process.execPath,['--import','tsx',...(mode==='missing-usage'?['--import',stub]:[]),'scripts/litellm-harness/gateway.ts'],{
    env:{PATH:process.env.PATH,LITELLM_CAMPAIGN_DIR:directory,LITELLM_CAMPAIGN_KEY_FILE:keyFile,
      LITELLM_CAMPAIGN_BASE_URL:'https://127.0.0.1:9',LITELLM_CAMPAIGN_LIMIT_USD:'1'},
    stdio:['ignore','pipe','pipe'],
  });
  try {
    await new Promise<void>((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Gateway did not start.')),5000);
      child.once('error',error=>{clearTimeout(timeout);reject(error);});
      child.stdout.once('data',()=>{clearTimeout(timeout);resolve();});
    });
    const connection=JSON.parse(readFileSync(join(directory,'connection.json'),'utf8'));
    const headers={Authorization:`Bearer ${connection.apiKey}`,'Content-Type':'application/json'};
    const body=JSON.stringify({model:'fireworks_ai/deepseek-v4p1-flash',max_tokens:1,messages:[{role:'user',content:'Local transport test.'}]});
    // Start reading another request before the first request trips the pause.
    const waiting=request(connection.baseUrl+'/v1/chat/completions',{method:'POST',headers});
    const waitingResponse=new Promise<number|undefined>((resolve,reject)=>{
      waiting.once('response',response=>{response.resume();response.once('end',()=>resolve(response.statusCode));});
      waiting.once('error',reject);
    });
    await new Promise<void>((resolve,reject)=>waiting.write(body.slice(0,20),error=>error?reject(error):resolve()));
    const first=await fetch(connection.baseUrl+'/v1/chat/completions',{method:'POST',headers,body});
    expect(first.status).toBe(mode==='transport'?409:200);
    const initial=await first.json();
    if(mode==='transport')expect(initial.error.code).toBe('campaign_paused');
    else expect(initial.choices).toEqual([]);
    waiting.end(body.slice(20));
    expect(await waitingResponse).toBe(409);
    const second=await fetch(connection.baseUrl+'/v1/chat/completions',{method:'POST',headers,body});
    expect(second.status).toBe(409);await second.text();
    const status=await fetch(connection.baseUrl+'/status',{headers});
    expect(status.status).toBe(503);expect((await status.json()).paused).toBe(true);
    const ledger=JSON.parse(readFileSync(join(directory,'spend.json'),'utf8'));
    expect(ledger.records).toHaveLength(1);
    expect(ledger.records[0]).toMatchObject({status:'settled',costKnown:false});
    expect(JSON.parse(readFileSync(join(directory,'gateway-pause.json'),'utf8')).stage).toBe(mode==='transport'?'upstream-connect':'usage-receipt');
  } finally {
    if(child.exitCode===null){const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGTERM');await exited;}
    rmSync(directory,{recursive:true,force:true});
  }
},10000);
