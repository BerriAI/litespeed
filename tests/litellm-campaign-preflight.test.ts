import {createServer} from 'node:http';
import {expect,it} from 'vitest';
import {assertCampaignGatewayReady,replayTimeoutSeconds} from '../scripts/litellm-harness/preflight.js';

it('keeps historical deadlines and rejects unsafe replay overrides before allocation',()=>{
  expect(replayTimeoutSeconds('single','pilot')).toBe(600);
  expect(replayTimeoutSeconds('single','comparison-pilot')).toBe(900);
  expect(replayTimeoutSeconds('litellm-specific','replication-pilot')).toBe(900);
  expect(replayTimeoutSeconds('codex','pilot')).toBe(900);
  expect(replayTimeoutSeconds('litellm-specific','replication-pilot','1800')).toBe(1800);
  for(const value of ['', '0','-1','59','3601','Infinity','900.5','1e3','900x',' 900','900 '])expect(()=>replayTimeoutSeconds('single','pilot',value)).toThrow('integer');
});

it('requires an authenticated healthy local meter before allocating Flash trials',async()=>{
  let status=200,payload:unknown={limitUsd:100,committedUsd:30,requests:120};
  const server=createServer((req,res)=>{
    expect(req.url).toBe('/status');expect(req.headers.authorization).toBe('Bearer local-test-token');
    res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(payload));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const connection={baseUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`,apiKey:'local-test-token'};
  try{
    await expect(assertCampaignGatewayReady(connection)).resolves.toBeUndefined();
    status=401;await expect(assertCampaignGatewayReady(connection)).rejects.toThrow('No trial was allocated');
    status=200;payload={};await expect(assertCampaignGatewayReady(connection)).rejects.toThrow('No trial was allocated');
    payload={limitUsd:100,committedUsd:100,requests:120};await expect(assertCampaignGatewayReady(connection)).rejects.toThrow('ceiling');
    await expect(assertCampaignGatewayReady({...connection,baseUrl:'https://example.invalid'})).rejects.toThrow('local campaign gateway');
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  await expect(assertCampaignGatewayReady(connection)).rejects.toThrow('No trial was allocated');
});
