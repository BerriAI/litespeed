import type { ToolDefinition } from '../shared/types.js';
import type { McpServerStatus } from '../shared/mcp.js';

/** A turn's immutable catalog and connection identity; never resolves a name
 * against a later configuration. Releasing invalidates this handle only. */
export interface ExternalToolLease {
  readonly definitions: readonly ToolDefinition[];
  scope(name: string): string;
  assertCurrent(name: string): void;
  execute(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string>;
  release(): void;
  /** GATEWAY PARTITION (docs/design-capability-proxy.md, Option 3): names of
   * gateway-routed tools (their server's advertise !== true) mapped to the
   * server name, frozen with the rest of this lease. OPTIONAL so mock leases
   * and older ExternalTools keep working: when absent the runner advertises
   * every leased tool directly — exactly the pre-gateway behavior. */
  gatewayTools?(): ReadonlyMap<string, string>;
  /** Provider-declared metadata, still subject to root approvals. Missing means unknown. */
  readOnlyTools?(): ReadonlySet<string>;
}

/** Borrow a subset of the accepted root lease; closing a worker never closes its parent. */
export function scopeExternalLease(parent:ExternalToolLease,names:readonly string[],signal:AbortSignal):ExternalToolLease {
  const allowed=new Set(names);let released=false;
  const check=(name:string)=>{if(released||signal.aborted)throw new Error('Worker tool lease is closed.');if(!allowed.has(name))throw new Error('Connected tool is outside this worker scope.');parent.assertCurrent(name);};
  return {
    definitions:parent.definitions.filter(tool=>allowed.has(tool.function.name)),
    gatewayTools:()=>new Map([...(parent.gatewayTools?.()??[])].filter(([name])=>allowed.has(name))),
    readOnlyTools:()=>new Set([...(parent.readOnlyTools?.()??[])].filter(name=>allowed.has(name))),
    scope:name=>{check(name);return parent.scope(name);},assertCurrent:check,
    execute:(name,args,requestSignal)=>{check(name);return parent.execute(name,args,AbortSignal.any([signal,requestSignal]));},
    release:()=>{released=true;},
  };
}
export interface ExternalTools {
  /** Synchronous, cache-only: cannot connect, discover, or await tools/list. */
  capture(signal: AbortSignal): ExternalToolLease;
  status?(): McpServerStatus[];
  configRevision?(): string;
  refresh?(name: string, expectedRevision: string, signal: AbortSignal): Promise<McpServerStatus[]>;
  reconnect?(name: string, expectedRevision: string, signal: AbortSignal): Promise<McpServerStatus[]>;
  close?(): Promise<void>;
}
