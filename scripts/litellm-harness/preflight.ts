/** Resolve a replay-only deadline before allocating work; product turns are unchanged. */
export function replayTimeoutSeconds(kind:string,label:string,override?:string):number {
  if(override===undefined)return kind==='codex'||label.startsWith('comparison-')||label.startsWith('replication-')?900:600;
  if(!/^[1-9]\d*$/.test(override))throw new Error('Replay timeout must be an integer from 60 to 3600 seconds.');
  const seconds=Number(override);
  if(!Number.isSafeInteger(seconds)||seconds<60||seconds>3600)throw new Error('Replay timeout must be an integer from 60 to 3600 seconds.');
  return seconds;
}

/** Fail before allocating a replay when its local metering gateway is offline. */
export async function assertCampaignGatewayReady(connection:{baseUrl:string;apiKey:string}):Promise<void> {
  const url=new URL('/status',connection.baseUrl);
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1')throw new Error('Replay connection must use the local campaign gateway.');
  let status:Record<string,unknown>;
  try{
    const response=await fetch(url,{headers:{Authorization:`Bearer ${connection.apiKey}`},signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw new Error('Gateway status rejected.');
    status=await response.json() as Record<string,unknown>;
    if(!status||typeof status.limitUsd!=='number'||!Number.isFinite(status.limitUsd)||status.limitUsd<=0||
      typeof status.committedUsd!=='number'||!Number.isFinite(status.committedUsd)||status.committedUsd<0||
      !Number.isSafeInteger(status.requests))throw new Error('Invalid gateway status.');
  }catch{throw new Error('Campaign gateway is unavailable or its local credentials are stale. Restore it before allocating a replay. No trial was allocated.');}
  if(status.committedUsd>=status.limitUsd)throw new Error('Campaign spending ceiling reached. No trial was allocated.');
}
