import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { expect, it } from 'vitest';
import { GatewayPause } from '../scripts/litellm-harness/gateway-pause.js';
import { FLASH_PRICES } from '../scripts/litellm-harness/budget.js';

it('reserves the enforced output cap for future requests without changing old unknown charges',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'campaign-output-cap-'));
  const keyFile=join(directory,'key');writeFileSync(keyFile,'test-only-key',{mode:0o600});
  const old={id:'old-unknown',label:'old',reservedUsd:0.5,chargedUsd:0.5,costKnown:false,status:'settled'};
  writeFileSync(join(directory,'spend.json'),JSON.stringify({limitUsd:0.74,committedUsd:0.5,records:[old]}));
  const stub=join(directory,'usage.mjs');
  writeFileSync(stub,'globalThis.fetch=async(_url,options)=>new Response(JSON.stringify({choices:[],observedMax:JSON.parse(options.body).max_tokens,usage:{prompt_tokens:1,completion_tokens:1}}),{status:200,headers:{"Content-Type":"application/json"}});');
  const child=spawn(process.execPath,['--import','tsx','--import',stub,'scripts/litellm-harness/gateway.ts'],{
    env:{PATH:process.env.PATH,LITELLM_CAMPAIGN_DIR:directory,LITELLM_CAMPAIGN_KEY_FILE:keyFile,
      LITELLM_CAMPAIGN_BASE_URL:'https://127.0.0.1:9',LITELLM_CAMPAIGN_LIMIT_USD:'0.74'},
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
    const send=(limits:{max_tokens?:number;max_completion_tokens?:number})=>fetch(connection.baseUrl+'/v1/chat/completions',{method:'POST',headers,
      body:JSON.stringify({model:'fireworks_ai/deepseek-v4p1-flash',messages:[{role:'user',content:'Local output-cap test.'}],...limits})});
    for(const limits of [{max_tokens:8192},{max_completion_tokens:8192}]){
      const response=await send(limits);expect(response.status).toBe(200);
      expect((await response.json()).observedMax).toBe(8192);
    }
    for(const limits of [{},{max_tokens:32768},{max_tokens:131072}]){
      const response=await send(limits);expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe('budget_exceeded');
    }
    const ledger=JSON.parse(readFileSync(join(directory,'spend.json'),'utf8'));
    expect(ledger.records).toHaveLength(3);expect(ledger.records[0]).toEqual(old);
    for(const record of ledger.records.slice(1)){
      expect(record.reservedUsd).toBeCloseTo(1048576*FLASH_PRICES.input+8192*FLASH_PRICES.output,12);
      expect(record).toMatchObject({status:'settled',costKnown:true});
    }
    expect(ledger.committedUsd).toBeCloseTo(0.5+2*(FLASH_PRICES.input+FLASH_PRICES.output),12);
  } finally {
    if(child.exitCode===null){const exited=new Promise<void>(resolve=>child.once('exit',()=>resolve()));child.kill('SIGTERM');await exited;}
    rmSync(directory,{recursive:true,force:true});
  }
},10000);

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
