import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Stop admission after an admitted request loses its receipt. Resuming requires
 * an operator to inspect/archive the pause file and restart the gateway. */
export class GatewayPause {
  private stopped:boolean;
  readonly file:string;
  constructor(private readonly directory:string) {
    this.file=join(directory,'gateway-pause.json');
    this.stopped=existsSync(this.file);
  }
  get paused(){return this.stopped;}
  interrupt(requestId:string,stage:string,error:unknown):void {
    this.stopped=true; // Remains closed even if the filesystem write fails.
    const errors:{name:string;code?:string}[]=[];
    let current:unknown=error;
    for(let depth=0;depth<4&&current&&typeof current==='object';depth++){
      const value=current as {name?:unknown;code?:unknown;cause?:unknown};
      const safe=(text:unknown)=>typeof text==='string'&&/^[A-Za-z0-9_]{1,80}$/.test(text)?text:undefined;
      errors.push({name:safe(value.name)??'Error',...(safe(value.code)?{code:safe(value.code)}:{})});
      current=value.cause;
    }
    // Messages, headers, bodies and URLs can contain credentials or source.
    if(!/^[a-zA-Z0-9-]{1,80}$/.test(requestId))throw new Error('Invalid request identity.');
    const record=JSON.stringify({at:new Date().toISOString(),reason:'admitted-request-without-receipt',requestId,stage,errors},null,2)+'\n';
    writeFileSync(this.file,record,{mode:0o600});
    writeFileSync(join(this.directory,'gateway-failure-'+requestId+'.json'),record,{mode:0o600});
  }
}
